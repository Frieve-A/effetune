class AutoPanPlugin extends PluginBase {
    static searchAliases = Object.freeze([]);

    static factoryStyles = Object.freeze({
        'Gentle Auto Pan': Object.freeze({ rt: 0.35, dp: 45, ct: 0, wd: 70, wf: 'Sine', ph: 0 }),
        'Wide Auto Pan': Object.freeze({ rt: 0.7, dp: 100, ct: 0, wd: 100, wf: 'Sine', ph: 0 }),
        'Fast Auto Pan': Object.freeze({ rt: 4, dp: 85, ct: 0, wd: 100, wf: 'Triangle', ph: 0 })
    });

    constructor() {
        super('Auto Pan', 'Moves sound rhythmically across each stereo pair');

        this.rt = 0.35;
        this.dp = 45;
        this.ct = 0;
        this.wd = 70;
        this.wf = 'Sine';
        this.ph = 0;
        this.styleName = 'Gentle Auto Pan';
        this._uiControls = null;
        this._applyingStyleName = null;

        this.registerProcessor(`
            if (!parameters.enabled) return data;

            const TWO_PI = 6.283185307179586;
            const HALF_PI = 1.5707963267948966;
            const sampleRate = parameters.sampleRate;
            const blockSize = parameters.blockSize;
            const channelCount = parameters.channelCount;
            if (!(sampleRate > 0) || blockSize <= 0 || channelCount <= 0 || channelCount > 8) return data;

            const rate = parameters.rt;
            const depth = parameters.dp * 0.01;
            const center = parameters.ct * 0.01;
            const width = parameters.wd * 0.01;
            const requestedWaveform = parameters.wf === 'Triangle' ? 'Triangle' : 'Sine';
            const requestedPhase = parameters.ph * (TWO_PI / 360);
            const smoothingCoefficient = 1 - Math.exp(-1 / (sampleRate * 0.003));
            const roundedTransition = Math.round(sampleRate * 0.0025);
            const transitionLength = roundedTransition > 0 ? roundedTransition : 1;

            if (context.phase === undefined) {
                context.phase = requestedPhase;
                context.parameterPhase = requestedPhase;
                context.currentWaveform = requestedWaveform;
                context.pendingWaveform = requestedWaveform;
                context.transitionPosition = -1;
                context.leftGain = 1;
                context.rightGain = 1;
                context.lastChannelCount = channelCount;
            }
            if (context.lastChannelCount !== channelCount) {
                context.leftGain = 1;
                context.rightGain = 1;
                context.lastChannelCount = channelCount;
            }

            if (requestedPhase !== context.parameterPhase) {
                context.phase += requestedPhase - context.parameterPhase;
                if (context.phase >= TWO_PI) context.phase -= TWO_PI;
                if (context.phase < 0) context.phase += TWO_PI;
                context.parameterPhase = requestedPhase;
            }
            if (requestedWaveform !== context.pendingWaveform) {
                context.pendingWaveform = requestedWaveform;
                if (context.transitionPosition < 0) context.transitionPosition = 0;
            } else if (requestedWaveform !== context.currentWaveform && context.transitionPosition < 0) {
                context.transitionPosition = 0;
            }

            const phaseIncrement = TWO_PI * rate / sampleRate;
            for (let frame = 0; frame < blockSize; ++frame) {
                let gate = 1;
                if (context.transitionPosition >= 0) {
                    const position = context.transitionPosition;
                    if (position < transitionLength) {
                        gate = 1 - position / transitionLength;
                    } else {
                        if (position === transitionLength) {
                            context.currentWaveform = context.pendingWaveform;
                        }
                        gate = (position - transitionLength) / transitionLength;
                    }
                    context.transitionPosition = position + 1;
                    if (context.transitionPosition > transitionLength * 2) {
                        gate = 1;
                        context.transitionPosition = context.currentWaveform !== context.pendingWaveform
                            ? 0 : -1;
                    }
                }

                let lfo;
                if (context.currentWaveform === 'Triangle') {
                    const cycle = context.phase / TWO_PI;
                    const distance = cycle - 0.5;
                    lfo = 1 - 4 * (distance < 0 ? -distance : distance);
                } else {
                    lfo = Math.sin(context.phase);
                }
                let pan = center + width * lfo;
                pan = pan < -1 ? -1 : (pan > 1 ? 1 : pan);
                const angle = (pan + 1) * (HALF_PI * 0.5);
                const modulatedLeft = Math.cos(angle);
                const modulatedRight = Math.sin(angle);
                const targetLeft = 1 + depth * (modulatedLeft - 1);
                const targetRight = 1 + depth * (modulatedRight - 1);
                context.leftGain += smoothingCoefficient * (targetLeft - context.leftGain);
                context.rightGain += smoothingCoefficient * (targetRight - context.rightGain);
                if (!Number.isFinite(context.leftGain) || !Number.isFinite(context.rightGain)) {
                    context.leftGain = 1;
                    context.rightGain = 1;
                }

                for (let channel = 0; channel + 1 < channelCount; channel += 2) {
                    const leftIndex = channel * blockSize + frame;
                    const rightIndex = (channel + 1) * blockSize + frame;
                    data[leftIndex] *= 1 + gate * (context.leftGain - 1);
                    data[rightIndex] *= 1 + gate * (context.rightGain - 1);
                }

                context.phase += phaseIncrement;
                if (context.phase >= TWO_PI) context.phase -= TWO_PI;
            }
            return data;
        `);
    }

    getParameters() {
        return {
            ...super.getParameters(),
            rt: this.rt,
            dp: this.dp,
            ct: this.ct,
            wd: this.wd,
            wf: this.wf,
            ph: this.ph
        };
    }

    setParameters(params) {
        super._setValidatedParameters(params);
        const next = {
            rt: this.rt,
            dp: this.dp,
            ct: this.ct,
            wd: this.wd,
            wf: this.wf,
            ph: this.ph
        };
        if (params.rt !== undefined) next.rt = this.parseFiniteNumber(params.rt, 0.05, 20, next.rt);
        if (params.dp !== undefined) next.dp = this.parseFiniteNumber(params.dp, 0, 100, next.dp);
        if (params.ct !== undefined) next.ct = this.parseFiniteNumber(params.ct, -100, 100, next.ct);
        if (params.wd !== undefined) next.wd = this.parseFiniteNumber(params.wd, 0, 100, next.wd);
        if (params.wf !== undefined && ['Sine', 'Triangle'].includes(params.wf)) next.wf = params.wf;
        if (params.ph !== undefined) next.ph = this.parseFiniteNumber(params.ph, 0, 360, next.ph);

        Object.assign(this, next);
        if (this._applyingStyleName) {
            this.styleName = this._applyingStyleName;
        } else if (Object.keys(params).some(key => ['rt', 'dp', 'ct', 'wd', 'wf', 'ph'].includes(key))) {
            this.styleName = 'Custom';
        }
        this._syncUI();
        this.updateParameters();
    }

    setRt(value) { this.setParameters({ rt: value }); }
    setDp(value) { this.setParameters({ dp: value }); }
    setCt(value) { this.setParameters({ ct: value }); }
    setWd(value) { this.setParameters({ wd: value }); }
    setWf(value) { this.setParameters({ wf: value }); }
    setPh(value) { this.setParameters({ ph: value }); }

    applyStyle(name) {
        const style = this.constructor.factoryStyles[name];
        if (!style) return;
        this._applyingStyleName = name;
        this.setParameters(style);
        this._applyingStyleName = null;
    }

    _syncControl(row, value) {
        if (!row) return;
        const select = row.querySelector('select');
        if (select) {
            select.value = value;
            return;
        }
        const range = row.querySelector('input[type="range"]');
        const number = row.querySelector('input[type="number"]');
        if (number) number.value = String(value);
        if (!range) return;
        if (range.dataset.rangeFineMin) {
            const minimum = Number(range.dataset.rangeFineMin);
            const maximum = Number(range.dataset.rangeFineMax);
            range.value = String((Math.log10(value) - Math.log10(minimum)) /
                (Math.log10(maximum) - Math.log10(minimum)) * 100);
        } else {
            range.value = String(value);
        }
    }

    _syncUI() {
        if (!this._uiControls) return;
        this._syncControl(this._uiControls.style, this.styleName);
        for (const key of ['rt', 'dp', 'ct', 'wd', 'wf', 'ph']) {
            this._syncControl(this._uiControls[key], this[key]);
        }
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'auto-pan-plugin-ui plugin-parameter-ui';
        this._uiControls = {};
        this._uiControls.style = this.createSelectControl(
            'Style', ['Custom', ...Object.keys(this.constructor.factoryStyles)], this.styleName,
            value => value !== 'Custom' && this.applyStyle(value));
        this._uiControls.rt = this.createLogarithmicParameterControl(
            'Rate', 0.05, 20, 0.01, this.rt, this.setRt.bind(this), 'Hz');
        this._uiControls.dp = this.createParameterControl(
            'Depth', 0, 100, 1, this.dp, this.setDp.bind(this), '%');
        this._uiControls.ct = this.createParameterControl(
            'Center', -100, 100, 1, this.ct, this.setCt.bind(this), '%');
        this._uiControls.wd = this.createParameterControl(
            'Width', 0, 100, 1, this.wd, this.setWd.bind(this), '%');
        this._uiControls.wf = this.createSelectControl(
            'Waveform', ['Sine', 'Triangle'], this.wf, this.setWf.bind(this));
        this._uiControls.ph = this.createParameterControl(
            'Phase', 0, 360, 1, this.ph, this.setPh.bind(this), 'deg');
        for (const key of ['style', 'rt', 'dp', 'ct', 'wd', 'wf', 'ph']) {
            container.appendChild(this._uiControls[key]);
        }
        return container;
    }
}

window.AutoPanPlugin = AutoPanPlugin;
