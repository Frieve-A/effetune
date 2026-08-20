const GROUP_DELAY_PEQ_SAMPLE_RATES = Object.freeze([44100, 48000, 88200, 96000, 176400, 192000]);

class GroupDelayPEQPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: GROUP_DELAY_PEQ_SAMPLE_RATES
    });

    static BANDS = [
        { frequency: 100 },
        { frequency: 316 },
        { frequency: 1000 },
        { frequency: 3160 },
        { frequency: 10000 }
    ];

    /**
     * Group delay shapes. Every type is described by the same three values
     * (frequency, delay, Q), so no control row is enabled or disabled per type.
     * Display names keep the eight character convention of the FIR PEQ selector.
     */
    static BAND_TYPES = [
        { id: 'pk', key: 'groupDelayPeq.type.pk', name: 'Peak' },
        { id: 'ls', key: 'groupDelayPeq.type.ls', name: 'LowShelv' },
        { id: 'hs', key: 'groupDelayPeq.type.hs', name: 'HighShel' },
        { id: 'fl', key: 'groupDelayPeq.type.fl', name: 'FilterGD' }
    ];

    static TAPS_CHOICES = [4096, 8192, 16384, 32768];
    static LATENCY_CHOICES = ['0', '128', '256', '512', '1024'];
    static GRID_STEPS_MS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100];
    static MINIMUM_GRAPH_RANGE_MS = 5;
    static EDGE_EXPAND_STEP_PX = 16;
    static RIPPLE_WARNING_DB = 0.3;
    static Q_RANGE = { minimum: 0.1, maximum: 100 };
    static GRAPH_FREQUENCY_RANGE = { minimum: 10, maximum: 40000 };

    static _logSliderPosition(value, minimum, maximum) {
        if (value <= minimum) return 0;
        if (value >= maximum) return 100;
        const logMinimum = Math.log10(minimum);
        return 100 * (Math.log10(value) - logMinimum) / (Math.log10(maximum) - logMinimum);
    }

    static _valueFromLogSliderPosition(position, minimum, maximum) {
        const numericPosition = Number(position);
        if (!Number.isFinite(numericPosition) || numericPosition <= 0) return minimum;
        if (numericPosition >= 100) return maximum;
        const logMinimum = Math.log10(minimum);
        return 10 ** (logMinimum + numericPosition * (Math.log10(maximum) - logMinimum) / 100);
    }

    constructor() {
        super('Group Delay PEQ', 'All-pass FIR that shapes group delay with five parametric bands');
        for (let index = 0; index < GroupDelayPEQPlugin.BANDS.length; index += 1) {
            this['t' + index] = 'pk';
            this['f' + index] = GroupDelayPEQPlugin.BANDS[index].frequency;
            this['d' + index] = 0;
            this['q' + index] = 0.7;
            this['e' + index] = true;
        }
        this.tp = 16384;
        this.lt = '128';
        this.offlineDspAssetErrorMessageKey = 'groupDelayPeq.error.design';
        this._sampleRate = this._getEngineSampleRate();
        this._outputChannelCount = this._getEngineChannelCount();
        this._runtime = null;
        this._runtimePromise = null;
        this._designer = null;
        this._designTimer = null;
        this._designGeneration = 0;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._candidateWarning = null;
        this._lastDesign = null;
        this._assetState = 0;
        this._disposed = false;
        this._statusMessage = '';
        this._statusState = '';
        this._statusElement = null;
        this._detailsElement = null;
        this._scale = { range: GroupDelayPEQPlugin.MINIMUM_GRAPH_RANGE_MS, gridStep: 1 };
        this._dragScaleExpansions = 0;
        this._drawGrid = null;
        this.uiCreated = false;
        this.uiContainer = null;
        this.graphContainer = null;
        this.gridSvg = null;
        this.responseSvg = null;
        this.markers = null;
        this.activeDragMarker = null;
        this.boundMouseMoveHandler = null;
        this.boundMouseUpHandler = null;
        this.executionState = { state: 'pending', reason: null };
        this.registerProcessor('return data;');
    }

    _t(_key, fallback, params = {}) {
        return Object.entries(params).reduce(
            (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
            fallback
        );
    }

    process(context, data) {
        return data;
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
        return candidates.find(value => Number.isInteger(value) && value >= 1 && value <= 8) || 2;
    }

    _bands() {
        return GroupDelayPEQPlugin.BANDS.map((_, index) => ({
            type: this['t' + index],
            frequency: this['f' + index],
            delayMs: this['d' + index],
            q: this['q' + index],
            enabled: this['e' + index]
        }));
    }

    /**
     * Largest delay the designed filter can hold, which is the bulk delay minus the
     * design guard. Shorter tap counts and higher sample rates shrink it.
     */
    _delayLimitMs() {
        return Math.floor((this.tp / 2 - this.tp / 16) * 1000 / this._sampleRate * 10) / 10;
    }

    /**
     * Only the delays follow the tap budget; the type and Q of a band survive a tap
     * or sample rate change untouched.
     */
    _clampDelaysToLimit() {
        const limit = this._delayLimitMs();
        for (let index = 0; index < GroupDelayPEQPlugin.BANDS.length; index += 1) {
            const value = this['d' + index];
            if (value > limit) this['d' + index] = limit;
            else if (value < -limit) this['d' + index] = -limit;
        }
    }

    /** Flat means no enabled band asks for a delay, whatever their types are. */
    _hasDelay() {
        return this._bands().some(band => band.enabled && band.delayMs !== 0);
    }

    _packedParameters() {
        return {
            ...super.getParameters(),
            lt: this.lt,
            fd: this.tp / 2
        };
    }

    getParameters(options = {}) {
        const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
            ? options.sampleRate
            : this._sampleRate;
        const outputChannelCount = Number.isInteger(options.outputChannelCount) &&
            options.outputChannelCount >= 1 && options.outputChannelCount <= 8
            ? options.outputChannelCount
            : this._outputChannelCount;
        if (options.commitSampleRate &&
            (sampleRate !== this._sampleRate || outputChannelCount !== this._outputChannelCount)) {
            this._sampleRate = sampleRate;
            this._outputChannelCount = outputChannelCount;
            this._clampDelaysToLimit();
            this._scheduleDesign(0);
            this.setUIValues();
            this.updateResponse();
            this.updateMarkers();
        }
        const parameters = { ...this._packedParameters(), tp: this.tp };
        for (let index = 0; index < GroupDelayPEQPlugin.BANDS.length; index += 1) {
            parameters['t' + index] = this['t' + index];
            parameters['f' + index] = this['f' + index];
            parameters['d' + index] = this['d' + index];
            parameters['q' + index] = this['q' + index];
            parameters['e' + index] = this['e' + index];
        }
        return parameters;
    }

    getSerializableParameters() {
        const serialized = super.getSerializableParameters();
        delete serialized.fd;
        return serialized;
    }

    setParameters(params = {}, syncUi = true) {
        const previous = this._designSignature();
        const previousLatency = this.lt;
        super._setValidatedParameters(params);
        const taps = Number(params.tp);
        if (GroupDelayPEQPlugin.TAPS_CHOICES.includes(taps)) this.tp = taps;
        if (GroupDelayPEQPlugin.LATENCY_CHOICES.includes(String(params.lt))) this.lt = String(params.lt);
        const limit = this._delayLimitMs();
        for (let index = 0; index < GroupDelayPEQPlugin.BANDS.length; index += 1) {
            const type = params['t' + index];
            if (GroupDelayPEQPlugin.BAND_TYPES.some(candidate => candidate.id === type)) {
                this['t' + index] = type;
            }
            if (params['f' + index] !== undefined) {
                this['f' + index] = this.parseFiniteNumber(params['f' + index], 20, 20000, this['f' + index]);
            }
            if (params['d' + index] !== undefined) {
                this['d' + index] = this.parseFiniteNumber(
                    params['d' + index], -limit, limit, this['d' + index]
                );
            }
            if (params['q' + index] !== undefined) {
                this['q' + index] = this.parseFiniteNumber(
                    params['q' + index],
                    GroupDelayPEQPlugin.Q_RANGE.minimum,
                    GroupDelayPEQPlugin.Q_RANGE.maximum,
                    this['q' + index]
                );
            }
            if (params['e' + index] !== undefined) this['e' + index] = Boolean(params['e' + index]);
        }
        // A smaller tap count shortens the filter, so stored delays may no longer fit.
        this._clampDelaysToLimit();
        this.updateParameters();
        const next = this._designSignature();
        if (previous !== next) this._scheduleDesign(150);
        else if (previousLatency !== this.lt && this._lastDesign) this._stageDesign(this._lastDesign);
        if (syncUi) this.setUIValues();
        this.updateResponse();
        this.updateMarkers();
        this._renderDetails();
    }

    /**
     * Every band type uses the same three values, so a type change only reschedules
     * the design: there is no per-type control row to enable or disable.
     */
    setBand(index, values = {}) {
        if (!Number.isInteger(index) || index < 0 || index >= GroupDelayPEQPlugin.BANDS.length) return;
        const parameters = {};
        if (values.type !== undefined) parameters['t' + index] = values.type;
        if (values.frequency !== undefined) parameters['f' + index] = values.frequency;
        if (values.delayMs !== undefined) parameters['d' + index] = values.delayMs;
        if (values.q !== undefined) parameters['q' + index] = values.q;
        if (values.enabled !== undefined) parameters['e' + index] = values.enabled;
        this.setParameters(parameters, false);
    }

    _designSignature() {
        return JSON.stringify([
            this._bands(), this.tp, this._sampleRate, this._outputChannelCount, this.channel
        ]);
    }

    _designConfig(sampleRate = this._sampleRate) {
        return { bands: this._bands(), taps: this.tp, sampleRate };
    }

    onChannelSelectionChanged() {
        this._scheduleDesign(0);
    }

    async _getRuntime() {
        if (!this._runtimePromise) {
            this._runtimePromise = Promise.all([
                import('../../js/group-delay-peq/designer.js'),
                import('../../js/group-delay-peq/design-core.js'),
                import('../../js/ir-library/ir-asset-payload.js'),
                import('../../js/ir-library/ir-plugin-contract.js')
            ]).then(([designer, design, payload, contract]) => {
                this._runtime = { ...designer, ...design, ...payload, ...contract };
                return this._runtime;
            });
        }
        return this._runtimePromise;
    }

    _scheduleDesign(delay = 150) {
        if (this._disposed) return;
        if (this._designTimer !== null) clearTimeout(this._designTimer);
        const generation = ++this._designGeneration;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._candidateWarning = null;
        this.updateParameters();
        if (this._hasDelay()) {
            this._setStatus(this._t('groupDelayPeq.status.designing', 'Designing filter…'), 'preparing');
        }
        this._designTimer = setTimeout(() => {
            if (this._disposed || generation !== this._designGeneration) return;
            this._designTimer = null;
            this._designAndStage(generation);
        }, delay);
    }

    _settleFlat(generation) {
        if (this._disposed || generation !== this._designGeneration) return false;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._candidateWarning = null;
        this._lastDesign = null;
        this._assetState = 0;
        this.clearWasmAsset(0);
        this._updatePowerGainBound(null);
        this.updateParameters();
        this._setStatus(this._t('groupDelayPeq.status.flat',
            'All bands are at 0 ms, so audio passes through unchanged.'), '');
        this._renderDetails();
        this.setUIValues();
        this.updateResponse();
        this.updateMarkers();
        return true;
    }

    async _designAndStage(generation) {
        try {
            if (this._disposed || generation !== this._designGeneration) return false;
            if (!this._hasDelay()) return this._settleFlat(generation);
            const runtime = await this._getRuntime();
            if (this._disposed || generation !== this._designGeneration) return false;
            if (!this._designer) {
                const designer = runtime.createGroupDelayPeqDesigner();
                if (this._disposed || generation !== this._designGeneration) {
                    designer?.close?.();
                    return false;
                }
                this._designer = designer;
            }
            const designer = this._designer;
            const result = await designer.design(this._designConfig());
            if (this._disposed || generation !== this._designGeneration || designer !== this._designer) {
                return false;
            }
            this._lastDesign = result;
            this._candidateWarning = this._qualityWarning(result);
            // Show what was designed before handing it to the engine, so the graph does
            // not wait for the asset to be admitted.
            this._renderDetails();
            this.setUIValues();
            this.updateResponse();
            this.updateMarkers();
            return await this._stageDesign(result, generation);
        } catch (error) {
            if (this._disposed || generation !== this._designGeneration) return false;
            console.error('Group Delay PEQ design failed:', error);
            this.updateParameters();
            this._setStatus(this._t('groupDelayPeq.error.design',
                'The filter could not be designed. Try a different Taps setting.'), 'error');
            return false;
        }
    }

    _qualityWarning(result) {
        if (result.clamped) {
            return this._t('groupDelayPeq.warning.clamped',
                'This Taps setting cannot reach the requested delay. The filter uses up to {limit} ms.',
                { limit: result.limitMs.toFixed(1) });
        }
        if (result.rippleDb > GroupDelayPEQPlugin.RIPPLE_WARNING_DB) {
            return this._t('groupDelayPeq.warning.accuracy',
                'The filter cannot follow these settings closely. Increase Taps or reduce Q.');
        }
        return null;
    }

    async _stageDesign(result, generation = this._designGeneration) {
        try {
            if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
                return false;
            }
            this._candidateAssetRevision = null;
            this._effectiveAssetRevision = null;
            this._assetState = 1;
            this.updateParameters();
            const runtime = await this._getRuntime();
            if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
                return false;
            }
            const channels = runtime.selectedIrChannelCount(this.channel, this._outputChannelCount);
            const footprintBytes = runtime.estimateIrKernelCommitFootprint({
                frames: this.tp,
                assetChannels: 1,
                topology: runtime.IR_ASSET_TOPOLOGY.mono,
                processingChannels: channels,
                headBlock: Number(this.lt)
            });
            const operationRevision = this.setWasmAsset(0, {
                payload: result.payload,
                formatTag: 1,
                headBlock: Number(this.lt),
                rateDivider: 1,
                pathCount: 0,
                inputCount: 0,
                processingChannels: channels,
                footprintBytes,
                externalAssetSignature: this._externalAssetSignature()
            });
            if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
                return false;
            }
            this._candidateAssetRevision = operationRevision;
            this._updatePowerGainBound(result.payload);
            this._renderDetails();
            return true;
        } catch (error) {
            if (this._disposed || generation !== this._designGeneration) return false;
            console.error('Group Delay PEQ asset staging failed:', error);
            this._candidateAssetRevision = null;
            this.updateParameters();
            this._setStatus(this._t('groupDelayPeq.error.design',
                'The filter could not be designed. Try a different Taps setting.'), 'error');
            return false;
        }
    }

    _externalAssetSignature({
        sampleRate = this._sampleRate,
        outputChannelCount = this._outputChannelCount
    } = {}) {
        return JSON.stringify([
            1, this._designConfig(sampleRate), this.lt, this.channel, outputChannelCount
        ]);
    }

    _updatePowerGainBound(payload = this._lastDesign?.payload) {
        if (!(payload instanceof ArrayBuffer) || payload.byteLength < 32 + this.tp * 4) {
            this.powerGainUpperBoundDb = 0;
            return;
        }
        const samples = new Float32Array(payload, 32);
        let sum = 0;
        for (let index = 0; index < this.tp; index += 1) {
            const value = samples[index];
            sum += value < 0 ? -value : value;
        }
        this.powerGainUpperBoundDb = 20 * Math.log10(sum > 1 ? sum : 1);
    }

    get offlineDspAssetRequired() {
        return this.isOfflineDspAssetRequired();
    }

    isOfflineDspAssetRequired() {
        return this._hasDelay();
    }

    _offlineStaleError() {
        const error = new Error('Group Delay PEQ settings changed during offline filter preparation.');
        error.userMessageKey = this.offlineDspAssetErrorMessageKey;
        return error;
    }

    async createOfflineDspState({
        sampleRate,
        outputChannelCount,
        isCurrent = () => true
    } = {}) {
        const snapshot = {
            generation: this._designGeneration,
            config: this._designConfig(sampleRate),
            latency: this.lt,
            channel: this.channel,
            baseParameters: { ...super.getParameters() }
        };
        const operationCurrent = () => !this._disposed && isCurrent() &&
            snapshot.generation === this._designGeneration;
        const parameters = {
            ...snapshot.baseParameters,
            lt: snapshot.latency,
            fd: snapshot.config.taps / 2
        };
        if (!operationCurrent()) throw this._offlineStaleError();
        if (!snapshot.config.bands.some(band => band.enabled && band.delayMs !== 0)) {
            return { parameters, assets: new Map(), offlineDspAssetRequired: false };
        }
        const runtime = await this._getRuntime();
        if (!operationCurrent()) throw this._offlineStaleError();
        const designer = runtime.createGroupDelayPeqDesigner();
        let designed;
        try {
            designed = await designer.design(snapshot.config);
        } finally {
            designer.close();
        }
        if (!operationCurrent()) throw this._offlineStaleError();
        const processingChannels = runtime.selectedIrChannelCount(snapshot.channel, outputChannelCount);
        const footprintBytes = runtime.estimateIrKernelCommitFootprint({
            frames: snapshot.config.taps,
            assetChannels: 1,
            topology: runtime.IR_ASSET_TOPOLOGY.mono,
            processingChannels,
            headBlock: Number(snapshot.latency)
        });
        return {
            parameters,
            assets: new Map([[0, {
                payload: designed.payload,
                formatTag: 1,
                headBlock: Number(snapshot.latency),
                rateDivider: 1,
                pathCount: 0,
                inputCount: 0,
                processingChannels,
                footprintBytes,
                warmupSamples: Number(snapshot.latency) + snapshot.config.taps / 2,
                externalAssetSignature: this._externalAssetSignature({
                    sampleRate,
                    outputChannelCount
                })
            }]]),
            offlineDspAssetRequired: true
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
            this._effectiveAssetRevision = operationRevision;
            this._candidateAssetRevision = null;
            this.updateParameters();
            this._setStatus(this._candidateWarning ||
                this._t('groupDelayPeq.status.ready', 'The filter is ready.'),
            this._candidateWarning ? 'warning' : 'ready');
        } else if (status === 4) {
            this._candidateAssetRevision = null;
            this._effectiveAssetRevision = null;
            this._candidateWarning = null;
            this.updateParameters();
            this._setStatus(this._t('groupDelayPeq.error.prepare',
                'The filter could not be prepared. Try fewer taps or a higher latency.'), 'error');
        }
        this._renderDetails();
    }

    onWasmAssetRejected(slot, reason, operationRevision) {
        if (this._disposed || slot !== 0 || operationRevision !== this._candidateAssetRevision) return;
        console.warn('Group Delay PEQ asset admission rejected:', reason);
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._candidateWarning = null;
        this._assetState = 4;
        this.updateParameters();
        this._setStatus(this._t('groupDelayPeq.error.prepare',
            'The filter could not be prepared. Try fewer taps or a higher latency.'), 'error');
        this._renderDetails();
    }

    onMessage(message) {
        if (this._disposed) return;
        if (Number.isFinite(message.sampleRate) && message.sampleRate > 0 &&
            message.sampleRate !== this._sampleRate) {
            this._sampleRate = message.sampleRate;
            this._clampDelaysToLimit();
            this._scheduleDesign(0);
            this.setUIValues();
            this.updateResponse();
            this.updateMarkers();
        }
        if (message.type === 'dspExecutionState' && message.pluginId === this.id &&
            message.validated === true) {
            this.executionState = { state: message.state, reason: message.reason || null };
            this._renderStatusMessage();
        }
    }

    _executionStatusText() {
        if (this.executionState.state !== 'bypassed') return '';
        const messages = {
            unsupportedSampleRate: ['groupDelayPeq.error.unsupportedSampleRate',
                'This sample rate is not supported. Group Delay PEQ is bypassed.'],
            wasmUnavailable: ['groupDelayPeq.error.wasmUnavailable',
                'WASM audio processing is unavailable. Group Delay PEQ is bypassed.'],
            rolloutDisabled: ['groupDelayPeq.error.rolloutDisabled',
                'DSP processing is disabled. Group Delay PEQ is bypassed.'],
            runtimeFallback: ['groupDelayPeq.error.runtimeFallback',
                'Audio processing was interrupted. Group Delay PEQ is bypassed.']
        };
        const entry = messages[this.executionState.reason];
        return entry ? this._t(entry[0], entry[1]) : '';
    }

    _setStatus(message, state = '') {
        if (this._disposed) return;
        this._statusMessage = message;
        this._statusState = state;
        this._renderStatusMessage();
    }

    _renderStatusMessage() {
        if (this._disposed || !this._statusElement) return;
        const executionMessage = this._executionStatusText();
        this._statusElement.textContent = executionMessage || this._statusMessage || '';
        this._statusElement.dataset.state = executionMessage ? 'error' : this._statusState || '';
    }

    _renderDetails() {
        if (this._disposed || !this._detailsElement) return;
        const active = Boolean(this._lastDesign) && this._hasDelay();
        const samples = active ? Number(this.lt) + this.tp / 2 : 0;
        this._detailsElement.textContent = this._t(
            'groupDelayPeq.status.details',
            'Latency {samples} samples / {milliseconds} ms · Ripple {ripple} dB',
            {
                samples,
                milliseconds: (samples * 1000 / this._sampleRate).toFixed(1),
                ripple: (active ? this._lastDesign.rippleDb : 0).toFixed(2)
            }
        );
    }

    createUI() {
        this.disconnectGraphResizeObserver();
        const container = document.createElement('div');
        container.className = 'group-delay-peq-plugin-ui plugin-parameter-ui';
        container.id = `group-delay-peq-container-${this.id}`;

        const settings = document.createElement('div');
        settings.className = 'group-delay-peq-settings';
        settings.appendChild(this.createSelectControl(
            this._t('groupDelayPeq.parameter.taps', 'Taps'),
            GroupDelayPEQPlugin.TAPS_CHOICES.map(value => ({ value: String(value), label: String(value) })),
            String(this.tp),
            value => this.setParameters({ tp: Number(value) }),
            'tp'
        ));
        settings.appendChild(this.createSelectControl(
            this._t('groupDelayPeq.parameter.latency', 'Latency'),
            GroupDelayPEQPlugin.LATENCY_CHOICES.map(value => ({ value, label: `${value} samples` })),
            this.lt,
            value => this.setParameters({ lt: value }),
            'lt'
        ));
        container.appendChild(settings);

        const graphContainer = document.createElement('div');
        graphContainer.className = 'group-delay-peq-graph';
        const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        gridSvg.setAttribute('class', 'group-delay-peq-grid');
        gridSvg.setAttribute('width', '100%');
        gridSvg.setAttribute('height', '100%');
        graphContainer.appendChild(gridSvg);

        const responseSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        responseSvg.setAttribute('class', 'group-delay-peq-response');
        responseSvg.setAttribute('width', '100%');
        responseSvg.setAttribute('height', '100%');
        graphContainer.appendChild(responseSvg);

        const legend = document.createElement('div');
        legend.className = 'group-delay-peq-legend';
        for (const [className, label] of [
            ['group-delay-peq-legend-target', this._t('groupDelayPeq.graph.target', 'Target')],
            ['group-delay-peq-legend-realized', this._t('groupDelayPeq.graph.realized', 'Realized')]
        ]) {
            const item = document.createElement('span');
            item.className = `group-delay-peq-legend-item ${className}`;
            const swatch = document.createElement('span');
            swatch.className = 'group-delay-peq-legend-swatch';
            swatch.setAttribute('aria-hidden', 'true');
            item.append(swatch, document.createTextNode(label));
            legend.appendChild(item);
        }
        graphContainer.appendChild(legend);

        const markers = [];
        for (let index = 0; index < GroupDelayPEQPlugin.BANDS.length; index += 1) {
            markers.push(this._createMarker(index, graphContainer));
        }
        container.appendChild(graphContainer);

        const controls = document.createElement('div');
        controls.className = 'group-delay-peq-controls';
        for (let index = 0; index < GroupDelayPEQPlugin.BANDS.length; index += 1) {
            controls.appendChild(this._createBandControls(index));
        }
        container.appendChild(controls);

        const statusLine = document.createElement('div');
        statusLine.className = 'group-delay-peq-status-line';
        const status = document.createElement('div');
        status.className = 'group-delay-peq-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const details = document.createElement('div');
        details.className = 'group-delay-peq-details';
        statusLine.append(status, details);
        container.appendChild(statusLine);

        this.uiContainer = container;
        this.graphContainer = graphContainer;
        this.gridSvg = gridSvg;
        this.responseSvg = responseSvg;
        this.markers = markers;
        this._statusElement = status;
        this._detailsElement = details;
        this.uiCreated = true;
        this.observeGraphResize(graphContainer);
        this.setUIValues();
        if (!this._statusMessage) {
            this._setStatus(this._t('groupDelayPeq.status.flat',
                'All bands are at 0 ms, so audio passes through unchanged.'), '');
        } else {
            this._renderStatusMessage();
        }
        this._renderDetails();
        this._renderGrid();
        setTimeout(() => {
            this.updateResponse();
            this.updateMarkers();
        }, 0);
        // The target curve needs the design module, so redraw once it has loaded.
        // Without this hook a flat plugin, which never designs, would show no curve.
        this._getRuntime().then(() => {
            if (this._disposed) return;
            this.updateResponse();
            this.updateMarkers();
        }).catch(error => console.error('Group Delay PEQ runtime failed to load:', error));
        return container;
    }

    _createMarker(index, graphContainer) {
        const marker = document.createElement('div');
        marker.className = 'group-delay-peq-marker';
        marker.dataset.band = String(index);
        marker.textContent = String(index + 1);
        const markerText = document.createElement('div');
        markerText.className = 'group-delay-peq-marker-text';
        marker.appendChild(markerText);
        const startDrag = (clientX, clientY) => {
            this.activeDragMarker = index;
            this.initialDragX = clientX;
            this.initialDragY = clientY;
            this.hasMoved = false;
            this._dragScaleExpansions = 0;
            marker.classList.add('active');
        };
        marker.addEventListener('mousedown', event => {
            event.preventDefault();
            startDrag(event.clientX, event.clientY);
            this.boundMouseMoveHandler = moveEvent => this.handleDragMove(moveEvent);
            this.boundMouseUpHandler = () => this.handleDragEnd();
            document.addEventListener('mousemove', this.boundMouseMoveHandler);
            document.addEventListener('mouseup', this.boundMouseUpHandler);
        });
        marker.addEventListener('touchstart', event => {
            const touch = event.touches[0];
            if (!touch) return;
            event.preventDefault();
            startDrag(touch.clientX, touch.clientY);
        }, { passive: false });
        marker.addEventListener('touchmove', event => {
            const touch = event.touches[0];
            if (!touch) return;
            event.preventDefault();
            this.handleDragMove(touch);
        }, { passive: false });
        marker.addEventListener('touchend', () => this.handleDragEnd());
        graphContainer.appendChild(marker);
        return marker;
    }

    _createBandControls(index) {
        const band = document.createElement('div');
        band.className = 'group-delay-peq-band';
        band.dataset.band = String(index);
        band.dataset.pluginId = this.id;

        const heading = document.createElement('label');
        heading.className = 'group-delay-peq-band-label';
        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.className = 'group-delay-peq-band-checkbox';
        enabled.checked = this['e' + index];
        enabled.addEventListener('change', () => this.setBand(index, { enabled: enabled.checked }));
        heading.append(enabled, this._t('groupDelayPeq.band.label', 'Band {number}', { number: index + 1 }));
        band.appendChild(heading);

        const type = document.createElement('select');
        type.className = 'group-delay-peq-band-type';
        for (const bandType of GroupDelayPEQPlugin.BAND_TYPES) {
            const option = document.createElement('option');
            option.value = bandType.id;
            option.textContent = this._t(bandType.key, bandType.name);
            type.appendChild(option);
        }
        type.value = this['t' + index];
        // Every type shares the same (frequency, delay, Q) controls, so nothing else
        // has to change here.
        type.addEventListener('change', () => this.setBand(index, { type: type.value }));
        band.appendChild(this._controlRow(this._t('groupDelayPeq.parameter.type', 'Type:'), type, 'type'));

        const frequency = document.createElement('input');
        frequency.type = 'number';
        frequency.className = 'group-delay-peq-freq-text';
        frequency.min = '20';
        frequency.max = '20000';
        frequency.step = '1';
        frequency.value = this['f' + index].toFixed(0);
        frequency.autocomplete = 'off';
        frequency.addEventListener('input', () => this.setBand(index, { frequency: Number(frequency.value) }));
        frequency.addEventListener('change', () => {
            frequency.value = this['f' + index].toFixed(0);
        });
        band.appendChild(this._controlRow(
            this._t('groupDelayPeq.parameter.frequency', 'Freq (Hz):'), frequency, 'freq'
        ));

        const limit = this._delayLimitMs();
        const delay = document.createElement('input');
        delay.type = 'number';
        delay.className = 'group-delay-peq-delay-text';
        delay.min = String(-limit);
        delay.max = String(limit);
        delay.step = '0.1';
        delay.value = this['d' + index].toFixed(1);
        delay.autocomplete = 'off';
        delay.addEventListener('input', () => this.setBand(index, { delayMs: Number(delay.value) }));
        delay.addEventListener('change', () => {
            delay.value = this['d' + index].toFixed(1);
        });
        band.appendChild(this._controlRow(
            this._t('groupDelayPeq.parameter.delay', 'Delay (ms):'), delay, 'delay'
        ));

        const { minimum, maximum } = GroupDelayPEQPlugin.Q_RANGE;
        const q = document.createElement('input');
        q.type = 'number';
        q.className = 'group-delay-peq-q-text';
        q.min = String(minimum);
        q.max = String(maximum);
        q.step = '0.01';
        q.value = this['q' + index].toFixed(2);
        q.autocomplete = 'off';
        const qSlider = document.createElement('input');
        qSlider.type = 'range';
        qSlider.className = 'group-delay-peq-q-slider';
        qSlider.min = '0';
        qSlider.max = '100';
        qSlider.step = '0.1';
        qSlider.value = String(GroupDelayPEQPlugin._logSliderPosition(this['q' + index], minimum, maximum));
        qSlider.autocomplete = 'off';
        qSlider.setAttribute('aria-valuetext', this['q' + index].toFixed(2));
        const updateQ = value => {
            this.setBand(index, { q: Number(value) });
            const formatted = this['q' + index].toFixed(2);
            qSlider.value = String(GroupDelayPEQPlugin._logSliderPosition(
                this['q' + index], minimum, maximum
            ));
            qSlider.setAttribute('aria-valuetext', formatted);
            if (!this.isHeldByUser(q)) q.value = formatted;
        };
        qSlider.addEventListener('input', () => updateQ(
            GroupDelayPEQPlugin._valueFromLogSliderPosition(qSlider.value, minimum, maximum)
        ));
        q.addEventListener('input', () => updateQ(q.value));
        q.addEventListener('change', () => {
            q.value = this['q' + index].toFixed(2);
        });
        const qRow = this._controlRow(this._t('groupDelayPeq.parameter.q', 'Q:'), qSlider, 'q');
        qRow.appendChild(q);
        band.appendChild(qRow);
        return band;
    }

    _controlRow(labelText, input, kind) {
        const row = document.createElement('div');
        row.className = `group-delay-peq-${kind}-row`;
        const label = document.createElement('label');
        label.className = `group-delay-peq-${kind}-label`;
        label.textContent = labelText;
        row.append(label, input);
        return row;
    }

    setUIValues() {
        if (!this.uiCreated || !this.uiContainer) return;
        for (let index = 0; index < GroupDelayPEQPlugin.BANDS.length; index += 1) {
            this.setUIBandValues(index);
        }
    }

    setUIBandValues(index) {
        const band = this.uiContainer?.querySelector(`.group-delay-peq-band[data-band="${index}"]`);
        if (!band) return;
        const checkbox = band.querySelector('.group-delay-peq-band-checkbox');
        const type = band.querySelector('.group-delay-peq-band-type');
        const frequency = band.querySelector('.group-delay-peq-freq-text');
        const delay = band.querySelector('.group-delay-peq-delay-text');
        const qSlider = band.querySelector('.group-delay-peq-q-slider');
        const q = band.querySelector('.group-delay-peq-q-text');
        const limit = this._delayLimitMs();
        if (checkbox) checkbox.checked = this['e' + index];
        if (type) type.value = this['t' + index];
        if (frequency && !this.isHeldByUser(frequency)) {
            frequency.value = this['f' + index].toFixed(0);
        }
        if (delay) {
            delay.min = String(-limit);
            delay.max = String(limit);
            if (!this.isHeldByUser(delay)) delay.value = this['d' + index].toFixed(1);
        }
        if (qSlider && !this.isHeldByUser(qSlider)) {
            qSlider.value = String(GroupDelayPEQPlugin._logSliderPosition(
                this['q' + index],
                GroupDelayPEQPlugin.Q_RANGE.minimum,
                GroupDelayPEQPlugin.Q_RANGE.maximum
            ));
            qSlider.setAttribute?.('aria-valuetext', this['q' + index].toFixed(2));
        }
        if (q && !this.isHeldByUser(q)) q.value = this['q' + index].toFixed(2);
    }

    freqToX(frequency) {
        const { minimum, maximum } = GroupDelayPEQPlugin.GRAPH_FREQUENCY_RANGE;
        const clamped = Math.max(minimum, Math.min(frequency, maximum));
        return (Math.log10(clamped) - Math.log10(minimum)) /
            (Math.log10(maximum) - Math.log10(minimum)) * 100;
    }

    xToFreq(percent) {
        const { minimum, maximum } = GroupDelayPEQPlugin.GRAPH_FREQUENCY_RANGE;
        return 10 ** (Math.log10(minimum) +
            percent / 100 * (Math.log10(maximum) - Math.log10(minimum)));
    }

    delayToY(milliseconds) {
        return 50 - milliseconds / this._scale.range * 50;
    }

    yToDelay(percent) {
        return (50 - percent) / 50 * this._scale.range;
    }

    /**
     * Graph scale: the smallest grid that still covers the current settings.
     *
     * The peak comes from three sources because none of them alone is enough. The
     * band delays are the marker values, and a narrow high-Q shape can sit between
     * two curve samples, so without them a marker would be drawn outside the plot.
     * Every band counts here, disabled ones included, because a marker is drawn for
     * every band while only enabled bands reach the curves.
     * The target curve is needed because overlapping bands add up past the largest
     * single delay. The realized curve keeps what the filter actually does visible.
     */
    _graphScale(targetMs = null, realizedMs = null) {
        let peak = GroupDelayPEQPlugin.MINIMUM_GRAPH_RANGE_MS;
        const consider = value => {
            const magnitude = value < 0 ? -value : value;
            if (magnitude > peak) peak = magnitude;
        };
        for (const band of this._bands()) consider(band.delayMs);
        if (targetMs) for (const value of targetMs) consider(value);
        if (realizedMs) for (const value of realizedMs) consider(value);
        const steps = GroupDelayPEQPlugin.GRID_STEPS_MS;
        const gridStep = steps.find(step => step * 5 >= peak) || steps[steps.length - 1];
        return { range: gridStep * 5, gridStep };
    }

    /**
     * A drag never shrinks the scale. Reaching the top or bottom of the plot widens
     * the grid by one step instead, so dragging alone reaches the whole delay range.
     */
    _expandGraphScale() {
        const steps = GroupDelayPEQPlugin.GRID_STEPS_MS;
        const position = steps.indexOf(this._scale.gridStep);
        if (position < 0 || position >= steps.length - 1) return false;
        const gridStep = steps[position + 1];
        this._scale = { range: gridStep * 5, gridStep };
        return true;
    }

    /**
     * How far a drag has widened the scale is a function of how far the pointer has
     * travelled past the plot edge, never of how many mousemove events arrived on
     * the way. Every step costs EDGE_EXPAND_STEP_PX outwards, the first one included:
     * a marker whose delay equals the current range is drawn on the edge itself, so
     * grabbing it puts the pointer at zero overshoot and a free first step would
     * widen the scale — and with it the delay under the pointer — on a drag that
     * never leaves the plot. Holding still cannot widen the scale again either,
     * while a long drag still reaches the whole delay range.
     */
    _expandGraphScaleForDrag(overshootPx) {
        if (!(overshootPx >= 0)) return false;
        const wanted = Math.floor(overshootPx / GroupDelayPEQPlugin.EDGE_EXPAND_STEP_PX);
        let expanded = false;
        while (this._dragScaleExpansions < wanted && this._expandGraphScale()) {
            this._dragScaleExpansions += 1;
            expanded = true;
        }
        return expanded;
    }

    _applyGraphScale(targetMs, realizedMs) {
        if (this.activeDragMarker !== null) return false;
        const next = this._graphScale(targetMs, realizedMs);
        if (next.range === this._scale.range && next.gridStep === this._scale.gridStep) return false;
        this._scale = next;
        return true;
    }

    /** Drawing grid over the whole x axis, separate from the 128 point measurement grid. */
    _drawFrequencies(width) {
        const { minimum, maximum } = GroupDelayPEQPlugin.GRAPH_FREQUENCY_RANGE;
        const count = Math.max(200, Math.round(width / 2));
        if (this._drawGrid?.count === count) return this._drawGrid.frequencies;
        const frequencies = new Float64Array(count + 1);
        const span = maximum / minimum;
        for (let point = 0; point <= count; point += 1) {
            frequencies[point] = minimum * span ** (point / count);
        }
        this._drawGrid = { count, frequencies };
        return frequencies;
    }

    _renderGrid() {
        if (!this.gridSvg) return;
        this.gridSvg.replaceChildren();
        const namespace = 'http://www.w3.org/2000/svg';
        for (const frequency of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
            const x = this.freqToX(frequency);
            const line = document.createElementNS(namespace, 'line');
            line.setAttribute('x1', `${x}%`);
            line.setAttribute('x2', `${x}%`);
            line.setAttribute('y1', '0');
            line.setAttribute('y2', '100%');
            this.gridSvg.appendChild(line);
            const text = document.createElementNS(namespace, 'text');
            text.setAttribute('x', `${x}%`);
            text.setAttribute('y', '95%');
            text.setAttribute('text-anchor', 'middle');
            text.textContent = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
            this.gridSvg.appendChild(text);
        }
        const { range, gridStep } = this._scale;
        const lines = Math.floor(range / gridStep);
        for (let line = -lines; line <= lines; line += 1) {
            const milliseconds = line * gridStep;
            const y = this.delayToY(milliseconds);
            const element = document.createElementNS(namespace, 'line');
            element.setAttribute('x1', '0');
            element.setAttribute('x2', '100%');
            element.setAttribute('y1', `${y}%`);
            element.setAttribute('y2', `${y}%`);
            this.gridSvg.appendChild(element);
            // The outermost lines sit on the top and bottom edges of the plot, where a
            // centred label would be cut in half by the SVG viewport, so they are drawn
            // without one.
            if (Math.abs(milliseconds) >= range * 0.98) continue;
            const text = document.createElementNS(namespace, 'text');
            text.setAttribute('x', '2%');
            text.setAttribute('y', `${y}%`);
            text.setAttribute('dominant-baseline', 'middle');
            text.textContent = `${Number(milliseconds.toFixed(1))}ms`;
            this.gridSvg.appendChild(text);
        }
    }

    getGraphPlotArea(container = this.graphContainer) {
        const margin = 20;
        const rect = container?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
        const width = container?.clientWidth || rect.width;
        const height = container?.clientHeight || rect.height;
        const marginX = width > margin * 2 ? margin : 0;
        const marginY = height > margin * 2 ? margin : 0;
        const plotWidth = width - marginX * 2;
        const plotHeight = height - marginY * 2;
        return {
            left: rect.left + marginX,
            top: rect.top + marginY,
            width: plotWidth > 0 ? plotWidth : width,
            height: plotHeight > 0 ? plotHeight : height,
            leftPercent: width > 0 ? marginX / width * 100 : 0,
            topPercent: height > 0 ? marginY / height * 100 : 0,
            widthPercent: width > 0 ? (plotWidth > 0 ? plotWidth : width) / width * 100 : 100,
            heightPercent: height > 0 ? (plotHeight > 0 ? plotHeight : height) / height * 100 : 100
        };
    }

    updateMarkers() {
        if (!this.uiCreated || !this.markers || !this.graphContainer) return;
        const plot = this.getGraphPlotArea();
        const width = this.graphContainer.clientWidth;
        const height = this.graphContainer.clientHeight;
        if (!width || !height) return;
        const labelItems = [];
        for (let index = 0; index < GroupDelayPEQPlugin.BANDS.length; index += 1) {
            const marker = this.markers[index];
            if (!marker) continue;
            const frequency = this['f' + index];
            const delay = this['d' + index];
            const x = plot.leftPercent + this.freqToX(frequency) / 100 * plot.widthPercent;
            const y = plot.topPercent + this.delayToY(delay) / 100 * plot.heightPercent;
            marker.style.left = `${x}%`;
            marker.style.top = `${y}%`;
            marker.classList.toggle('disabled', !this['e' + index]);
            const text = marker.querySelector('.group-delay-peq-marker-text');
            if (!text) continue;
            text.className = 'group-delay-peq-marker-text';
            const frequencyText = frequency >= 1000
                ? `${(frequency / 1000).toFixed(1)}kHz`
                : `${frequency.toFixed(0)}Hz`;
            text.replaceChildren(
                document.createTextNode(frequencyText),
                document.createElement('br'),
                document.createTextNode(`${delay > 0 ? '+' : ''}${delay.toFixed(1)}ms`)
            );
            labelItems.push({ el: text, cx: x / 100 * width, cy: y / 100 * height });
        }
        this.layoutMarkerLabels?.({ items: labelItems, width, height, axis: 'horizontal' });
    }

    updateResponse() {
        if (!this.uiCreated || !this.responseSvg?.clientWidth || !this.responseSvg.clientHeight) return;
        const width = this.responseSvg.clientWidth;
        const height = this.responseSvg.clientHeight;
        this.responseSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        this.responseSvg.setAttribute('preserveAspectRatio', 'none');

        const runtime = this._runtime;
        const frequencies = runtime ? this._drawFrequencies(width) : null;
        const targetMs = frequencies
            ? runtime.groupDelayPeqTargetMs({
                bands: this._bands(),
                taps: this.tp,
                sampleRate: this._sampleRate,
                frequencies
            })
            : null;
        // The realized curve describes the designed filter, so it is shown as soon as a
        // design exists and stays visible while the next one is being designed. It only
        // goes away when the settings turn flat, which clears the design.
        const realized = this._lastDesign?.response;
        const realizedMs = realized?.frequencies?.length &&
            realized.realizedMs?.length === realized.frequencies.length
            ? realized
            : null;

        // Grid, curves and markers are redrawn from one scale snapshot.
        if (this._applyGraphScale(targetMs, realizedMs?.realizedMs)) {
            this._renderGrid();
            this.updateMarkers();
        }

        this.responseSvg.replaceChildren();
        const appendPath = (commands, className, stroke, strokeWidth) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', className);
            path.setAttribute('d', commands.join(' '));
            path.setAttribute('stroke', stroke);
            path.setAttribute('stroke-width', strokeWidth);
            path.setAttribute('fill', 'none');
            this.responseSvg.appendChild(path);
        };
        const commandsFor = (grid, values) => {
            const commands = [];
            for (let point = 0; point < grid.length; point += 1) {
                const x = this.freqToX(grid[point]) * width / 100;
                const y = this.delayToY(values[point]) * height / 100;
                commands.push(`${point === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`);
            }
            return commands;
        };
        if (targetMs) {
            appendPath(
                commandsFor(frequencies, targetMs),
                'group-delay-peq-target-response',
                'rgba(176, 176, 176, 0.7)',
                '1'
            );
        }
        if (realizedMs) {
            appendPath(
                commandsFor(realizedMs.frequencies, realizedMs.realizedMs),
                'group-delay-peq-realized-response',
                '#00ff00',
                '1'
            );
        }
    }

    handleDragMove(event) {
        if (this.activeDragMarker === null || !this.graphContainer) return;
        if (!this.hasMoved) {
            const xDifference = Math.abs(event.clientX - this.initialDragX);
            const yDifference = Math.abs(event.clientY - this.initialDragY);
            if (xDifference < 3 && yDifference < 3) return;
            this.hasMoved = true;
        }
        const plot = this.getGraphPlotArea();
        let x = (event.clientX - plot.left) / plot.width;
        let y = (event.clientY - plot.top) / plot.height;
        const overshootPx = Math.max(
            plot.top - event.clientY, event.clientY - (plot.top + plot.height)
        );
        x = Math.max(0, Math.min(1, x));
        y = Math.max(0, Math.min(1, y));
        if (this._expandGraphScaleForDrag(overshootPx)) {
            this._renderGrid();
            this.updateResponse();
        }
        const band = this.activeDragMarker;
        this.setBand(band, { frequency: this.xToFreq(x * 100), delayMs: this.yToDelay(y * 100) });
        this.setUIBandValues(band);
    }

    handleDragEnd() {
        if (this.activeDragMarker === null) return;
        this.markers?.[this.activeDragMarker]?.classList.remove('active');
        this.activeDragMarker = null;
        this.hasMoved = false;
        this._dragScaleExpansions = 0;
        if (this.boundMouseMoveHandler) {
            document.removeEventListener('mousemove', this.boundMouseMoveHandler);
            document.removeEventListener('mouseup', this.boundMouseUpHandler);
            this.boundMouseMoveHandler = null;
            this.boundMouseUpHandler = null;
        }
        // The drag is over, so the scale is free to shrink again.
        this.updateResponse();
        this.updateMarkers();
    }

    observeGraphResize(container) {
        this.disconnectGraphResizeObserver();
        if (!container) return;
        this.lastGraphSize = { width: 0, height: 0 };
        const handleResize = () => {
            const rect = container.getBoundingClientRect?.() || { width: 0, height: 0 };
            const width = container.clientWidth || rect.width;
            const height = container.clientHeight || rect.height;
            if (!width || !height ||
                (width === this.lastGraphSize.width && height === this.lastGraphSize.height)) return;
            this.lastGraphSize = { width, height };
            this.updateResponse();
            this.updateMarkers();
        };
        const ResizeObserverClass = typeof ResizeObserver !== 'undefined'
            ? ResizeObserver
            : globalThis.window?.ResizeObserver;
        if (typeof ResizeObserverClass === 'function') {
            this.graphResizeObserver = new ResizeObserverClass(handleResize);
            this.graphResizeObserver.observe(container);
        } else if (globalThis.window?.addEventListener) {
            this.graphResizeWindowListener = handleResize;
            window.addEventListener('resize', handleResize);
        }
    }

    disconnectGraphResizeObserver() {
        this.graphResizeObserver?.disconnect();
        this.graphResizeObserver = null;
        if (this.graphResizeWindowListener && globalThis.window?.removeEventListener) {
            window.removeEventListener('resize', this.graphResizeWindowListener);
        }
        this.graphResizeWindowListener = null;
        this.lastGraphSize = null;
    }

    cleanup() {
        if (this._disposed) return;
        this._disposed = true;
        ++this._designGeneration;
        if (this._designTimer !== null) clearTimeout(this._designTimer);
        this._designTimer = null;
        this._designer?.close();
        this._designer = null;
        this.disconnectGraphResizeObserver();
        if (this.boundMouseMoveHandler) {
            document.removeEventListener('mousemove', this.boundMouseMoveHandler);
            document.removeEventListener('mouseup', this.boundMouseUpHandler);
        }
        this.boundMouseMoveHandler = null;
        this.boundMouseUpHandler = null;
        this.activeDragMarker = null;
        this.uiCreated = false;
        this.uiContainer = null;
        this.graphContainer = null;
        this.gridSvg = null;
        this.responseSvg = null;
        this.markers = null;
        this._statusElement = null;
        this._detailsElement = null;
        super.cleanup();
    }
}

if (typeof window !== 'undefined') {
    window.GroupDelayPEQPlugin = GroupDelayPEQPlugin;
}
