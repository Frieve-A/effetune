const AUTO_FILTER_SYSTEM_PRESETS = Object.freeze([
    Object.freeze({ id: 'auto-filter-sweep', label: 'Auto Filter Sweep', params: Object.freeze({ md: 'LFO', ft: 'Low-pass', lf: 200, hf: 4000, rs: 1.5, mx: 80, rt: 0.5, wf: 'Sine', sp: 0, sn: 24, at: 20, rl: 250, dr: 'Up' }) }),
    Object.freeze({ id: 'stereo-filter-sweep', label: 'Stereo Filter Sweep', params: Object.freeze({ md: 'LFO', ft: 'Low-pass', lf: 160, hf: 6000, rs: 2, mx: 85, rt: 0.35, wf: 'Sine', sp: 120, sn: 24, at: 20, rl: 250, dr: 'Up' }) }),
    Object.freeze({ id: 'envelope-filter', label: 'Envelope Filter', params: Object.freeze({ md: 'Envelope', ft: 'Low-pass', lf: 100, hf: 5000, rs: 1.2, mx: 85, rt: 0.5, wf: 'Sine', sp: 0, sn: 24, at: 18, rl: 300, dr: 'Up' }) }),
    Object.freeze({ id: 'auto-wah', label: 'Auto Wah', params: Object.freeze({ md: 'Envelope', ft: 'Band-pass', lf: 180, hf: 2400, rs: 5, mx: 100, rt: 0.5, wf: 'Sine', sp: 0, sn: 30, at: 8, rl: 180, dr: 'Up' }) }),
    Object.freeze({ id: 'reverse-auto-wah', label: 'Reverse Auto Wah', params: Object.freeze({ md: 'Envelope', ft: 'Band-pass', lf: 180, hf: 2800, rs: 4, mx: 100, rt: 0.5, wf: 'Sine', sp: 0, sn: 30, at: 12, rl: 350, dr: 'Down' }) })
]);

class AutoFilterPlugin extends PluginBase {
    static searchAliases = Object.freeze(['Envelope Filter', 'Auto Wah', 'Wah']);
    static executionCapabilities = Object.freeze({
        jsFallbackCapacity: Object.freeze({
            maxJsFallbackSampleChannels: 96000
        })
    });

    static getSystemPresetGroups() {
        return [{ label: '', presets: AUTO_FILTER_SYSTEM_PRESETS.map(preset => ({ ...preset })) }];
    }

    constructor() {
        super('Auto Filter', 'Sweeps a resonant filter with an LFO or the input envelope');

        Object.assign(this, { md: 'LFO', ft: 'Low-pass', lf: 200, hf: 4000, rs: 1.5, mx: 80, rt: 0.5, wf: 'Sine', sp: 0, sn: 24, at: 20, rl: 250, dr: 'Up' });
        this._uiControls = null;

        this.registerProcessor(`
            if (!parameters.enabled) return data;

            const TWO_PI = 6.283185307179586;
            const sampleRate = parameters.sampleRate;
            const blockSize = parameters.blockSize;
            const channelCount = parameters.channelCount;
            if (!(sampleRate > 0) || blockSize <= 0 || channelCount <= 0 || channelCount > 8) return data;

            let lowFrequency = parameters.lf;
            let highFrequency = parameters.hf;
            if (lowFrequency > highFrequency) {
                const temporary = lowFrequency;
                lowFrequency = highFrequency;
                highFrequency = temporary;
            }
            const nyquistGuard = sampleRate * 0.45;
            highFrequency = highFrequency < nyquistGuard ? highFrequency : nyquistGuard;
            lowFrequency = lowFrequency < highFrequency ? lowFrequency : highFrequency;
            lowFrequency = lowFrequency > 5 ? lowFrequency : 5;
            highFrequency = highFrequency > lowFrequency ? highFrequency : lowFrequency;
            const lowLog = Math.log(lowFrequency);
            const highLog = Math.log(highFrequency);
            const logRange = highLog - lowLog;

            const requestedMode = parameters.md === 'Envelope' ? 'Envelope' : 'LFO';
            const requestedFilterType = parameters.ft === 'Band-pass' || parameters.ft === 'High-pass'
                ? parameters.ft : 'Low-pass';
            const requestedWaveform = parameters.wf === 'Triangle' ? 'Triangle' : 'Sine';
            const requestedDirection = parameters.dr === 'Down' ? 'Down' : 'Up';
            const pairCount = Math.ceil(channelCount / 2);
            const roundedTransition = Math.round(sampleRate * 0.0025);
            const transitionLength = roundedTransition > 0 ? roundedTransition : 1;
            const cutoffCoefficient = 1 - Math.exp(-1 / (sampleRate * 0.004));
            const attackCoefficient = 1 - Math.exp(-1 / (sampleRate * parameters.at * 0.001));
            const releaseCoefficient = 1 - Math.exp(-1 / (sampleRate * parameters.rl * 0.001));
            const sensitivityGain = 10 ** (parameters.sn / 20);
            const mix = parameters.mx * 0.01;

            if (context.phase === undefined) {
                context.phase = 0;
                context.ic1 = new Float64Array(8);
                context.ic2 = new Float64Array(8);
                context.logCutoff = new Float64Array(8);
                context.cutoffReady = new Uint8Array(8);
                context.controller = new Float64Array(8);
                context.envelope = new Float64Array(4);
                context.lastChannelCount = channelCount;
                context.currentMode = requestedMode;
                context.currentFilterType = requestedFilterType;
                context.currentWaveform = requestedWaveform;
                context.currentDirection = requestedDirection;
                context.pendingMode = requestedMode;
                context.pendingFilterType = requestedFilterType;
                context.pendingWaveform = requestedWaveform;
                context.pendingDirection = requestedDirection;
                context.transitionPosition = -1;
                context.inverseQ = 1 / parameters.rs;
                context.mixState = mix;
            } else if (context.lastChannelCount !== channelCount) {
                context.ic1.fill(0);
                context.ic2.fill(0);
                context.logCutoff.fill(0);
                context.cutoffReady.fill(0);
                context.controller.fill(0);
                context.envelope.fill(0);
                context.lastChannelCount = channelCount;
                context.currentMode = requestedMode;
                context.currentFilterType = requestedFilterType;
                context.currentWaveform = requestedWaveform;
                context.currentDirection = requestedDirection;
                context.pendingMode = requestedMode;
                context.pendingFilterType = requestedFilterType;
                context.pendingWaveform = requestedWaveform;
                context.pendingDirection = requestedDirection;
                context.transitionPosition = -1;
            }

            if (context.transitionPosition < 0 && requestedMode === context.currentMode) {
                if (context.currentMode === 'LFO') {
                    context.currentDirection = requestedDirection;
                    context.pendingDirection = requestedDirection;
                } else {
                    context.currentWaveform = requestedWaveform;
                    context.pendingWaveform = requestedWaveform;
                }
            }

            const pendingChanged = requestedMode !== context.pendingMode ||
                requestedFilterType !== context.pendingFilterType ||
                requestedWaveform !== context.pendingWaveform ||
                requestedDirection !== context.pendingDirection;
            if (pendingChanged) {
                context.pendingMode = requestedMode;
                context.pendingFilterType = requestedFilterType;
                context.pendingWaveform = requestedWaveform;
                context.pendingDirection = requestedDirection;
            }
            const currentChanged = requestedMode !== context.currentMode ||
                requestedFilterType !== context.currentFilterType ||
                (context.currentMode === 'LFO' && requestedWaveform !== context.currentWaveform) ||
                (context.currentMode === 'Envelope' && requestedDirection !== context.currentDirection);
            if (currentChanged && context.transitionPosition < 0) context.transitionPosition = 0;

            const phaseIncrement = TWO_PI * parameters.rt / sampleRate;
            const stereoPhase = parameters.sp * (TWO_PI / 360);
            const inverseQ = 1 / parameters.rs;

            for (let frame = 0; frame < blockSize; ++frame) {
                context.inverseQ += cutoffCoefficient * (inverseQ - context.inverseQ);
                context.mixState += cutoffCoefficient * (mix - context.mixState);
                let gate = 1;
                if (context.transitionPosition >= 0) {
                    const position = context.transitionPosition;
                    if (position < transitionLength) {
                        gate = 1 - position / transitionLength;
                    } else {
                        if (position === transitionLength) {
                            const modeChanged = context.currentMode !== context.pendingMode;
                            context.currentMode = context.pendingMode;
                            context.currentFilterType = context.pendingFilterType;
                            context.currentWaveform = context.pendingWaveform;
                            context.currentDirection = context.pendingDirection;
                            if (modeChanged) {
                                context.phase = 0;
                                context.envelope.fill(0);
                                context.cutoffReady.fill(0);
                            }
                        }
                        gate = (position - transitionLength) / transitionLength;
                    }
                    context.transitionPosition = position + 1;
                    if (context.transitionPosition > transitionLength * 2) {
                        gate = 1;
                        const topologyChanged = context.pendingMode !== context.currentMode ||
                            context.pendingFilterType !== context.currentFilterType ||
                            (context.currentMode === 'LFO' &&
                                context.pendingWaveform !== context.currentWaveform) ||
                            (context.currentMode === 'Envelope' &&
                                context.pendingDirection !== context.currentDirection);
                        if (topologyChanged) {
                            context.transitionPosition = 0;
                        } else {
                            if (context.currentMode === 'LFO') {
                                context.currentDirection = context.pendingDirection;
                            } else {
                                context.currentWaveform = context.pendingWaveform;
                            }
                            context.transitionPosition = -1;
                        }
                    }
                }

                if (context.currentMode === 'Envelope') {
                    for (let pair = 0; pair < pairCount; ++pair) {
                        const left = pair * 2;
                        const right = left + 1;
                        const leftSample = data[left * blockSize + frame];
                        let magnitude;
                        if (right < channelCount) {
                            const rightSample = data[right * blockSize + frame];
                            magnitude = Math.sqrt((leftSample * leftSample + rightSample * rightSample) * 0.5);
                        } else {
                            magnitude = leftSample < 0 ? -leftSample : leftSample;
                        }
                        const coefficient = magnitude > context.envelope[pair] ? attackCoefficient : releaseCoefficient;
                        context.envelope[pair] += coefficient * (magnitude - context.envelope[pair]);
                        let control = context.envelope[pair] * sensitivityGain;
                        control = control < 0 ? 0 : (control > 1 ? 1 : control);
                        if (context.currentDirection === 'Down') control = 1 - control;
                        context.controller[left] = control;
                        if (right < channelCount) context.controller[right] = control;
                    }
                } else {
                    for (let pair = 0; pair < pairCount; ++pair) {
                        const left = pair * 2;
                        const right = left + 1;
                        let rightPhase = context.phase + stereoPhase;
                        if (rightPhase >= TWO_PI) rightPhase -= TWO_PI;
                        if (context.currentWaveform === 'Triangle') {
                            const leftCycle = context.phase / TWO_PI;
                            const rightCycle = rightPhase / TWO_PI;
                            const leftDistance = leftCycle - 0.5;
                            const rightDistance = rightCycle - 0.5;
                            context.controller[left] = 1 - 2 * (leftDistance < 0 ? -leftDistance : leftDistance);
                            if (right < channelCount) context.controller[right] = 1 - 2 * (rightDistance < 0 ? -rightDistance : rightDistance);
                        } else {
                            context.controller[left] = (Math.sin(context.phase) + 1) * 0.5;
                            if (right < channelCount) context.controller[right] = (Math.sin(rightPhase) + 1) * 0.5;
                        }
                    }
                }

                for (let channel = 0; channel < channelCount; ++channel) {
                    const index = channel * blockSize + frame;
                    const input = data[index];
                    const targetLog = lowLog + logRange * context.controller[channel];
                    if (!context.cutoffReady[channel]) {
                        context.logCutoff[channel] = targetLog;
                        context.cutoffReady[channel] = 1;
                    } else {
                        context.logCutoff[channel] += cutoffCoefficient * (targetLog - context.logCutoff[channel]);
                    }
                    const cutoff = Math.exp(context.logCutoff[channel]);
                    const g = Math.tan(Math.PI * cutoff / sampleRate);
                    const a1 = 1 / (1 + g * (g + context.inverseQ));
                    const a2 = g * a1;
                    const a3 = g * a2;
                    const v3 = input - context.ic2[channel];
                    const band = a1 * context.ic1[channel] + a2 * v3;
                    const low = context.ic2[channel] + a2 * context.ic1[channel] + a3 * v3;
                    context.ic1[channel] = 2 * band - context.ic1[channel];
                    context.ic2[channel] = 2 * low - context.ic2[channel];
                    const high = input - context.inverseQ * band - low;
                    let wet = low;
                    if (context.currentFilterType === 'Band-pass') wet = band;
                    else if (context.currentFilterType === 'High-pass') wet = high;
                    const wetMix = context.mixState * gate;
                    let output = input + wetMix * (wet - input);
                    if (!Number.isFinite(output) || !Number.isFinite(context.ic1[channel]) ||
                        !Number.isFinite(context.ic2[channel])) {
                        context.ic1[channel] = 0;
                        context.ic2[channel] = 0;
                        context.cutoffReady[channel] = 0;
                        output = input;
                    } else {
                        if (context.ic1[channel] < 1e-30 && context.ic1[channel] > -1e-30) context.ic1[channel] = 0;
                        if (context.ic2[channel] < 1e-30 && context.ic2[channel] > -1e-30) context.ic2[channel] = 0;
                    }
                    data[index] = output;
                }

                if (context.currentMode === 'LFO') {
                    context.phase += phaseIncrement;
                    if (context.phase >= TWO_PI) context.phase -= TWO_PI;
                }
            }
            return data;
        `);
    }

    getParameters() {
        return {
            ...super.getParameters(), md: this.md, ft: this.ft, lf: this.lf, hf: this.hf,
            rs: this.rs, mx: this.mx, rt: this.rt, wf: this.wf, sp: this.sp,
            sn: this.sn, at: this.at, rl: this.rl, dr: this.dr
        };
    }

    setParameters(params) {
        super._setValidatedParameters(params);
        const next = {
            md: this.md, ft: this.ft, lf: this.lf, hf: this.hf, rs: this.rs, mx: this.mx,
            rt: this.rt, wf: this.wf, sp: this.sp, sn: this.sn, at: this.at, rl: this.rl,
            dr: this.dr
        };
        if (params.md !== undefined && ['LFO', 'Envelope'].includes(params.md)) next.md = params.md;
        if (params.ft !== undefined && ['Low-pass', 'Band-pass', 'High-pass'].includes(params.ft)) next.ft = params.ft;
        if (params.lf !== undefined) next.lf = this.parseFiniteNumber(params.lf, 20, 20000, next.lf);
        if (params.hf !== undefined) next.hf = this.parseFiniteNumber(params.hf, 20, 20000, next.hf);
        if (params.rs !== undefined) next.rs = this.parseFiniteNumber(params.rs, 0.5, 20, next.rs);
        if (params.mx !== undefined) next.mx = this.parseFiniteNumber(params.mx, 0, 100, next.mx);
        if (params.rt !== undefined) next.rt = this.parseFiniteNumber(params.rt, 0.05, 20, next.rt);
        if (params.wf !== undefined && ['Sine', 'Triangle'].includes(params.wf)) next.wf = params.wf;
        if (params.sp !== undefined) next.sp = this.parseFiniteNumber(params.sp, 0, 180, next.sp);
        if (params.sn !== undefined) next.sn = this.parseFiniteNumber(params.sn, 0, 60, next.sn);
        if (params.at !== undefined) next.at = this.parseFiniteNumber(params.at, 1, 500, next.at);
        if (params.rl !== undefined) next.rl = this.parseFiniteNumber(params.rl, 10, 2000, next.rl);
        if (params.dr !== undefined && ['Up', 'Down'].includes(params.dr)) next.dr = params.dr;

        Object.assign(this, next);
        this._syncUI();
        this.updateParameters();
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
        window.uiManager?.refreshRangeFillStyling?.(range);
    }

    _syncUI() {
        if (!this._uiControls) return;
        for (const key of ['md', 'ft', 'lf', 'hf', 'rs', 'mx', 'rt', 'wf', 'sp', 'sn', 'at', 'rl', 'dr']) {
            this._syncControl(this._uiControls[key], this[key]);
        }
        const lfo = this.md === 'LFO';
        for (const key of ['rt', 'wf', 'sp']) this._uiControls[key].style.display = lfo ? '' : 'none';
        for (const key of ['sn', 'at', 'rl', 'dr']) this._uiControls[key].style.display = lfo ? 'none' : '';
        const stereoPhaseDisabled = !lfo || !this._channelSelectionHasPair();
        const stereoPhaseRange = this._uiControls.sp.querySelector('input[type="range"]');
        const stereoPhaseValue = this._uiControls.sp.querySelector('input[type="number"]');
        if (stereoPhaseRange) stereoPhaseRange.disabled = stereoPhaseDisabled;
        if (stereoPhaseValue) stereoPhaseValue.disabled = stereoPhaseDisabled;
    }

    _channelSelectionHasPair() {
        return this.channel === null || this.channel === 'A' ||
            ['34', '56', '78', '910', '1112', '1314', '1516'].includes(this.channel);
    }

    onChannelSelectionChanged() {
        this._syncUI();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'auto-filter-plugin-ui plugin-parameter-ui';
        this._uiControls = {};
        this._uiControls.md = this.createSelectControl('Mode', ['LFO', 'Envelope'], this.md, value => this.setParameters({ md: value }), 'md');
        this._uiControls.ft = this.createSelectControl('Filter Type', ['Low-pass', 'Band-pass', 'High-pass'], this.ft, value => this.setParameters({ ft: value }), 'ft');
        this._uiControls.lf = this.createLogarithmicParameterControl('Minimum Frequency', 20, 20000, 1, this.lf, value => this.setParameters({ lf: value }), 'Hz', 'lf');
        this._uiControls.hf = this.createLogarithmicParameterControl('Maximum Frequency', 20, 20000, 1, this.hf, value => this.setParameters({ hf: value }), 'Hz', 'hf');
        this._uiControls.rs = this.createParameterControl('Resonance', 0.5, 20, 0.1, this.rs, value => this.setParameters({ rs: value }), 'Q', 'rs');
        this._uiControls.mx = this.createParameterControl('Mix', 0, 100, 1, this.mx, value => this.setParameters({ mx: value }), '%', 'mx');
        this._uiControls.rt = this.createLogarithmicParameterControl('Rate', 0.05, 20, 0.01, this.rt, value => this.setParameters({ rt: value }), 'Hz', 'rt');
        this._uiControls.wf = this.createSelectControl('Waveform', ['Sine', 'Triangle'], this.wf, value => this.setParameters({ wf: value }), 'wf');
        this._uiControls.sp = this.createParameterControl('Stereo Phase', 0, 180, 1, this.sp, value => this.setParameters({ sp: value }), 'deg', 'sp');
        this._uiControls.sn = this.createParameterControl('Sensitivity', 0, 60, 1, this.sn, value => this.setParameters({ sn: value }), 'dB', 'sn');
        this._uiControls.at = this.createLogarithmicParameterControl('Attack', 1, 500, 1, this.at, value => this.setParameters({ at: value }), 'ms', 'at');
        this._uiControls.rl = this.createLogarithmicParameterControl('Release', 10, 2000, 1, this.rl, value => this.setParameters({ rl: value }), 'ms', 'rl');
        this._uiControls.dr = this.createSelectControl('Direction', ['Up', 'Down'], this.dr, value => this.setParameters({ dr: value }), 'dr');
        for (const key of ['md', 'ft', 'lf', 'hf', 'rs', 'mx', 'rt', 'wf', 'sp', 'sn', 'at', 'rl', 'dr']) {
            container.appendChild(this._uiControls[key]);
        }
        this._syncUI();
        return container;
    }
}

window.AutoFilterPlugin = AutoFilterPlugin;
