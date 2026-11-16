class GroupDelayEqPlugin extends FirAssetEqPlugin {
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

    static TAP_OPTIONS = [4096, 8192, 16384, 32768];
    static GRID_STEPS_MS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100];
    static MINIMUM_GRAPH_RANGE_MS = 5;
    static RIPPLE_WARNING_DB = 0.3;
    static FIR_MESSAGES = {
        name: 'Group Delay EQ',
        designing: 'Designing filter…',
        ready: 'The filter is ready.',
        designFailed: 'The filter could not be designed. Try a different Taps setting.',
        stageFailed: 'The filter could not be designed. Try a different Taps setting.',
        prepareFailed: 'The filter could not be prepared. Try fewer taps or a higher latency.',
        flat: 'All bands are at 0 ms, so audio passes through unchanged.'
    };

    constructor() {
        super('Group Delay EQ', 'All-pass FIR that sets the group delay of each band');
        for (let band = 0; band < GroupDelayEqPlugin.BANDS.length; band += 1) this['d' + band] = 0;
        this.tp = 16384;
        this.offlineDspAssetErrorMessageKey = 'groupDelayEq.error.design';
        this._sampleRate = this._getEngineSampleRate();
        this._outputChannelCount = this._getEngineChannelCount();
        this._runtime = null;
        this._statusState = '';
        this._detailsElement = null;
        this._sliders = [];
        this._valueDisplays = [];
        this._angleDisplays = [];
        this._graphCanvas = null;
        this.registerProcessor('return data;');
    }

    _t(_key, fallback, params = {}) {
        return Object.entries(params).reduce(
            (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
            fallback
        );
    }

    _getEngineSampleRate() {
        const value = window.workletNode?.context?.sampleRate ||
            window.audioContext?.sampleRate || window.uiManager?.audioManager?.audioContext?.sampleRate;
        return Number.isFinite(value) && value > 0 ? value : 48000;
    }

    _getEngineChannelCount() {
        const candidates = [
            window.workletNode?.channelCount,
            window.audioManager?.outputChannelCount,
            window.uiManager?.audioManager?.outputChannelCount
        ];
        return candidates.find(value => Number.isInteger(value) && value >= 1 && value <= 16) || 2;
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

    // The all-pass filter is always linear phase, so the bulk delay is half the taps.
    _filterDelay(_phase, taps = this.tp) {
        return taps / 2;
    }

    getParameters(options = {}) {
        const parameters = super.getParameters(options);
        delete parameters.pm;
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

    _setDesignParameters(params) {
        const limit = this._delayLimitMs();
        for (let band = 0; band < GroupDelayEqPlugin.BANDS.length; band += 1) {
            const value = params['d' + band];
            if (value !== undefined) {
                this['d' + band] = this.parseFiniteNumber(value, -limit, limit, this['d' + band]);
            }
        }
        // A smaller tap count shortens the filter, so stored delays may no longer fit.
        this._clampDelaysToLimit();
    }

    _syncParameterUI() {
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

    _filterRequired() {
        return this._hasDelay();
    }

    _engineFormatChanged() {
        this._clampDelaysToLimit();
        super._engineFormatChanged();
        this.setUIValues();
    }

    _renderDesign() {
        this._renderDetails();
        this.setUIValues();
    }

    _loadDesignerModule() {
        return Promise.all([
            import('../../js/group-delay-eq/designer.js'),
            import('../../js/group-delay-eq/design-core.js')
        ]).then(([designer, design]) => ({ ...designer, ...design }));
    }

    // The graph reads the target and realized curves from the loaded runtime.
    async _getRuntime() {
        this._runtime = await super._getRuntime();
        return this._runtime;
    }

    _createDesigner(runtime) {
        return runtime.createGroupDelayEqDesigner();
    }

    _designConfig(sampleRate = this._sampleRate) {
        return { delaysMs: this._delays(), taps: this.tp, sampleRate };
    }

    _readyStatus() {
        const warning = this._lastDesign && this._qualityWarning(this._lastDesign);
        return warning
            ? [warning, 'warning']
            : [GroupDelayEqPlugin.FIR_MESSAGES.ready, 'ready'];
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

    // Group Delay EQ takes its sample rate only from the engine format commit, so it
    // reads nothing but execution state from worklet messages.
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

    _renderStatus() {
        this._renderStatusMessage();
        this._renderDetails();
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
            GroupDelayEqPlugin.TAP_OPTIONS.map(value => ({ value: String(value), label: String(value) })),
            String(this.tp),
            value => this.setParameters({ tp: Number(value) }), 'tp'
        ));
        container.appendChild(this.createSelectControl(
            this._t('groupDelayEq.parameter.latency', 'Latency'),
            FirAssetEqPlugin.LATENCY_OPTIONS.map(value => ({
                value,
                label: `${value} samples`
            })),
            this.lt,
            value => this.setParameters({ lt: value }), 'lt'
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
            freqLabel.textContent = `${band.name}:`;
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

        const resetButton = document.createElement('button');
        resetButton.className = 'eq-reset-button';
        resetButton.textContent = this._t('groupDelayEq.action.reset', 'Reset');
        resetButton.addEventListener('click', () => this.reset());
        graphContainer.appendChild(resetButton);

        container.append(slidersContainer, graphContainer);

        const statusLine = document.createElement('div');
        statusLine.className = 'group-delay-eq-status-line local-audio-only';
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
            this._setStatus(GroupDelayEqPlugin.FIR_MESSAGES.flat, '');
        } else {
            this._renderStatusMessage();
        }
        this._renderDetails();
        this.drawGraph(canvas);
        this._getRuntime().then(() => {
            if (!this._disposed) this.drawGraph(this._graphCanvas);
        }).catch(error => console.error('Group Delay EQ runtime failed to load:', error));
        this._graphReadout = window.GraphReadout?.attach({
            mount: graphContainer,
            surface: canvas,
            read: x => this._readGraph(x),
            legend: this._graphSeries()
        });
        return container;
    }

    // Plotted curves in drawing order with their drawing colors.
    _graphSeries() {
        return [
            { label: this._t('groupDelayEq.graph.target', 'Target'), color: 'var(--et-graph-trace-tertiary)' },
            { label: this._t('groupDelayEq.graph.realized', 'Realized'), color: 'var(--et-graph-trace)' }
        ];
    }

    // Reads the drawn curves at canvas pixel x, interpolating between plotted points.
    _readGraph(x) {
        const frame = this._readoutFrame;
        if (!frame?.valid) return null;
        const { format, seriesValueAt } = window.GraphReadout;
        const { scale, xs, toY } = frame;
        const cssX = x / scale;
        const rows = [];
        const [target, realized] = this._graphSeries();
        for (const [series, values] of [[target, frame.targetMs], [realized, frame.realizedMs]]) {
            if (!values) continue;
            const ms = seriesValueAt(xs, values, cssX) ?? NaN;
            rows.push({ ...series, value: format.time(ms), y: toY(ms) * scale });
        }
        return { cursor: format.frequency(10 ** (frame.logMinFreq + cssX / frame.width * frame.logFreqSpan)), rows };
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
                window.uiManager?.refreshRangeFillStyling?.(slider);
            }
            if (this._valueDisplays[band]) this._valueDisplays[band].textContent = this._formatDelay(band);
            if (this._angleDisplays[band]) this._angleDisplays[band].textContent = this._formatAngle(band);
        }
        if (this._graphCanvas) this.drawGraph(this._graphCanvas);
    }

    drawGraph(canvas) {
        if (!canvas) return;
        const frame = (this._readoutFrame ??= {});
        frame.valid = false;
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
        ctx.strokeStyle = (window.ThemePalette?.get('graph-grid') ?? '');
        ctx.lineWidth = isMobileLayout ? 1 : 0.5;
        ctx.font = '12px Arial';

        // Vertical grid lines (frequency); 20 Hz and 20 kHz sit on the canvas edges
        const freqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
        freqs.forEach(freq => {
            const x = toX(freq);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            // Frequency labels
            ctx.fillStyle = (window.ThemePalette?.get('graph-label') ?? '');
            ctx.textAlign = 'center';
            ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : freq, x, height - 24);
        });

        // Horizontal grid lines (delay); the ±range bounds sit on the canvas edges,
        // so only the interior steps are drawn
        const gridLines = Math.round(range / gridStep) - 1;
        for (let line = -gridLines; line <= gridLines; line += 1) {
            const ms = line * gridStep;
            const y = toY(ms);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();

            ctx.fillStyle = (window.ThemePalette?.get('graph-label') ?? '');
            ctx.textAlign = 'right';
            ctx.fillText(`${Number(ms.toFixed(1))}`, 48, y + 4);
        }

        // Draw axis labels
        ctx.fillStyle = (window.ThemePalette?.get('text-primary') ?? '');
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', width / 2, height - 5);
        ctx.save();
        ctx.translate(14, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Delay (ms)', 0, 0);
        ctx.restore();

        if (!frequencies) {
            this._graphReadout?.refresh();
            return;
        }

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
        drawCurve(targetMs, (window.ThemePalette?.get('graph-trace-tertiary') ?? ''));
        if (realizedMs) drawCurve(realizedMs, (window.ThemePalette?.get('graph-trace') ?? ''));

        frame.valid = true;
        frame.scale = dpr;
        frame.width = width;
        frame.logMinFreq = logMinFreq;
        frame.logFreqSpan = logFreqSpan;
        frame.xs = frequencies.map(toX);
        frame.toY = toY;
        frame.targetMs = targetMs;
        frame.realizedMs = realizedMs;
        this._graphReadout?.refresh();
    }

    cleanup() {
        if (this._disposed) return;
        this._detailsElement = null;
        this._graphCanvas = null;
        this._sliders = [];
        this._valueDisplays = [];
        this._angleDisplays = [];
        super.cleanup();
    }
}

window.GroupDelayEqPlugin = GroupDelayEqPlugin;
