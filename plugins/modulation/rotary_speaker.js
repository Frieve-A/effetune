class RotarySpeakerPlugin extends PluginBase {
    static searchAliases = Object.freeze(['Leslie', 'Rotary']);
    static executionCapabilities = Object.freeze({
        jsFallbackCapacity: Object.freeze({
            maxJsFallbackSampleChannels: 96000
        })
    });

    static factoryStyles = Object.freeze({
        'Rotary Slow': Object.freeze({ ss: 'Slow', sp: 100, ac: 2.2, xo: 800, rb: 0, sw: 75, dd: 45, ad: 55, mx: 70 }),
        'Rotary Fast': Object.freeze({ ss: 'Fast', sp: 100, ac: 1.4, xo: 800, rb: 0, sw: 85, dd: 65, ad: 70, mx: 78 }),
        'Gentle Rotary': Object.freeze({ ss: 'Slow', sp: 75, ac: 3, xo: 900, rb: 0, sw: 45, dd: 25, ad: 30, mx: 55 }),
        'Leslie Slow': Object.freeze({ ss: 'Slow', sp: 100, ac: 2.8, xo: 800, rb: -5, sw: 80, dd: 50, ad: 60, mx: 75 }),
        'Leslie Fast': Object.freeze({ ss: 'Fast', sp: 100, ac: 1.8, xo: 800, rb: -5, sw: 90, dd: 70, ad: 75, mx: 82 })
    });

    constructor() {
        super('Rotary Speaker', 'Dual-rotor crossover, Doppler, amplitude, and stereo motion');

        this.ss = 'Slow';
        this.sp = 100;
        this.ac = 2.2;
        this.xo = 800;
        this.rb = 0;
        this.sw = 75;
        this.dd = 45;
        this.ad = 55;
        this.mx = 70;
        this.style = 'Rotary Slow';
        this._applyingStyle = false;
        this._uiControls = null;

        this.registerProcessor(`
            if (!parameters.enabled) return data;

            const TWO_PI = 6.283185307179586;
            const HALF_PI = 1.5707963267948966;
            const SQRT_TWO = 1.4142135623730951;
            const BUTTERWORTH_Q = 0.7071067811865476;
            const DENORMAL_THRESHOLD = 1e-30;
            const MAX_DRUM_SPEED = 11.8;
            const MAX_HORN_SPEED = 13.6;
            const sampleRate = parameters.sampleRate;
            const channelCount = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const targetSpeedScale = Number(parameters.sp) * 0.01;
            if (channelCount < 1 || channelCount > 8) return data;
            const bufferLength = Math.ceil(sampleRate * 0.006) + 4;

            if (context.sampleRate !== sampleRate || context.bufferLength !== bufferLength) {
                context.sampleRate = sampleRate;
                context.channelCount = channelCount;
                context.bufferLength = bufferLength;
                context.filterState = new Float64Array(8 * 8);
                context.lowDelay = new Float32Array(8 * bufferLength);
                context.highDelay = new Float32Array(8 * bufferLength);
                context.writePosition = 0;
                context.drumPhase = 0;
                context.hornPhase = HALF_PI;
                context.drumSpeed = 0;
                context.hornSpeed = 0;
                context.smoothersReady = false;
                context.coefficientsReady = false;
            }
            if (context.channelCount !== channelCount) {
                context.channelCount = channelCount;
                context.filterState.fill(0);
                context.lowDelay.fill(0);
                context.highDelay.fill(0);
                context.writePosition = 0;
                context.drumPhase = 0;
                context.hornPhase = HALF_PI;
                context.drumSpeed = 0;
                context.hornSpeed = 0;
                context.smoothersReady = false;
            }

            const targetCrossoverRaw = Number(parameters.xo);
            const maximumCrossover = sampleRate * 0.45;
            const targetCrossover = targetCrossoverRaw > maximumCrossover
                ? maximumCrossover
                : targetCrossoverRaw;
            const omega = TWO_PI * targetCrossover / sampleRate;
            const cosine = Math.cos(omega);
            const alpha = Math.sin(omega) / (2 * BUTTERWORTH_Q);
            const inverseA0 = 1 / (1 + alpha);
            const oneMinusCosine = 1 - cosine;
            const onePlusCosine = 1 + cosine;
            const targetLpB0 = 0.5 * oneMinusCosine * inverseA0;
            const targetLpB1 = oneMinusCosine * inverseA0;
            const targetLpB2 = targetLpB0;
            const targetHpB0 = 0.5 * onePlusCosine * inverseA0;
            const targetHpB1 = -onePlusCosine * inverseA0;
            const targetHpB2 = targetHpB0;
            const targetA1 = -2 * cosine * inverseA0;
            const targetA2 = (1 - alpha) * inverseA0;
            if (!context.coefficientsReady) {
                context.lpB0 = targetLpB0;
                context.lpB1 = targetLpB1;
                context.lpB2 = targetLpB2;
                context.hpB0 = targetHpB0;
                context.hpB1 = targetHpB1;
                context.hpB2 = targetHpB2;
                context.a1 = targetA1;
                context.a2 = targetA2;
                context.coefficientsReady = true;
            }
            const smoothing = 1 - Math.exp(-1 / (sampleRate * 0.005));
            if (!context.smoothersReady) {
                context.acceleration = Number(parameters.ac);
                context.balance = Number(parameters.rb) * 0.01;
                context.width = Number(parameters.sw) * 0.01;
                context.doppler = Number(parameters.dd) * 0.01;
                context.amplitude = Number(parameters.ad) * 0.01;
                context.mix = Number(parameters.mx) * 0.01;
                context.smoothersReady = true;
            }

            const filterState = context.filterState;
            const lowDelay = context.lowDelay;
            const highDelay = context.highDelay;
            let writePosition = context.writePosition;
            let drumPhase = context.drumPhase;
            let hornPhase = context.hornPhase;
            let drumSpeed = context.drumSpeed;
            let hornSpeed = context.hornSpeed;

            for (let frame = 0; frame < blockSize; ++frame) {
                context.lpB0 += (targetLpB0 - context.lpB0) * smoothing;
                context.lpB1 += (targetLpB1 - context.lpB1) * smoothing;
                context.lpB2 += (targetLpB2 - context.lpB2) * smoothing;
                context.hpB0 += (targetHpB0 - context.hpB0) * smoothing;
                context.hpB1 += (targetHpB1 - context.hpB1) * smoothing;
                context.hpB2 += (targetHpB2 - context.hpB2) * smoothing;
                context.a1 += (targetA1 - context.a1) * smoothing;
                context.a2 += (targetA2 - context.a2) * smoothing;
                context.acceleration += (Number(parameters.ac) - context.acceleration) * smoothing;
                context.balance += (Number(parameters.rb) * 0.01 - context.balance) * smoothing;
                context.width += (Number(parameters.sw) * 0.01 - context.width) * smoothing;
                context.doppler += (Number(parameters.dd) * 0.01 - context.doppler) * smoothing;
                context.amplitude += (Number(parameters.ad) * 0.01 - context.amplitude) * smoothing;
                context.mix += (Number(parameters.mx) * 0.01 - context.mix) * smoothing;

                let targetDrumSpeed = 0;
                let targetHornSpeed = 0;
                if (parameters.ss === 'Slow') {
                    targetDrumSpeed = 0.7 * targetSpeedScale;
                    targetHornSpeed = 0.85 * targetSpeedScale;
                } else if (parameters.ss === 'Fast') {
                    targetDrumSpeed = 5.9 * targetSpeedScale;
                    targetHornSpeed = 6.8 * targetSpeedScale;
                }
                const acceleration = context.acceleration > 0.001 ? context.acceleration : 0.001;
                const drumStep = MAX_DRUM_SPEED / (acceleration * 1.3 * sampleRate);
                const hornStep = MAX_HORN_SPEED / (acceleration * 0.8 * sampleRate);
                if (drumSpeed < targetDrumSpeed) {
                    drumSpeed += drumStep;
                    if (drumSpeed > targetDrumSpeed) drumSpeed = targetDrumSpeed;
                } else if (drumSpeed > targetDrumSpeed) {
                    drumSpeed -= drumStep;
                    if (drumSpeed < targetDrumSpeed) drumSpeed = targetDrumSpeed;
                }
                if (hornSpeed < targetHornSpeed) {
                    hornSpeed += hornStep;
                    if (hornSpeed > targetHornSpeed) hornSpeed = targetHornSpeed;
                } else if (hornSpeed > targetHornSpeed) {
                    hornSpeed -= hornStep;
                    if (hornSpeed < targetHornSpeed) hornSpeed = targetHornSpeed;
                }

                const balanceAngle = (context.balance + 1) * 0.125 * TWO_PI;
                const lowWeight = Math.cos(balanceAngle) * SQRT_TWO;
                const highWeight = Math.sin(balanceAngle) * SQRT_TWO;
                const baseDelay = sampleRate * 0.002;
                const delayExcursion = sampleRate * 0.001 * context.doppler;

                for (let channel = 0; channel < channelCount; ++channel) {
                    const index = channel * blockSize + frame;
                    const dry = data[index];
                    const stateBase = channel * 8;
                    let low = context.lpB0 * dry + filterState[stateBase];
                    filterState[stateBase] = context.lpB1 * dry - context.a1 * low + filterState[stateBase + 1];
                    filterState[stateBase + 1] = context.lpB2 * dry - context.a2 * low;
                    let lowSecond = context.lpB0 * low + filterState[stateBase + 2];
                    filterState[stateBase + 2] = context.lpB1 * low - context.a1 * lowSecond + filterState[stateBase + 3];
                    filterState[stateBase + 3] = context.lpB2 * low - context.a2 * lowSecond;
                    low = lowSecond;
                    let high = context.hpB0 * dry + filterState[stateBase + 4];
                    filterState[stateBase + 4] = context.hpB1 * dry - context.a1 * high + filterState[stateBase + 5];
                    filterState[stateBase + 5] = context.hpB2 * dry - context.a2 * high;
                    let highSecond = context.hpB0 * high + filterState[stateBase + 6];
                    filterState[stateBase + 6] = context.hpB1 * high - context.a1 * highSecond + filterState[stateBase + 7];
                    filterState[stateBase + 7] = context.hpB2 * high - context.a2 * highSecond;
                    high = highSecond;

                    const delayBase = channel * bufferLength;
                    lowDelay[delayBase + writePosition] = low;
                    highDelay[delayBase + writePosition] = high;
                    const pairWidth = ((channel & 1) === 1 || channel + 1 < channelCount)
                        ? context.width
                        : 0;
                    const microphoneOffset = (channel & 1) === 0
                        ? -pairWidth * HALF_PI
                        : pairWidth * HALF_PI;
                    const drumAngle = drumPhase + microphoneOffset;
                    const hornAngle = hornPhase - microphoneOffset;
                    const drumDelaySamples = baseDelay + delayExcursion * Math.sin(drumAngle);
                    const hornDelaySamples = baseDelay + delayExcursion * Math.sin(hornAngle);

                    let lowPosition = writePosition - drumDelaySamples;
                    while (lowPosition < 0) lowPosition += bufferLength;
                    const lowI1 = Math.floor(lowPosition);
                    const lowFraction = lowPosition - lowI1;
                    let lowI0 = lowI1 - 1;
                    if (lowI0 < 0) lowI0 += bufferLength;
                    let lowI2 = lowI1 + 1;
                    if (lowI2 >= bufferLength) lowI2 -= bufferLength;
                    let lowI3 = lowI2 + 1;
                    if (lowI3 >= bufferLength) lowI3 -= bufferLength;
                    const lowY0 = lowDelay[delayBase + lowI0];
                    const lowY1 = lowDelay[delayBase + lowI1];
                    const lowY2 = lowDelay[delayBase + lowI2];
                    const lowY3 = lowDelay[delayBase + lowI3];
                    const delayedLow = lowY1 + 0.5 * lowFraction *
                        (lowY2 - lowY0 + lowFraction *
                        (2 * lowY0 - 5 * lowY1 + 4 * lowY2 - lowY3 + lowFraction *
                        (3 * (lowY1 - lowY2) + lowY3 - lowY0)));
                    let highPosition = writePosition - hornDelaySamples;
                    while (highPosition < 0) highPosition += bufferLength;
                    const highI1 = Math.floor(highPosition);
                    const highFraction = highPosition - highI1;
                    let highI0 = highI1 - 1;
                    if (highI0 < 0) highI0 += bufferLength;
                    let highI2 = highI1 + 1;
                    if (highI2 >= bufferLength) highI2 -= bufferLength;
                    let highI3 = highI2 + 1;
                    if (highI3 >= bufferLength) highI3 -= bufferLength;
                    const highY0 = highDelay[delayBase + highI0];
                    const highY1 = highDelay[delayBase + highI1];
                    const highY2 = highDelay[delayBase + highI2];
                    const highY3 = highDelay[delayBase + highI3];
                    const delayedHigh = highY1 + 0.5 * highFraction *
                        (highY2 - highY0 + highFraction *
                        (2 * highY0 - 5 * highY1 + 4 * highY2 - highY3 + highFraction *
                        (3 * (highY1 - highY2) + highY3 - highY0)));
                    const drumGain = 1 + 0.5 * context.amplitude * Math.cos(drumAngle);
                    const hornGain = 1 + 0.5 * context.amplitude * Math.cos(hornAngle);
                    const drumSpatial = 1 + 0.25 * pairWidth * Math.sin(drumAngle);
                    const hornSpatial = 1 + 0.25 * pairWidth * Math.sin(hornAngle);
                    const wet = lowWeight * delayedLow * drumGain * drumSpatial +
                        highWeight * delayedHigh * hornGain * hornSpatial;
                    const output = dry * (1 - context.mix) + wet * context.mix;
                    if (Number.isFinite(output)) {
                        data[index] = output;
                    } else {
                        data[index] = 0;
                        for (let state = 0; state < 8; ++state) {
                            filterState[stateBase + state] = 0;
                        }
                    }
                }

                drumPhase += TWO_PI * drumSpeed / sampleRate;
                hornPhase += TWO_PI * hornSpeed / sampleRate;
                if (drumPhase >= TWO_PI) drumPhase -= TWO_PI;
                if (hornPhase >= TWO_PI) hornPhase -= TWO_PI;
                ++writePosition;
                if (writePosition >= bufferLength) writePosition = 0;
            }

            for (let channel = 0; channel < channelCount; ++channel) {
                const stateBase = channel * 8;
                let resetState = false;
                for (let state = 0; state < 8; ++state) {
                    if (!Number.isFinite(filterState[stateBase + state])) {
                        resetState = true;
                        break;
                    }
                }
                if (resetState) {
                    for (let state = 0; state < 8; ++state) {
                        filterState[stateBase + state] = 0;
                    }
                } else {
                    for (let state = 0; state < 8; ++state) {
                        const value = filterState[stateBase + state];
                        if (value > -DENORMAL_THRESHOLD && value < DENORMAL_THRESHOLD) {
                            filterState[stateBase + state] = 0;
                        }
                    }
                }
            }

            context.writePosition = writePosition;
            context.drumPhase = drumPhase;
            context.hornPhase = hornPhase;
            context.drumSpeed = drumSpeed;
            context.hornSpeed = hornSpeed;
            return data;
        `);
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'rotary-speaker-plugin-ui plugin-parameter-ui';
        this._uiControls = {};
        this._uiControls.style = this.createSelectControl(
            'Style', ['Custom', ...Object.keys(RotarySpeakerPlugin.factoryStyles)],
            this.style, this.setStyle.bind(this));
        this._uiControls.ss = this.createSelectControl('Speed State', ['Stop', 'Slow', 'Fast'], this.ss, this.setSs.bind(this));
        this._uiControls.sp = this.createParameterControl('Speed', 25, 200, 1, this.sp, this.setSp.bind(this), '%');
        this._uiControls.ac = this.createParameterControl('Acceleration', 0.1, 10, 0.1, this.ac, this.setAc.bind(this), 's');
        this._uiControls.xo = this.createLogarithmicParameterControl('Crossover', 200, 2000, 1, this.xo, this.setXo.bind(this), 'Hz');
        this._uiControls.rb = this.createParameterControl('Rotor Balance', -100, 100, 1, this.rb, this.setRb.bind(this), '%');
        this._uiControls.sw = this.createParameterControl('Stereo Width', 0, 100, 1, this.sw, this.setSw.bind(this), '%');
        this._uiControls.dd = this.createParameterControl('Doppler Depth', 0, 100, 1, this.dd, this.setDd.bind(this), '%');
        this._uiControls.ad = this.createParameterControl('Amplitude Depth', 0, 100, 1, this.ad, this.setAd.bind(this), '%');
        this._uiControls.mx = this.createParameterControl('Mix', 0, 100, 1, this.mx, this.setMx.bind(this), '%');
        for (const key of ['style', 'ss', 'sp', 'ac', 'xo', 'rb', 'sw', 'dd', 'ad', 'mx']) {
            container.appendChild(this._uiControls[key]);
        }
        this._syncUI();
        return container;
    }

    getParameters() {
        return { ...super.getParameters(), ss: this.ss, sp: this.sp, ac: this.ac,
            xo: this.xo, rb: this.rb, sw: this.sw, dd: this.dd, ad: this.ad, mx: this.mx };
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
        if (range?.dataset.rangeFineMin) {
            const minimum = Number(range.dataset.rangeFineMin);
            const maximum = Number(range.dataset.rangeFineMax);
            range.value = String((Math.log10(value) - Math.log10(minimum)) /
                (Math.log10(maximum) - Math.log10(minimum)) * 100);
        } else if (range) {
            range.value = String(value);
        }
    }

    _syncUI() {
        if (!this._uiControls) return;
        this._syncControl(this._uiControls.style, this.style);
        for (const key of ['ss', 'sp', 'ac', 'xo', 'rb', 'sw', 'dd', 'ad', 'mx']) {
            this._syncControl(this._uiControls[key], this[key]);
        }
    }

    setParameters(params) {
        super._setValidatedParameters(params);
        const states = ['Stop', 'Slow', 'Fast'];
        const nextState = states.includes(params.ss) ? params.ss : this.ss;
        const nextSpeed = this.parseFiniteNumber(params.sp, 25, 200, this.sp);
        const nextAcceleration = this.parseFiniteNumber(params.ac, 0.1, 10, this.ac);
        const nextCrossover = this.parseFiniteNumber(params.xo, 200, 2000, this.xo);
        const nextBalance = this.parseFiniteNumber(params.rb, -100, 100, this.rb);
        const nextWidth = this.parseFiniteNumber(params.sw, 0, 100, this.sw);
        const nextDoppler = this.parseFiniteNumber(params.dd, 0, 100, this.dd);
        const nextAmplitude = this.parseFiniteNumber(params.ad, 0, 100, this.ad);
        const nextMix = this.parseFiniteNumber(params.mx, 0, 100, this.mx);
        const controlledChange = nextState !== this.ss || nextSpeed !== this.sp ||
            nextAcceleration !== this.ac || nextCrossover !== this.xo || nextBalance !== this.rb ||
            nextWidth !== this.sw || nextDoppler !== this.dd || nextAmplitude !== this.ad ||
            nextMix !== this.mx;
        this.ss = nextState;
        this.sp = nextSpeed;
        this.ac = nextAcceleration;
        this.xo = nextCrossover;
        this.rb = nextBalance;
        this.sw = nextWidth;
        this.dd = nextDoppler;
        this.ad = nextAmplitude;
        this.mx = nextMix;
        if (controlledChange && !this._applyingStyle) this.style = 'Custom';
        this._syncUI();
        this.updateParameters();
    }

    setStyle(style) {
        const preset = RotarySpeakerPlugin.factoryStyles[style];
        if (!preset) return;
        this._applyingStyle = true;
        this.setParameters(preset);
        this._applyingStyle = false;
        this.style = style;
        this._syncUI();
    }

    setSs(value) { this.setParameters({ ss: value }); }
    setSp(value) { this.setParameters({ sp: value }); }
    setAc(value) { this.setParameters({ ac: value }); }
    setXo(value) { this.setParameters({ xo: value }); }
    setRb(value) { this.setParameters({ rb: value }); }
    setSw(value) { this.setParameters({ sw: value }); }
    setDd(value) { this.setParameters({ dd: value }); }
    setAd(value) { this.setParameters({ ad: value }); }
    setMx(value) { this.setParameters({ mx: value }); }
}

window.RotarySpeakerPlugin = RotarySpeakerPlugin;
