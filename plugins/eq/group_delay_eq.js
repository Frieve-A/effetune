class GroupDelayEqPlugin extends PluginBase {
    static BANDS = [
        { freq: 25, name: '25 Hz' },
        { freq: 40, name: '40 Hz' },
        { freq: 63, name: '63 Hz' },
        { freq: 100, name: '100 Hz' },
        { freq: 160, name: '160 Hz' },
        { freq: 250, name: '250 Hz' },
        { freq: 400, name: '400 Hz' },
        { freq: 630, name: '630 Hz' },
        { freq: 1000, name: '1.0 kHz' },
        { freq: 1600, name: '1.6 kHz' },
        { freq: 2500, name: '2.5 kHz' },
        { freq: 4000, name: '4.0 kHz' },
        { freq: 6300, name: '6.3 kHz' },
        { freq: 10000, name: '10 kHz' },
        { freq: 16000, name: '16 kHz' }
    ];

    static TAPS_CHOICES = [4096, 8192, 16384, 32768];
    static LATENCY_CHOICES = ['0', '128', '256', '512', '1024'];
    static GRID_STEPS_MS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100];
    static MINIMUM_GRAPH_RANGE_MS = 5;
    static RIPPLE_WARNING_DB = 0.3;

    constructor() {
        super('Group Delay EQ', 'All-pass FIR that sets the group delay of each band');
        for (let band = 0; band < GroupDelayEqPlugin.BANDS.length; band += 1) this['d' + band] = 0;
        this.tp = 16384;
        this.lt = '128';
        this.offlineDspAssetErrorMessageKey = 'groupDelayEq.error.design';
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
        this._sliders = [];
        this._valueDisplays = [];
        this._angleDisplays = [];
        this._graphCanvas = null;
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

    _delays() {
        return GroupDelayEqPlugin.BANDS.map((_, band) => this['d' + band]);
    }

    /**
     * Largest delay the designed filter can hold, which is the bulk delay minus the
     * design guard. The highest band realizes this value in full; lower bands need
     * more taps to follow it.
     */
    _delayLimitMs() {
        return Math.floor((this.tp / 2 - this.tp / 16) * 1000 / this._sampleRate * 10) / 10;
    }

    _clampDelaysToLimit() {
        const limit = this._delayLimitMs();
        for (let band = 0; band < GroupDelayEqPlugin.BANDS.length; band += 1) {
            const value = this['d' + band];
            if (value > limit) this['d' + band] = limit;
            else if (value < -limit) this['d' + band] = -limit;
        }
    }

    _hasDelay() {
        return this._delays().some(value => value !== 0);
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
        }
        const parameters = { ...this._packedParameters(), tp: this.tp };
        for (let band = 0; band < GroupDelayEqPlugin.BANDS.length; band += 1) {
            parameters['d' + band] = this['d' + band];
        }
        return parameters;
    }

    getSerializableParameters() {
        const serialized = super.getSerializableParameters();
        delete serialized.fd;
        return serialized;
    }

    setParameters(params = {}) {
        const previous = this._designSignature();
        const previousLatency = this.lt;
        super._setValidatedParameters(params);
        const taps = Number(params.tp);
        if (GroupDelayEqPlugin.TAPS_CHOICES.includes(taps)) this.tp = taps;
        if (GroupDelayEqPlugin.LATENCY_CHOICES.includes(String(params.lt))) this.lt = String(params.lt);
        const limit = this._delayLimitMs();
        for (let band = 0; band < GroupDelayEqPlugin.BANDS.length; band += 1) {
            const value = params['d' + band];
            if (value !== undefined) {
                this['d' + band] = this.parseFiniteNumber(value, -limit, limit, this['d' + band]);
            }
        }
        // A smaller tap count shortens the filter, so stored delays may no longer fit.
        this._clampDelaysToLimit();
        this.updateParameters();
        const next = this._designSignature();
        if (previous !== next) this._scheduleDesign(150);
        else if (previousLatency !== this.lt && this._lastDesign) this._stageDesign(this._lastDesign);
        this.setUIValues();
    }

    setBand(index, value) {
        this.setParameters({ ['d' + index]: value });
    }

    reset() {
        const params = {};
        for (let band = 0; band < GroupDelayEqPlugin.BANDS.length; band += 1) params['d' + band] = 0;
        this.setParameters(params);
    }

    _designSignature() {
        return JSON.stringify([
            this._delays(), this.tp, this._sampleRate, this._outputChannelCount, this.channel
        ]);
    }

    onChannelSelectionChanged() {
        this._scheduleDesign(0);
    }

    async _getRuntime() {
        if (!this._runtimePromise) {
            this._runtimePromise = Promise.all([
                import('../../js/group-delay-eq/designer.js'),
                import('../../js/group-delay-eq/design-core.js'),
                import('../../js/ir-library/ir-asset-payload.js'),
                import('../../js/ir-library/ir-plugin-contract.js')
            ]).then(([designer, design, payload, contract]) => {
                this._runtime = { ...designer, ...design, ...payload, ...contract };
                return this._runtime;
            });
        }
        return this._runtimePromise;
    }

    _designConfig(sampleRate = this._sampleRate) {
        return { delaysMs: this._delays(), taps: this.tp, sampleRate };
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
            this._setStatus(this._t('groupDelayEq.status.designing', 'Designing filter…'), 'preparing');
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
        this._setStatus(this._t('groupDelayEq.status.flat',
            'All bands are at 0 ms, so audio passes through unchanged.'), '');
        this._renderDetails();
        this.setUIValues();
        return true;
    }

    async _designAndStage(generation) {
        try {
            if (this._disposed || generation !== this._designGeneration) return false;
            if (!this._hasDelay()) return this._settleFlat(generation);
            const runtime = await this._getRuntime();
            if (this._disposed || generation !== this._designGeneration) return false;
            if (!this._designer) {
                const designer = runtime.createGroupDelayEqDesigner();
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
            return await this._stageDesign(result, generation);
        } catch (error) {
            if (this._disposed || generation !== this._designGeneration) return false;
            console.error('Group Delay EQ design failed:', error);
            this.updateParameters();
            this._setStatus(this._t('groupDelayEq.error.design',
                'The filter could not be designed. Try a different Taps setting.'), 'error');
            return false;
        }
    }

    _qualityWarning(result) {
        if (result.clamped) {
            return this._t('groupDelayEq.warning.clamped',
                'This Taps setting cannot reach the requested delay. The filter uses up to {limit} ms.',
                { limit: result.limitMs.toFixed(1) });
        }
        if (result.rippleDb > GroupDelayEqPlugin.RIPPLE_WARNING_DB) {
            return this._t('groupDelayEq.warning.accuracy',
                'The filter cannot follow these settings closely. Increase Taps or reduce the difference between neighbouring bands.');
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
            console.error('Group Delay EQ asset staging failed:', error);
            this._candidateAssetRevision = null;
            this.updateParameters();
            this._setStatus(this._t('groupDelayEq.error.design',
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
        const error = new Error('Group Delay EQ settings changed during offline filter preparation.');
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
        if (!snapshot.config.delaysMs.some(value => value !== 0)) {
            return { parameters, assets: new Map(), offlineDspAssetRequired: false };
        }
        const runtime = await this._getRuntime();
        if (!operationCurrent()) throw this._offlineStaleError();
        const designer = runtime.createGroupDelayEqDesigner();
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
                this._t('groupDelayEq.status.ready', 'The filter is ready.'),
            this._candidateWarning ? 'warning' : 'ready');
        } else if (status === 4) {
            this._candidateAssetRevision = null;
            this._effectiveAssetRevision = null;
            this._candidateWarning = null;
            this.updateParameters();
            this._setStatus(this._t('groupDelayEq.error.prepare',
                'The filter could not be prepared. Try fewer taps or a higher latency.'), 'error');
        }
        this._renderDetails();
    }

    onWasmAssetRejected(slot, reason, operationRevision) {
        if (this._disposed || slot !== 0 || operationRevision !== this._candidateAssetRevision) return;
        console.warn('Group Delay EQ asset admission rejected:', reason);
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._candidateWarning = null;
        this._assetState = 4;
        this.updateParameters();
        this._setStatus(this._t('groupDelayEq.error.prepare',
            'The filter could not be prepared. Try fewer taps or a higher latency.'), 'error');
        this._renderDetails();
    }

    onMessage(message) {
        if (this._disposed || message.type !== 'dspExecutionState' || message.pluginId !== this.id ||
            message.validated !== true) return;
        this.executionState = { state: message.state, reason: message.reason || null };
        this._renderStatusMessage();
    }

    _executionStatusText() {
        if (this.executionState.state !== 'bypassed') return '';
        const messages = {
            unsupportedSampleRate: ['groupDelayEq.error.unsupportedSampleRate',
                'This sample rate is not supported. Group Delay EQ is bypassed.'],
            wasmUnavailable: ['groupDelayEq.error.wasmUnavailable',
                'WASM audio processing is unavailable. Group Delay EQ is bypassed.'],
            rolloutDisabled: ['groupDelayEq.error.rolloutDisabled',
                'DSP processing is disabled. Group Delay EQ is bypassed.'],
            runtimeFallback: ['groupDelayEq.error.runtimeFallback',
                'Audio processing was interrupted. Group Delay EQ is bypassed.']
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
            'groupDelayEq.status.details',
            'Latency {samples} samples / {milliseconds} ms · Ripple {ripple} dB',
            {
                samples,
                milliseconds: (samples * 1000 / this._sampleRate).toFixed(1),
                ripple: (active ? this._lastDesign.rippleDb : 0).toFixed(2)
            }
        );
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui group-delay-eq-plugin-ui';

        container.appendChild(this.createSelectControl(
            this._t('groupDelayEq.parameter.taps', 'Taps'),
            GroupDelayEqPlugin.TAPS_CHOICES.map(value => ({ value: String(value), label: String(value) })),
            String(this.tp),
            value => this.setParameters({ tp: Number(value) })
        ));
        container.appendChild(this.createSelectControl(
            this._t('groupDelayEq.parameter.latency', 'Latency'),
            GroupDelayEqPlugin.LATENCY_CHOICES.map(value => ({
                value,
                label: `${value} samples`
            })),
            this.lt,
            value => this.setParameters({ lt: value })
        ));

        const slidersContainer = document.createElement('div');
        slidersContainer.className = 'sliders-container';
        this._sliders = [];
        this._valueDisplays = [];
        this._angleDisplays = [];
        const limit = this._delayLimitMs();

        GroupDelayEqPlugin.BANDS.forEach((band, index) => {
            const sliderContainer = document.createElement('div');
            sliderContainer.className = 'slider-container';

            const freqLabel = document.createElement('label');
            freqLabel.className = 'freq-label';
            freqLabel.textContent = band.name;
            const sliderId = `${this.id}-${this.name}-band-${index}-slider`;
            freqLabel.htmlFor = sliderId;

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'vertical-slider';
            slider.id = sliderId;
            slider.name = sliderId;
            slider.min = -limit;
            slider.max = limit;
            slider.step = 0.1;
            slider.value = this['d' + index];
            slider.autocomplete = 'off';
            this._sliders.push(slider);

            const valueDisplay = document.createElement('div');
            valueDisplay.className = 'value-display';
            valueDisplay.textContent = this._formatDelay(index);
            this._valueDisplays.push(valueDisplay);

            const angleDisplay = document.createElement('div');
            angleDisplay.className = 'value-display angle-display';
            angleDisplay.textContent = this._formatAngle(index);
            this._angleDisplays.push(angleDisplay);

            slider.addEventListener('input', event => {
                this.setBand(index, parseFloat(event.target.value));
            });
            slider.addEventListener('dblclick', () => this.setBand(index, 0));

            sliderContainer.append(freqLabel, slider, valueDisplay, angleDisplay);
            slidersContainer.appendChild(sliderContainer);
        });

        const { container: graphContainer, canvas } = this.createResponsiveGraph({
            maxWidth: 600,
            aspectRatio: '5 / 2',
            mobileAspectRatio: '2 / 1',
            className: 'group-delay-eq-graph-container',
            onResize: ({ canvas: resized }) => this.drawGraph(resized)
        });
        graphContainer.style.margin = '10px auto';
        canvas.style.margin = '0 auto';
        this._graphCanvas = canvas;

        const legend = document.createElement('div');
        legend.className = 'group-delay-eq-legend';
        for (const [className, label] of [
            ['group-delay-eq-legend-target', this._t('groupDelayEq.graph.target', 'Target')],
            ['group-delay-eq-legend-realized', this._t('groupDelayEq.graph.realized', 'Realized')]
        ]) {
            const item = document.createElement('span');
            item.className = `group-delay-eq-legend-item ${className}`;
            const swatch = document.createElement('span');
            swatch.className = 'group-delay-eq-legend-swatch';
            swatch.setAttribute('aria-hidden', 'true');
            item.append(swatch, document.createTextNode(label));
            legend.appendChild(item);
        }
        graphContainer.appendChild(legend);

        const resetButton = document.createElement('button');
        resetButton.className = 'eq-reset-button';
        resetButton.textContent = this._t('groupDelayEq.action.reset', 'Reset');
        resetButton.addEventListener('click', () => this.reset());
        graphContainer.appendChild(resetButton);

        container.append(slidersContainer, graphContainer);

        const statusLine = document.createElement('div');
        statusLine.className = 'group-delay-eq-status-line';
        const status = document.createElement('div');
        status.className = 'group-delay-eq-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        this._statusElement = status;
        const details = document.createElement('div');
        details.className = 'group-delay-eq-details';
        this._detailsElement = details;
        statusLine.append(status, details);
        container.appendChild(statusLine);

        if (!this._statusMessage) {
            this._setStatus(this._t('groupDelayEq.status.flat',
                'All bands are at 0 ms, so audio passes through unchanged.'), '');
        } else {
            this._renderStatusMessage();
        }
        this._renderDetails();
        this.drawGraph(canvas);
        this._getRuntime().then(() => {
            if (!this._disposed) this.drawGraph(this._graphCanvas);
        }).catch(error => console.error('Group Delay EQ runtime failed to load:', error));
        return container;
    }

    _formatDelay(index) {
        const value = this['d' + index];
        return `${value > 0 ? '+' : ''}${value.toFixed(1)} ms`;
    }

    /**
     * The delay expressed as a phase rotation at the band frequency: whole cycles
     * plus the remaining angle, so the reading stays meaningful past one turn.
     */
    _formatAngle(index) {
        const degrees = 0.36 * GroupDelayEqPlugin.BANDS[index].freq * this['d' + index];
        const magnitude = degrees < 0 ? -degrees : degrees;
        const sign = degrees < 0 ? '-' : '+';
        let cycles = Math.floor(magnitude / 360);
        let angle = Math.round(magnitude - cycles * 360);
        if (angle === 360) {
            angle = 0;
            cycles += 1;
        }
        return cycles === 0 ? `${sign}${angle}°` : `${sign}${cycles}c${angle}°`;
    }

    /**
     * Graph scale: the smallest grid that still covers the current settings, so small
     * delays stay readable while the axis grows with larger ones.
     */
    _graphScale(realizedMs = null) {
        let peak = GroupDelayEqPlugin.MINIMUM_GRAPH_RANGE_MS;
        const consider = value => {
            const magnitude = value < 0 ? -value : value;
            if (magnitude > peak) peak = magnitude;
        };
        for (const value of this._delays()) consider(value);
        if (realizedMs) for (const value of realizedMs) consider(value);
        const steps = GroupDelayEqPlugin.GRID_STEPS_MS;
        const gridStep = steps.find(step => step * 5 >= peak) || steps[steps.length - 1];
        return { range: gridStep * 5, gridStep };
    }

    setUIValues() {
        if (!this._sliders.length) return;
        const limit = this._delayLimitMs();
        for (let band = 0; band < GroupDelayEqPlugin.BANDS.length; band += 1) {
            const slider = this._sliders[band];
            if (slider) {
                slider.min = -limit;
                slider.max = limit;
                slider.value = this['d' + band];
            }
            if (this._valueDisplays[band]) this._valueDisplays[band].textContent = this._formatDelay(band);
            if (this._angleDisplays[band]) this._angleDisplays[band].textContent = this._formatAngle(band);
        }
        if (this._graphCanvas) this.drawGraph(this._graphCanvas);
    }

    drawGraph(canvas) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        const cssWidth = rect.width || canvas.clientWidth || canvas.width;
        const cssHeight = rect.height || canvas.clientHeight || canvas.height;
        const dpr = canvas.width / cssWidth || 1;
        const width = Math.max(1, Math.round(cssWidth));
        const height = Math.max(1, Math.round(cssHeight));
        const isMobileLayout = typeof document !== 'undefined' && document.body &&
            document.body.classList.contains('layout-mobile');

        const frequencies = this._runtime?.groupDelayResponseFrequencies?.(this._sampleRate);
        const targetMs = frequencies
            ? this._runtime.groupDelayTargetMs({
                delaysMs: this._delays(),
                taps: this.tp,
                sampleRate: this._sampleRate,
                frequencies
            })
            : null;
        // The realized curve describes the designed filter, so it is shown as soon as a
        // design exists; whether the engine already loaded it is reported by the status line.
        const realizedMs = frequencies &&
            this._lastDesign?.response?.realizedMs?.length === frequencies.length
            ? this._lastDesign.response.realizedMs
            : null;

        const { range, gridStep } = this._graphScale(realizedMs);
        const logMinFreq = Math.log10(20);
        const logFreqSpan = Math.log10(20000) - logMinFreq;
        const toX = freq => width * (Math.log10(freq) - logMinFreq) / logFreqSpan;
        const toY = ms => height * (1 - (ms + range) / (2 * range));

        // Clear canvas
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        // Draw grid
        ctx.strokeStyle = '#444';
        ctx.lineWidth = isMobileLayout ? 1 : 0.5;
        ctx.font = '12px Arial';

        // Vertical grid lines (frequency)
        const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        freqs.forEach(freq => {
            const x = toX(freq);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            // Frequency labels
            if (freq !== 20 && freq !== 20000) {
                ctx.fillStyle = '#666';
                ctx.textAlign = 'center';
                ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : freq, x, height - 24);
            }
        });

        // Horizontal grid lines (delay)
        const gridLines = Math.floor(range / gridStep);
        for (let line = -gridLines; line <= gridLines; line += 1) {
            const ms = line * gridStep;
            const y = toY(ms);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();

            // Delay labels, kept clear of the top and bottom edges
            if (Math.abs(ms) < range * 0.98) {
                ctx.fillStyle = '#666';
                ctx.textAlign = 'right';
                ctx.fillText(`${Number(ms.toFixed(1))}ms`, 48, y + 4);
            }
        }

        // Draw axis labels
        ctx.fillStyle = '#fff';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', width / 2, height - 5);
        ctx.save();
        ctx.translate(14, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Delay (ms)', 0, 0);
        ctx.restore();

        if (!frequencies) return;

        // Draw the requested curve first, then the curve the filter realizes
        const drawCurve = (values, color) => {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = isMobileLayout ? 2 : 1;
            for (let point = 0; point < frequencies.length; point += 1) {
                const x = toX(frequencies[point]);
                const y = toY(values[point]);
                if (point === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        };
        drawCurve(targetMs, 'rgba(176, 176, 176, 0.7)');
        if (realizedMs) drawCurve(realizedMs, '#00ff00');
    }

    cleanup() {
        if (this._disposed) return;
        this._disposed = true;
        ++this._designGeneration;
        if (this._designTimer !== null) clearTimeout(this._designTimer);
        this._designTimer = null;
        this._designer?.close();
        this._designer = null;
        this._statusElement = null;
        this._detailsElement = null;
        this._graphCanvas = null;
        this._sliders = [];
        this._valueDisplays = [];
        this._angleDisplays = [];
        super.cleanup();
    }
}

window.GroupDelayEqPlugin = GroupDelayEqPlugin;
