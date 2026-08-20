class FrequencyShifterPlugin extends PluginBase {
    static searchAliases = Object.freeze([
        'Ring Modulator', 'Ring Mod', 'Barber-pole Frequency Shifter',
        'Barber Pole Frequency Shifter'
    ]);
    static executionCapabilities = Object.freeze({
        jsFallbackCapacity: Object.freeze({
            maxJsFallbackSampleChannels: 96000
        })
    });

    static factoryStyles = Object.freeze({
        'Shift Up': Object.freeze({ md: 'Shift', sh: 8, cf: 440, mn: 20, mx: 800, rt: 0.15, dr: 'Up', sp: 0, mix: 100 }),
        'Shift Down': Object.freeze({ md: 'Shift', sh: -8, cf: 440, mn: 20, mx: 800, rt: 0.15, dr: 'Down', sp: 0, mix: 100 }),
        'Fine Detune': Object.freeze({ md: 'Shift', sh: 2, cf: 440, mn: 20, mx: 800, rt: 0.15, dr: 'Up', sp: 90, mix: 55 }),
        'Ring Modulator': Object.freeze({ md: 'Ring Mod', sh: 8, cf: 440, mn: 20, mx: 800, rt: 0.15, dr: 'Up', sp: 0, mix: 100 }),
        'Barber-pole Up': Object.freeze({ md: 'Barber-pole', sh: 8, cf: 440, mn: 20, mx: 900, rt: 0.12, dr: 'Up', sp: 90, mix: 85 }),
        'Barber-pole Down': Object.freeze({ md: 'Barber-pole', sh: -8, cf: 440, mn: 20, mx: 900, rt: 0.12, dr: 'Down', sp: 90, mix: 85 })
    });

    constructor() {
        super('Frequency Shifter', 'Frequency translation, ring modulation, and continuous barber-pole motion');

        this.md = 'Shift';
        this.sh = 8;
        this.cf = 440;
        this.mn = 20;
        this.mx = 800;
        this.rt = 0.15;
        this.dr = 'Up';
        this.sp = 0;
        this.mix = 100;
        this.style = 'Shift Up';
        this._applyingStyle = false;
        this._uiControls = null;
        this._modeRows = null;

        this.registerProcessor(`
            if (!parameters.enabled) return data;

            const TWO_PI = 6.283185307179586;
            const PI = 3.141592653589793;
            const BARBER_VOICES = 3;
            const HILBERT_PROTOTYPE_LENGTH = 229;
            const HILBERT_PROTOTYPE_DELAY = (HILBERT_PROTOTYPE_LENGTH - 1) >> 1;
            const TRANSITION_HALF = 64;
            const TRANSITION_LENGTH = TRANSITION_HALF * 2;
            const sampleRate = parameters.sampleRate;
            const channelCount = parameters.channelCount;
            const blockSize = parameters.blockSize;
            if (channelCount < 1 || channelCount > 8) return data;
            const requestedMode = parameters.md === 'Ring Mod' ? 1 : (parameters.md === 'Barber-pole' ? 2 : 0);
            const requestedDirection = parameters.dr === 'Down' ? -1 : 1;
            let targetMinimum = Number(parameters.mn);
            let targetMaximum = Number(parameters.mx);
            if (targetMinimum > targetMaximum) {
                const swap = targetMinimum;
                targetMinimum = targetMaximum;
                targetMaximum = swap;
            }
            const nyquistGuard = sampleRate * 0.45;
            if (targetMinimum > nyquistGuard) targetMinimum = nyquistGuard;
            if (targetMaximum > nyquistGuard) targetMaximum = nyquistGuard;
            const requestedStationary = targetMinimum === targetMaximum;
            const hilbertStride = sampleRate <= 48000 ? 1 : (sampleRate <= 96000 ? 2 : 4);
            const firLength = (HILBERT_PROTOTYPE_LENGTH - 1) * hilbertStride + 1;
            const groupDelay = HILBERT_PROTOTYPE_DELAY * hilbertStride;

            if (context.sampleRate !== sampleRate || context.firLength !== firLength) {
                context.sampleRate = sampleRate;
                context.channelCount = channelCount;
                context.firLength = firLength;
                context.groupDelay = groupDelay;
                context.history = new Float32Array(8 * firLength);
                context.writePosition = 0;
                const tapCount = (HILBERT_PROTOTYPE_LENGTH + 1) >> 1;
                context.tapOffsets = new Uint16Array(tapCount);
                context.tapValues = new Float64Array(tapCount);
                let usedTaps = 0;
                for (let tap = 0; tap < HILBERT_PROTOTYPE_LENGTH; ++tap) {
                    const lag = tap - HILBERT_PROTOTYPE_DELAY;
                    if (lag === 0 || (lag & 1) === 0) continue;
                    const window = 0.54 -
                        0.46 * Math.cos(TWO_PI * tap / (HILBERT_PROTOTYPE_LENGTH - 1));
                    context.tapOffsets[usedTaps] = tap * hilbertStride;
                    context.tapValues[usedTaps] = (2 / (PI * lag)) * window;
                    ++usedTaps;
                }
                context.tapCount = usedTaps;
                context.shiftPhase = 0;
                context.ringPhase = 0;
                context.barberPhase = 0;
                context.barberCarriers = new Float64Array(2 * BARBER_VOICES);
                context.barberCosines = new Float64Array(2 * BARBER_VOICES);
                context.barberSines = new Float64Array(2 * BARBER_VOICES);
                context.barberWeights = new Float64Array(2 * BARBER_VOICES);
                context.barberWeightSums = new Float64Array(2);
                context.activeMode = requestedMode;
                context.activeDirection = requestedDirection;
                context.activeStationary = requestedStationary;
                context.pendingMode = requestedMode;
                context.pendingDirection = requestedDirection;
                context.pendingStationary = requestedStationary;
                context.transitionPosition = TRANSITION_LENGTH;
                context.smoothersReady = false;
            }
            if (context.channelCount !== channelCount) {
                context.channelCount = channelCount;
                context.history.fill(0);
                context.barberCarriers.fill(0);
                context.writePosition = 0;
                context.shiftPhase = 0;
                context.ringPhase = 0;
                context.barberPhase = 0;
                context.activeMode = requestedMode;
                context.activeDirection = requestedDirection;
                context.activeStationary = requestedStationary;
                context.pendingMode = requestedMode;
                context.pendingDirection = requestedDirection;
                context.pendingStationary = requestedStationary;
                context.transitionPosition = TRANSITION_LENGTH;
                context.smoothersReady = false;
            }

            let targetShift = Number(parameters.sh);
            if (targetShift > nyquistGuard) targetShift = nyquistGuard;
            else if (targetShift < -nyquistGuard) targetShift = -nyquistGuard;
            let targetCarrier = Number(parameters.cf);
            if (targetCarrier > nyquistGuard) targetCarrier = nyquistGuard;
            else if (targetCarrier < -nyquistGuard) targetCarrier = -nyquistGuard;
            const smoothing = 1 - Math.exp(-1 / (sampleRate * 0.005));
            if (!context.smoothersReady) {
                context.shift = targetShift;
                context.carrier = targetCarrier;
                context.minimumShift = targetMinimum;
                context.maximumShift = targetMaximum;
                context.rate = Number(parameters.rt);
                context.stereoPhase = Number(parameters.sp);
                context.mix = Number(parameters.mix) * 0.01;
                context.smoothersReady = true;
            }

            const transitionActive = context.transitionPosition < TRANSITION_LENGTH;
            context.pendingMode = requestedMode;
            context.pendingDirection = requestedDirection;
            context.pendingStationary = requestedStationary;
            if (!transitionActive) {
                const topologyChanged = requestedMode !== context.activeMode ||
                    ((requestedMode === 2 || context.activeMode === 2) &&
                        (requestedDirection !== context.activeDirection ||
                            (requestedMode === 2 && context.activeMode === 2 &&
                                requestedStationary !== context.activeStationary)));
                if (topologyChanged) {
                    context.transitionPosition = 0;
                } else if (requestedMode !== 2) {
                    context.activeDirection = requestedDirection;
                }
            }

            const history = context.history;
            const tapOffsets = context.tapOffsets;
            const tapValues = context.tapValues;
            const barberCarriers = context.barberCarriers;
            const barberCosines = context.barberCosines;
            const barberSines = context.barberSines;
            const barberWeights = context.barberWeights;
            const barberWeightSums = context.barberWeightSums;
            let writePosition = context.writePosition;
            let shiftPhase = context.shiftPhase;
            let ringPhase = context.ringPhase;
            let barberPhase = context.barberPhase;

            for (let frame = 0; frame < blockSize; ++frame) {
                context.shift += (targetShift - context.shift) * smoothing;
                context.carrier += (targetCarrier - context.carrier) * smoothing;
                context.minimumShift += (targetMinimum - context.minimumShift) * smoothing;
                context.maximumShift += (targetMaximum - context.maximumShift) * smoothing;
                context.rate += (Number(parameters.rt) - context.rate) * smoothing;
                context.stereoPhase += (Number(parameters.sp) - context.stereoPhase) * smoothing;
                context.mix += (Number(parameters.mix) * 0.01 - context.mix) * smoothing;

                if (context.transitionPosition === TRANSITION_HALF) {
                    const resetBarberCarriers = context.pendingMode === 2 &&
                        (context.activeMode !== 2 ||
                            context.activeDirection !== context.pendingDirection);
                    const stationaryChanged = context.pendingMode === 2 &&
                        context.activeMode === 2 &&
                        context.activeStationary !== context.pendingStationary;
                    context.activeMode = context.pendingMode;
                    context.activeDirection = context.pendingDirection;
                    context.activeStationary = context.pendingStationary;
                    if (resetBarberCarriers) barberCarriers.fill(0);
                    else if (stationaryChanged) barberCarriers.fill(barberCarriers[0]);
                }
                let wetGate = 1;
                if (context.transitionPosition < TRANSITION_LENGTH) {
                    wetGate = context.transitionPosition < TRANSITION_HALF
                        ? 1 - context.transitionPosition / TRANSITION_HALF
                        : (context.transitionPosition - TRANSITION_HALF) / TRANSITION_HALF;
                }

                const delayedPositionRaw = writePosition - groupDelay;
                const delayedPosition = delayedPositionRaw < 0 ? delayedPositionRaw + firLength : delayedPositionRaw;
                const stereoOffset = context.stereoPhase * PI / 180;
                let shiftCosineLeft = 0;
                let shiftSineLeft = 0;
                let shiftCosineRight = 0;
                let shiftSineRight = 0;
                let ringSineLeft = 0;
                let ringSineRight = 0;
                if (context.activeMode === 0) {
                    shiftCosineLeft = Math.cos(shiftPhase);
                    shiftSineLeft = Math.sin(shiftPhase);
                    shiftCosineRight = Math.cos(shiftPhase + stereoOffset);
                    shiftSineRight = Math.sin(shiftPhase + stereoOffset);
                } else if (context.activeMode === 1) {
                    ringSineLeft = Math.sin(ringPhase);
                    ringSineRight = Math.sin(ringPhase + stereoOffset);
                } else if (context.activeStationary) {
                    const phase = barberCarriers[0];
                    const cosine = Math.cos(phase);
                    const sine = Math.sin(phase);
                    let nextPhase = phase + TWO_PI * context.activeDirection *
                        context.minimumShift / sampleRate;
                    if (nextPhase >= TWO_PI) nextPhase -= TWO_PI;
                    else if (nextPhase < 0) nextPhase += TWO_PI;
                    for (let carrierIndex = 0; carrierIndex < 2 * BARBER_VOICES; ++carrierIndex) {
                        barberCosines[carrierIndex] = cosine;
                        barberSines[carrierIndex] = sine;
                        barberWeights[carrierIndex] = carrierIndex % BARBER_VOICES === 0 ? 1 : 0;
                        barberCarriers[carrierIndex] = nextPhase;
                    }
                    barberWeightSums[0] = 1;
                    barberWeightSums[1] = 1;
                } else {
                    for (let parity = 0; parity < 2; ++parity) {
                        const stereoSweepOffset = parity === 1 ? context.stereoPhase / 360 : 0;
                        let weightSum = 0;
                        for (let voice = 0; voice < BARBER_VOICES; ++voice) {
                            let sweep = barberPhase + voice / BARBER_VOICES + stereoSweepOffset;
                            sweep -= Math.floor(sweep);
                            const weightSine = Math.sin(PI * sweep);
                            const weight = weightSine * weightSine;
                            const carrierIndex = parity * BARBER_VOICES + voice;
                            const phase = barberCarriers[carrierIndex];
                            barberCosines[carrierIndex] = Math.cos(phase);
                            barberSines[carrierIndex] = Math.sin(phase);
                            barberWeights[carrierIndex] = weight;
                            weightSum += weight;
                            let instantaneousShift = context.minimumShift +
                                (context.maximumShift - context.minimumShift) * sweep;
                            instantaneousShift *= context.activeDirection;
                            let nextPhase = phase + TWO_PI * instantaneousShift / sampleRate;
                            if (nextPhase >= TWO_PI) nextPhase -= TWO_PI;
                            else if (nextPhase < 0) nextPhase += TWO_PI;
                            barberCarriers[carrierIndex] = nextPhase;
                        }
                        barberWeightSums[parity] = weightSum;
                    }
                }
                for (let channel = 0; channel < channelCount; ++channel) {
                    const inputIndex = channel * blockSize + frame;
                    const historyBase = channel * firLength;
                    history[historyBase + writePosition] = data[inputIndex];
                    const real = history[historyBase + delayedPosition];
                    let imaginary = 0;
                    if (context.activeMode !== 1) {
                        for (let tapIndex = 0; tapIndex < context.tapCount; ++tapIndex) {
                            let historyPosition = writePosition - tapOffsets[tapIndex];
                            if (historyPosition < 0) historyPosition += firLength;
                            imaginary += tapValues[tapIndex] * history[historyBase + historyPosition];
                        }
                    }

                    const parity = channel & 1;
                    let wet = real;
                    if (context.activeMode === 0) {
                        wet = parity === 1
                            ? real * shiftCosineRight - imaginary * shiftSineRight
                            : real * shiftCosineLeft - imaginary * shiftSineLeft;
                    } else if (context.activeMode === 1) {
                        wet = real * (parity === 1 ? ringSineRight : ringSineLeft);
                    } else {
                        let weighted = 0;
                        const carrierBase = parity * BARBER_VOICES;
                        for (let voice = 0; voice < BARBER_VOICES; ++voice) {
                            const carrierIndex = carrierBase + voice;
                            weighted += barberWeights[carrierIndex] *
                                (real * barberCosines[carrierIndex] - imaginary * barberSines[carrierIndex]);
                        }
                        const weightSum = barberWeightSums[parity];
                        wet = weightSum > 1e-12 ? weighted / weightSum : 0;
                    }
                    const wetMix = context.mix * wetGate;
                    const output = real * (1 - wetMix) + wet * wetMix;
                    data[inputIndex] = Number.isFinite(output) ? output : 0;
                }

                shiftPhase += TWO_PI * context.shift / sampleRate;
                if (shiftPhase >= TWO_PI) shiftPhase -= TWO_PI;
                else if (shiftPhase < 0) shiftPhase += TWO_PI;
                ringPhase += TWO_PI * context.carrier / sampleRate;
                if (ringPhase >= TWO_PI) ringPhase -= TWO_PI;
                else if (ringPhase < 0) ringPhase += TWO_PI;
                if (context.activeMode !== 2 || !context.activeStationary) {
                    barberPhase += context.rate / sampleRate;
                    if (barberPhase >= 1) barberPhase -= 1;
                }
                ++writePosition;
                if (writePosition >= firLength) writePosition = 0;
                if (context.transitionPosition < TRANSITION_LENGTH) {
                    ++context.transitionPosition;
                    if (context.transitionPosition === TRANSITION_LENGTH) {
                        const topologyChanged = context.pendingMode !== context.activeMode ||
                            ((context.pendingMode === 2 || context.activeMode === 2) &&
                                (context.pendingDirection !== context.activeDirection ||
                                    (context.pendingMode === 2 && context.activeMode === 2 &&
                                        context.pendingStationary !== context.activeStationary)));
                        if (topologyChanged) {
                            context.transitionPosition = 0;
                        } else if (context.activeMode !== 2) {
                            context.activeDirection = context.pendingDirection;
                        }
                    }
                }
            }

            context.writePosition = writePosition;
            context.shiftPhase = shiftPhase;
            context.ringPhase = ringPhase;
            context.barberPhase = barberPhase;
            return data;
        `);
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'frequency-shifter-plugin-ui plugin-parameter-ui';
        this._uiControls = {};
        this._uiControls.style = this.createSelectControl(
            'Style', ['Custom', ...Object.keys(FrequencyShifterPlugin.factoryStyles)],
            this.style, this.setStyle.bind(this), 'style');
        this._uiControls.md = this.createSelectControl(
            'Mode', ['Shift', 'Ring Mod', 'Barber-pole'], this.md, this.setMd.bind(this), 'md');
        this._uiControls.sh = this.createParameterControl('Shift', -5000, 5000, 0.1, this.sh, this.setSh.bind(this), 'Hz', 'sh');
        this._uiControls.cf = this.createLogarithmicParameterControl(
            'Carrier Frequency', 0.1, 10000, 0.1, this.cf, this.setCf.bind(this), 'Hz', 'cf');
        this._uiControls.mn = this.createParameterControl('Minimum Shift', 0, 5000, 0.1, this.mn, this.setMn.bind(this), 'Hz', 'mn');
        this._uiControls.mx = this.createParameterControl('Maximum Shift', 0, 5000, 0.1, this.mx, this.setMx.bind(this), 'Hz', 'mx');
        this._uiControls.rt = this.createLogarithmicParameterControl(
            'Rate', 0.01, 2, 0.01, this.rt, this.setRt.bind(this), 'Hz', 'rt');
        this._uiControls.dr = this.createSelectControl('Direction', ['Up', 'Down'], this.dr, this.setDr.bind(this), 'dr');
        this._uiControls.sp = this.createParameterControl('Stereo Phase', 0, 180, 1, this.sp, this.setSp.bind(this), 'degrees', 'sp');
        this._uiControls.mix = this.createParameterControl('Mix', 0, 100, 1, this.mix, this.setMix.bind(this), '%', 'mix');
        for (const key of ['style', 'md', 'sh', 'cf', 'mn', 'mx', 'rt', 'dr', 'sp', 'mix']) {
            container.appendChild(this._uiControls[key]);
        }
        this._modeRows = {
            shiftRow: this._uiControls.sh,
            carrierRow: this._uiControls.cf,
            minimumRow: this._uiControls.mn,
            maximumRow: this._uiControls.mx,
            rateRow: this._uiControls.rt,
            directionRow: this._uiControls.dr,
            stereoPhaseRow: this._uiControls.sp
        };
        this._updateModeRows();
        this._syncUI();
        return container;
    }

    _updateModeRows() {
        if (!this._modeRows) return;
        this._modeRows.shiftRow.hidden = this.md !== 'Shift';
        this._modeRows.carrierRow.hidden = this.md !== 'Ring Mod';
        const barber = this.md === 'Barber-pole';
        this._modeRows.minimumRow.hidden = !barber;
        this._modeRows.maximumRow.hidden = !barber;
        this._modeRows.rateRow.hidden = !barber;
        this._modeRows.directionRow.hidden = !barber;
        const stereoPhaseDisabled = !this._channelSelectionHasPair();
        const stereoPhaseRange = this._modeRows.stereoPhaseRow.querySelector('input[type="range"]');
        const stereoPhaseValue = this._modeRows.stereoPhaseRow.querySelector('input[type="number"]');
        if (stereoPhaseRange) stereoPhaseRange.disabled = stereoPhaseDisabled;
        if (stereoPhaseValue) stereoPhaseValue.disabled = stereoPhaseDisabled;
    }

    _channelSelectionHasPair() {
        return this.channel === null || this.channel === 'A' ||
            ['34', '56', '78'].includes(this.channel);
    }

    onChannelSelectionChanged() {
        this._updateModeRows();
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
        this._syncControl(this._uiControls.style, this.style);
        for (const key of ['md', 'sh', 'cf', 'mn', 'mx', 'rt', 'dr', 'sp', 'mix']) {
            this._syncControl(this._uiControls[key], this[key]);
        }
    }

    getParameters() {
        return { ...super.getParameters(), md: this.md, sh: this.sh, cf: this.cf,
            mn: this.mn, mx: this.mx, rt: this.rt, dr: this.dr, sp: this.sp, mix: this.mix };
    }

    setParameters(params) {
        super._setValidatedParameters(params);
        const modes = ['Shift', 'Ring Mod', 'Barber-pole'];
        const directions = ['Up', 'Down'];
        const nextMode = modes.includes(params.md) ? params.md : this.md;
        const nextShift = this.parseFiniteNumber(params.sh, -5000, 5000, this.sh);
        const nextCarrier = this.parseFiniteNumber(params.cf, 0.1, 10000, this.cf);
        let nextMinimum = this.parseFiniteNumber(params.mn, 0, 5000, this.mn);
        let nextMaximum = this.parseFiniteNumber(params.mx, 0, 5000, this.mx);
        if (nextMinimum > nextMaximum) [nextMinimum, nextMaximum] = [nextMaximum, nextMinimum];
        const nextRate = this.parseFiniteNumber(params.rt, 0.01, 2, this.rt);
        const nextDirection = directions.includes(params.dr) ? params.dr : this.dr;
        const nextStereoPhase = this.parseFiniteNumber(params.sp, 0, 180, this.sp);
        const nextMix = this.parseFiniteNumber(params.mix, 0, 100, this.mix);
        const controlledChange = nextMode !== this.md || nextShift !== this.sh ||
            nextCarrier !== this.cf || nextMinimum !== this.mn || nextMaximum !== this.mx ||
            nextRate !== this.rt || nextDirection !== this.dr || nextStereoPhase !== this.sp ||
            nextMix !== this.mix;
        this.md = nextMode;
        this.sh = nextShift;
        this.cf = nextCarrier;
        this.mn = nextMinimum;
        this.mx = nextMaximum;
        this.rt = nextRate;
        this.dr = nextDirection;
        this.sp = nextStereoPhase;
        this.mix = nextMix;
        if (controlledChange && !this._applyingStyle) this.style = 'Custom';
        this._syncUI();
        this._updateModeRows();
        this.updateParameters();
    }

    setStyle(style) {
        const preset = FrequencyShifterPlugin.factoryStyles[style];
        if (!preset) return;
        this._applyingStyle = true;
        this.setParameters(preset);
        this._applyingStyle = false;
        this.style = style;
        this._syncUI();
    }

    setMd(value) { this.setParameters({ md: value }); }
    setSh(value) { this.setParameters({ sh: value }); }
    setCf(value) { this.setParameters({ cf: value }); }
    setMn(value) { this.setParameters({ mn: value }); }
    setMx(value) { this.setParameters({ mx: value }); }
    setRt(value) { this.setParameters({ rt: value }); }
    setDr(value) { this.setParameters({ dr: value }); }
    setSp(value) { this.setParameters({ sp: value }); }
    setMix(value) { this.setParameters({ mix: value }); }
}

window.FrequencyShifterPlugin = FrequencyShifterPlugin;
