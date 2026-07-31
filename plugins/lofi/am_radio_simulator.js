const AM_RADIO_SIMULATOR_TAP_STATUS = 17;
const AM_RADIO_SIMULATOR_TELEMETRY_VERSION = 2;
const AM_RADIO_SIMULATOR_TELEMETRY_V1_VERSION = 1;
const AM_RADIO_SIMULATOR_TELEMETRY_V1_BYTES = 24;
const AM_RADIO_SIMULATOR_TELEMETRY_BYTES = 28;
const AM_RADIO_SIMULATOR_MINIMUM_AGC_GAIN_DB = -12;
const AM_RADIO_SIMULATOR_MAXIMUM_AGC_GAIN_DB = 42;

const AM_RADIO_SIMULATOR_REFERENCE_PROCESSOR = `
    if (!parameters.fr || typeof context.__seededRandom !== 'function') {
        data.measurements = { bypass: true };
        return data;
    }
    if (!parameters.enabled || parameters.channelCount < 1 ||
        parameters.blockSize < 1 || parameters.sampleRate <= 0) return data;

    const PI = 3.14159265358979323846;
    const TWO_PI = 6.28318530717958647692;
    const SQRT_HALF = 0.70710678118654752440;
    const FLOAT32_SCALE = 4294967296;
    const FLOAT53_SCALE = 9007199254740992;
    const CONTROL_INTERVAL = 32;
    const AGC_TARGET_DB = -6;
    const AGC_MINIMUM_GAIN_DB = ${AM_RADIO_SIMULATOR_MINIMUM_AGC_GAIN_DB};
    const AGC_MAXIMUM_GAIN_DB = ${AM_RADIO_SIMULATOR_MAXIMUM_AGC_GAIN_DB};
    const DETECTOR_DIODE_TO_LOAD_RESISTANCE_RATIO = 0.02;
    const SPEAKER_TRANSITION_TIME = 0.020;
    const MAXIMUM_DIGITAL_TUNING_HZ = 15000;
    const CQUAM_PILOT_FREQUENCY = 25;
    const CQUAM_PILOT_AMPLITUDE = 0.05;
    const CQUAM_INTERNAL_PHASE_LIMIT = 1.15;
    const CQUAM_EPSILON_RELATIVE = 0.2;
    const CQUAM_EPSILON_ABSOLUTE = 1e-6;
    const MAXIMUM_CQUAM_MASK_TAPS = 256;
    const MINIMUM_IF_CUTOFF_HZ = 1000;
    const STATIC_RANDOM_SALT = 0xa511e9b3;
    const STATIC_ZERO_FALLBACK = 0xeffe7a5e;
    const STATIC_CARRIER_AREA_SECONDS = 20.0e-6;
    const QUALITY_PROGRAM_ALLOWANCE_RATIO = 0.91727593538977958;
    const QUALITY_EXCESS_RATIO_OFFSET = 0.04;
    const QUALITY_FULL_RATIO = 0.94406087628592339;
    const QUALITY_MONO_RATIO = 0.53088444423098835;
    // Calibrated from the measured 3033.599 Hz one-sided ENBW of the default IF cascade.
    const THERMAL_NOISE_CALIBRATION = 0.9944467442996018;
    const BUTTERWORTH_4_Q = [0.541196100146197, 1.306562964876377];
    const BUTTERWORTH_6_Q = [0.517638090205042, 0.707106781186548, 1.931851652578137];
    const BUTTERWORTH_8_Q = [0.509795579104159, 0.601344886935045, 0.899976223136416, 2.562915447741506];
    const AGC_ATTACK_TIMES = [0.150, 0.050, 0.015];
    const AGC_RELEASE_TIMES = [3.0, 1.5, 0.750];

    function makeBiquad() {
        return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 };
    }

    function makeBank(count) {
        const bank = new Array(count);
        for (let index = 0; index < count; index++) bank[index] = makeBiquad();
        return bank;
    }

    function configureLowPass(filter, frequency, q, sampleRate) {
        const limit = sampleRate * 0.45;
        const bounded = frequency > limit ? limit : (frequency < 1 ? 1 : frequency);
        const omega = TWO_PI * bounded / sampleRate;
        const cosine = Math.cos(omega);
        const sine = Math.sin(omega);
        const alpha = sine / (2 * q);
        const inverseA0 = 1 / (1 + alpha);
        const half = (1 - cosine) * 0.5;
        filter.b0 = half * inverseA0;
        filter.b1 = (1 - cosine) * inverseA0;
        filter.b2 = filter.b0;
        filter.a1 = -2 * cosine * inverseA0;
        filter.a2 = (1 - alpha) * inverseA0;
    }

    function configureHighPass(filter, frequency, q, sampleRate) {
        const omega = TWO_PI * frequency / sampleRate;
        const cosine = Math.cos(omega);
        const sine = Math.sin(omega);
        const alpha = sine / (2 * q);
        const inverseA0 = 1 / (1 + alpha);
        const half = (1 + cosine) * 0.5;
        filter.b0 = half * inverseA0;
        filter.b1 = -(1 + cosine) * inverseA0;
        filter.b2 = filter.b0;
        filter.a1 = -2 * cosine * inverseA0;
        filter.a2 = (1 - alpha) * inverseA0;
    }

    function configureNotch(filter, frequency, q, sampleRate) {
        const omega = TWO_PI * frequency / sampleRate;
        const cosine = Math.cos(omega);
        const sine = Math.sin(omega);
        const alpha = sine / (2 * q);
        const inverseA0 = 1 / (1 + alpha);
        filter.b0 = inverseA0;
        filter.b1 = -2 * cosine * inverseA0;
        filter.b2 = inverseA0;
        filter.a1 = filter.b1;
        filter.a2 = (1 - alpha) * inverseA0;
    }

    function configureBandPass(filter, frequency, q, sampleRate) {
        const omega = TWO_PI * frequency / sampleRate;
        const cosine = Math.cos(omega);
        const sine = Math.sin(omega);
        const alpha = sine / (2 * q);
        const inverseA0 = 1 / (1 + alpha);
        filter.b0 = alpha * inverseA0;
        filter.b1 = 0;
        filter.b2 = -filter.b0;
        filter.a1 = -2 * cosine * inverseA0;
        filter.a2 = (1 - alpha) * inverseA0;
    }

    function configurePeak(filter, frequency, q, gainDb, sampleRate) {
        const amplitude = Math.pow(10, gainDb / 40);
        const omega = TWO_PI * frequency / sampleRate;
        const cosine = Math.cos(omega);
        const sine = Math.sin(omega);
        const alpha = sine / (2 * q);
        const inverseA0 = 1 / (1 + alpha / amplitude);
        filter.b0 = (1 + alpha * amplitude) * inverseA0;
        filter.b1 = -2 * cosine * inverseA0;
        filter.b2 = (1 - alpha * amplitude) * inverseA0;
        filter.a1 = filter.b1;
        filter.a2 = (1 - alpha / amplitude) * inverseA0;
    }

    function processBiquad(filter, input) {
        const output = filter.b0 * input + filter.z1;
        filter.z1 = filter.b1 * input - filter.a1 * output + filter.z2;
        filter.z2 = filter.b2 * input - filter.a2 * output;
        return output;
    }

    function processBank(bank, input) {
        let output = input;
        for (let index = 0; index < bank.length; index++) {
            output = processBiquad(bank[index], output);
        }
        return output;
    }

    function configureBank(bank, frequency, qValues, sampleRate) {
        for (let index = 0; index < bank.length; index++) {
            configureLowPass(bank[index], frequency, qValues[index], sampleRate);
        }
    }

    function bankNoiseNormalizer(bank) {
        const probe = bank.map(filter => ({ ...filter, z1: 0, z2: 0 }));
        let energy = 0;
        for (let index = 0; index < 4096; index++) {
            const output = processBank(probe, index === 0 ? 1 : 0);
            energy += output * output;
        }
        return energy > 1e-20 ? 1 / Math.sqrt(energy) : 1;
    }

    function resetBiquadState(filter) {
        filter.z1 = 0;
        filter.z2 = 0;
    }

    function resetBankState(bank) {
        for (let index = 0; index < bank.length; index++) resetBiquadState(bank[index]);
    }

    function copyBiquad(target, source) {
        target.b0 = source.b0;
        target.b1 = source.b1;
        target.b2 = source.b2;
        target.a1 = source.a1;
        target.a2 = source.a2;
        target.z1 = source.z1;
        target.z2 = source.z2;
    }

    function besselI0(value) {
        const half = value * 0.5;
        let term = 1;
        let sum = 1;
        for (let order = 1; order < 32; order++) {
            term *= (half / order) * (half / order);
            sum += term;
            if (term < sum * 1e-16) break;
        }
        return sum;
    }

    function sinc(value) {
        if (value === 0) return 1;
        const argument = PI * value;
        return Math.sin(argument) / argument;
    }

    function requiredCquamMaskTaps(sampleRate) {
        const attenuationDb = 90;
        const oversampledRate = sampleRate * 3;
        const passbandHz = 11000;
        const stopbandHz = 24000;
        const transitionRadians = TWO_PI * (stopbandHz - passbandHz) / oversampledRate;
        let taps = Math.ceil((attenuationDb - 8) / (2.285 * transitionRadians)) + 1;
        if ((taps & 1) === 0) taps++;
        return taps;
    }

    function cquamFrequencyWarmupSamples(sampleRate) {
        let maximumPoleRadius = 0;
        const filter = makeBiquad();
        for (let index = 0; index < BUTTERWORTH_6_Q.length; index++) {
            configureLowPass(filter, MINIMUM_IF_CUTOFF_HZ, BUTTERWORTH_6_Q[index], sampleRate);
            const poleRadius = Math.sqrt(filter.a2 > 0 ? filter.a2 : 0);
            if (poleRadius > maximumPoleRadius) maximumPoleRadius = poleRadius;
        }
        const ifSettlingSamples = maximumPoleRadius > 0 && maximumPoleRadius < 1 ?
            Math.ceil(Math.log(CQUAM_EPSILON_ABSOLUTE) / Math.log(maximumPoleRadius)) : 0;
        const maskGroupDelaySamples = Math.ceil((requiredCquamMaskTaps(sampleRate) - 1) / 6);
        return maskGroupDelaySamples + ifSettlingSamples;
    }

    function designCquamMask(sampleRate) {
        const attenuationDb = 90;
        const oversampledRate = sampleRate * 3;
        const passbandHz = 11000;
        const stopbandHz = 24000;
        const taps = requiredCquamMaskTaps(sampleRate);
        if (taps > MAXIMUM_CQUAM_MASK_TAPS) return null;
        const beta = 0.1102 * (attenuationDb - 8.7);
        const cutoffHz = (passbandHz + stopbandHz) * 0.5;
        const coefficients = new Float64Array(taps);
        const middle = (taps - 1) * 0.5;
        const denominator = besselI0(beta);
        let sum = 0;
        for (let tap = 0; tap < taps; tap++) {
            const offset = tap - middle;
            const normalized = offset / middle;
            const remaining = 1 - normalized * normalized;
            const window = besselI0(beta * Math.sqrt(remaining > 0 ? remaining : 0)) /
                denominator;
            const lowPass = 2 * cutoffHz / oversampledRate *
                sinc(2 * cutoffHz * offset / oversampledRate);
            coefficients[tap] = lowPass * window;
            sum += coefficients[tap];
        }
        for (let tap = 0; tap < taps; tap++) coefficients[tap] /= sum;
        return coefficients;
    }

    function processCquamMask(state, inputI, inputQ, emit) {
        state.cquamMaskI[state.cquamMaskPosition] = inputI;
        state.cquamMaskQ[state.cquamMaskPosition] = inputQ;
        state.cquamMaskPosition++;
        if (state.cquamMaskPosition === state.cquamMaskCoefficients.length) {
            state.cquamMaskPosition = 0;
        }
        if (!emit) return null;
        let outputI = 0;
        let outputQ = 0;
        let position = state.cquamMaskPosition;
        for (let tap = 0; tap < state.cquamMaskCoefficients.length; tap++) {
            position--;
            if (position < 0) position = state.cquamMaskCoefficients.length - 1;
            const coefficient = state.cquamMaskCoefficients[tap];
            outputI += coefficient * state.cquamMaskI[position];
            outputQ += coefficient * state.cquamMaskQ[position];
        }
        return { i: outputI, q: outputQ };
    }

    function filterGroupDelayAtDc(bank) {
        const omega = 1e-6;
        let real = 1;
        let imaginary = 0;
        for (let index = 0; index < bank.length; index++) {
            const filter = bank[index];
            const c1 = Math.cos(omega);
            const s1 = -Math.sin(omega);
            const c2 = Math.cos(2 * omega);
            const s2 = -Math.sin(2 * omega);
            const numeratorReal = filter.b0 + filter.b1 * c1 + filter.b2 * c2;
            const numeratorImaginary = filter.b1 * s1 + filter.b2 * s2;
            const denominatorReal = 1 + filter.a1 * c1 + filter.a2 * c2;
            const denominatorImaginary = filter.a1 * s1 + filter.a2 * s2;
            const denominatorPower = denominatorReal * denominatorReal +
                denominatorImaginary * denominatorImaginary;
            const sectionReal = (numeratorReal * denominatorReal +
                numeratorImaginary * denominatorImaginary) / denominatorPower;
            const sectionImaginary = (numeratorImaginary * denominatorReal -
                numeratorReal * denominatorImaginary) / denominatorPower;
            const nextReal = real * sectionReal - imaginary * sectionImaginary;
            imaginary = real * sectionImaginary + imaginary * sectionReal;
            real = nextReal;
        }
        return -Math.atan2(imaginary, real) / omega;
    }

    function nextRandom(state) {
        let value = state.randomState >>> 0;
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        state.randomState = value >>> 0;
        return state.randomState / FLOAT32_SCALE;
    }

    function nextStaticRandom(state) {
        let value = state.staticRandomState >>> 0;
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        state.staticRandomState = value >>> 0;
        return state.staticRandomState / FLOAT32_SCALE;
    }

    function staticIntervalSeconds(state, rate) {
        let draw = nextStaticRandom(state);
        if (draw > 1 - 1e-12) draw = 1 - 1e-12;
        return -Math.log(1 - draw) / rate;
    }

    function gaussian(state) {
        if (state.gaussianHasSpare) {
            state.gaussianHasSpare = false;
            return state.gaussianSpare;
        }
        let first = nextRandom(state);
        if (first < 1e-12) first = 1e-12;
        const second = nextRandom(state);
        const radius = Math.sqrt(-2 * Math.log(first));
        const phase = TWO_PI * second;
        state.gaussianSpare = radius * Math.sin(phase);
        state.gaussianHasSpare = true;
        return radius * Math.cos(phase);
    }

    function fastTanh(value) {
        if (value >= 3) return 1;
        if (value <= -3) return -1;
        const squared = value * value;
        return value * (27 + squared) / (27 + 9 * squared);
    }

    function asymmetricLimit(value) {
        if (value > 0.95) return 0.95 + 0.30 * fastTanh((value - 0.95) / 0.30);
        if (value < -0.75) return -0.75 - 0.25 * fastTanh((-value - 0.75) / 0.25);
        return value;
    }

    function clampTuningOffset(offsetHz) {
        if (offsetHz < -MAXIMUM_DIGITAL_TUNING_HZ) return -MAXIMUM_DIGITAL_TUNING_HZ;
        if (offsetHz > MAXIMUM_DIGITAL_TUNING_HZ) return MAXIMUM_DIGITAL_TUNING_HZ;
        return offsetHz;
    }

    function butterworth6Magnitude(frequencyHz, cutoffHz) {
        if (frequencyHz <= 0) return 1;
        const ratio = frequencyHz / cutoffHz;
        const squared = ratio * ratio;
        const sixth = squared * squared * squared;
        return 1 / Math.sqrt(1 + sixth * sixth);
    }

    function tuningReceptionGain(offsetHz, modeledOffsetHz, programBandwidthHz, ifCutoffHz) {
        const absoluteOffset = offsetHz < 0 ? -offsetHz : offsetHz;
        const absoluteModeled = modeledOffsetHz < 0 ? -modeledOffsetHz : modeledOffsetHz;
        let trueEdge = absoluteOffset - programBandwidthHz;
        let modeledEdge = absoluteModeled - programBandwidthHz;
        if (trueEdge < 0) trueEdge = 0;
        if (modeledEdge < 0) modeledEdge = 0;
        const modeledResponse = butterworth6Magnitude(modeledEdge, ifCutoffHz);
        const trueResponse = butterworth6Magnitude(trueEdge, ifCutoffHz);
        const gain = trueResponse / modeledResponse;
        return gain < 1 ? gain : 1;
    }

    function updateTuningModel(state) {
        const tuningHz = state.controls.tn * 1000;
        const interfererHz = tuningHz + state.controls.io * 1000;
        const ifCutoffHz = state.controls.bw * 500;
        state.stationTuningOffsetHz = clampTuningOffset(tuningHz);
        state.interfererTuningOffsetHz = clampTuningOffset(interfererHz);
        state.stationTuningPhaseIncrement = TWO_PI * state.stationTuningOffsetHz / state.sampleRate;
        state.interfererTuningPhaseIncrement = TWO_PI * state.interfererTuningOffsetHz / state.sampleRate;
        state.stationTuningGain = tuningReceptionGain(tuningHz, state.stationTuningOffsetHz,
            state.controls.tb * 1000, ifCutoffHz);
        state.interfererTuningGain = tuningReceptionGain(interfererHz,
            state.interfererTuningOffsetHz, 4500, ifCutoffHz);
    }

    function advancePhase(state, key, increment) {
        state[key] += increment;
        if (state[key] >= TWO_PI) state[key] -= TWO_PI;
        else if (state[key] < 0) state[key] += TWO_PI;
    }

    function speakerIndex(value) {
        return value === 'Off' ? 0 : (value === 'Table' ? 2 : 1);
    }

    function resetBiquad(filter) {
        filter.b0 = 1;
        filter.b1 = 0;
        filter.b2 = 0;
        filter.a1 = 0;
        filter.a2 = 0;
        filter.z1 = 0;
        filter.z2 = 0;
    }

    function configureSpeakerPath(speaker, highPass, peak, lowPass, sampleRate) {
        resetBiquad(highPass);
        resetBiquad(peak);
        resetBiquad(lowPass);
        if (speaker === 0) return;
        const highFrequency = speaker === 1 ? 220 : 120;
        const highQ = speaker === 1 ? 0.9 : 0.8;
        const peakFrequency = speaker === 1 ? 1900 : 2600;
        const peakQ = speaker === 1 ? 2.0 : 1.6;
        const peakGain = speaker === 1 ? 4.5 : 3.0;
        const lowFrequency = speaker === 1 ? 3800 : 5500;
        configureHighPass(highPass, highFrequency, highQ, sampleRate);
        configurePeak(peak, peakFrequency, peakQ, peakGain, sampleRate);
        configureLowPass(lowPass, lowFrequency, SQRT_HALF, sampleRate);
    }

    function processSpeakerPath(speaker, highPass, peak, lowPass, input) {
        if (speaker === 0) return input;
        return processBiquad(lowPass, processBiquad(peak, processBiquad(highPass, input)));
    }

    function startSpeakerTransition(state, speaker) {
        configureSpeakerPath(speaker, state.nextSpeakerHighPass, state.nextSpeakerPeak,
            state.nextSpeakerLowPass, state.sampleRate);
        state.speakerTarget = speaker;
        const samples = Math.floor(state.sampleRate * SPEAKER_TRANSITION_TIME + 0.5);
        state.speakerTransitionTotal = samples >= 1 ? samples : 1;
        state.speakerTransitionRemaining = state.speakerTransitionTotal;
    }

    function agcSpeedIndex(value) {
        return value === 'Slow' ? 0 : (value === 'Fast' ? 2 : 1);
    }

    function updateDetectorCoefficients(state) {
        const releaseSeconds = state.controls.dt * 1e-6;
        // Detector RC represents RL*C; the fixed Rd/RL ratio supplies (Rd || RL)*C while charging.
        const chargeSeconds = releaseSeconds * DETECTOR_DIODE_TO_LOAD_RESISTANCE_RATIO /
            (1 + DETECTOR_DIODE_TO_LOAD_RESISTANCE_RATIO);
        state.detectorCharge = Math.exp(-1 / (state.sampleRate * 5 * chargeSeconds));
        state.detectorRelease = Math.exp(-1 / (state.sampleRate * 5 * releaseSeconds));
    }

    function updateControlCoefficients(state, agcSpeed) {
        state.preEmphasisShelfGain = Math.pow(10, state.controls.pe / 200) - 1;
        state.limiterThreshold = Math.pow(10, -state.controls.cp / 20);
        state.limiterDepth = state.controls.cp / 20;
        state.modulation = state.controls.md * 0.01;
        const sky = state.controls.sk * 0.01;
        state.groundGain = Math.sqrt(1 - sky);
        state.skyGain = Math.sqrt(sky * 0.5);
        state.signalGain = Math.pow(10, state.controls.sg / 20);
        state.interfererGain = Math.pow(10, state.controls.in / 20);
        state.staticProbability = 1 - Math.exp(-state.controls.st / state.sampleRate);
        state.humAmount = Math.pow(10, state.controls.hm / 20);
        state.humPhaseIncrement = TWO_PI * state.controls.hz / state.sampleRate;
        state.agcLinearGain = Math.pow(10, state.agcGainDb / 20);
        state.inverseAgcLinearGain = 1 / state.agcLinearGain;
        state.outputGain = Math.pow(10, state.controls.og / 20);
        state.mix = state.controls.mx * 0.01;
        state.dryMix = 1 - state.mix;
        state.agcDetectorAttackCoefficient =
            1 - Math.exp(-1 / (state.sampleRate * AGC_ATTACK_TIMES[agcSpeed]));
        state.agcDetectorReleaseCoefficient =
            1 - Math.exp(-1 / (state.sampleRate * AGC_RELEASE_TIMES[agcSpeed]));
    }

    function makeState(sampleRate, pairChannels, speaker, baseSeed) {
        const delayLength = Math.ceil(sampleRate * 0.003) + 4;
        const cquamMaskSupported =
            requiredCquamMaskTaps(sampleRate) <= MAXIMUM_CQUAM_MASK_TAPS;
        const stereoMode = parameters.sm === 'C-QUAM' && cquamMaskSupported ?
            'C-QUAM' : 'Mono';
        const cquamMaskCoefficients = stereoMode === 'C-QUAM' ?
            designCquamMask(sampleRate) : null;
        const cquamPllQualifySamples = Math.max(1, Math.round(sampleRate * 0.100));
        const cquamPllFrequencyWarmupSamples = cquamFrequencyWarmupSamples(sampleRate);
        const normalizedBase = (baseSeed >>> 0) === 0 ?
            STATIC_ZERO_FALLBACK : baseSeed >>> 0;
        let staticRandomState = (normalizedBase ^ STATIC_RANDOM_SALT) >>> 0;
        if (staticRandomState === 0) staticRandomState = STATIC_ZERO_FALLBACK;
        const state = {
            sampleRate,
            pairChannels,
            speaker,
            stereoMode,
            cquamMaskSupported,
            previousStereoMode: null,
            modeTransitionTotal: 0,
            modeTransitionPosition: 0,
            randomState: normalizedBase,
            staticRandomState,
            staticNextEventDeadlineSeconds: -1,
            staticScheduledRate: 0,
            staticScheduleActive: false,
            gaussianHasSpare: false,
            gaussianSpare: 0,
            delay: new Float64Array(delayLength),
            delayQ: new Float64Array(delayLength),
            transitionDelay: new Float64Array(delayLength),
            transitionDelayQ: new Float64Array(delayLength),
            delayPosition: 0,
            transitionDelayPosition: 0,
            delay1Samples: Math.floor(sampleRate * 0.0007 + 0.5),
            delay2Samples: Math.floor(sampleRate * 0.0023 + 0.5),
            sampleCounter: 0,
            controlRemaining: 0,
            controlSmoothing: 1 - Math.exp(-CONTROL_INTERVAL / (sampleRate * 0.020)),
            controls: {
                tb: parameters.tb, pe: parameters.pe, md: parameters.md, cp: parameters.cp,
                sg: parameters.sg, sk: parameters.sk, fd: parameters.fd, st: parameters.st,
                in: parameters.in, io: parameters.io, tn: parameters.tn, bw: parameters.bw,
                dt: parameters.dt, hm: parameters.hm, og: parameters.og, mx: parameters.mx,
                hz: Number(parameters.hz)
            },
            txHighPass: makeBiquad(),
            txDifferenceHighPass: makeBiquad(),
            preEmphasisPole: Math.exp(-TWO_PI * 2100 / sampleRate),
            preEmphasisShelfGain: 0,
            preEmphasisLow: 0,
            differencePreEmphasisLow: 0,
            limiterAttackCoefficient: Math.exp(-1 / (sampleRate * 0.002)),
            limiterReleaseCoefficient: Math.exp(-1 / (sampleRate * 0.080)),
            limiterThreshold: 1,
            limiterDepth: 0,
            limiterEnvelope: 0,
            limiterGain: 1,
            modulation: 0,
            txInterp: makeBank(2),
            txFilters: makeBank(4),
            txDifferenceInterp: makeBank(2),
            txDifferenceFilters: makeBank(4),
            cquamMaskCoefficients,
            cquamMaskI: new Float64Array(cquamMaskCoefficients?.length ?? 0),
            cquamMaskQ: new Float64Array(cquamMaskCoefficients?.length ?? 0),
            cquamMaskPosition: 0,
            cquamOversampledCounter: 0,
            cquamTanInternalPhaseLimit: Math.tan(CQUAM_INTERNAL_PHASE_LIMIT),
            fade1: { i1: 0, i2: 0, q1: 0, q2: 0, i: 0, q: 0, stepI: 0, stepQ: 0 },
            fade2: { i1: 0, i2: 0, q1: 0, q2: 0, i: 0, q: 0, stepI: 0, stepQ: 0 },
            groundGain: 1,
            skyGain: 0,
            signalGain: 1,
            interfererFilters: makeBank(2),
            interfererNormalizer: 1,
            interfererProgram: 0,
            interfererGain: 0,
            interfererPhase: 0,
            tuningPhase: 0,
            stationTuningOffsetHz: 0,
            interfererTuningOffsetHz: 0,
            stationTuningPhaseIncrement: 0,
            interfererTuningPhaseIncrement: 0,
            stationTuningGain: 1,
            interfererTuningGain: 1,
            thermalNoiseStd: 0.001 * THERMAL_NOISE_CALIBRATION * Math.sqrt(sampleRate / 12000),
            staticProbability: 0,
            humPhase: 0,
            humAmount: 0,
            humPhaseIncrement: 0,
            ifI: makeBank(3),
            ifQ: makeBank(3),
            transitionIfI: makeBank(3),
            transitionIfQ: makeBank(3),
            detectorInterpI: makeBank(3),
            detectorInterpQ: makeBank(3),
            detectorDecimation: makeBank(2),
            detectorCapacitor: 0,
            detectorClipping: false,
            detectorCharge: 0,
            detectorRelease: 0,
            agcDetectorStage1: 1,
            agcDetectorStage2: 1,
            agcDetectorAttackCoefficient: 0,
            agcDetectorReleaseCoefficient: 0,
            agcGainDb: 0,
            agcLinearGain: 1,
            inverseAgcLinearGain: 1,
            transitionAgcDetectorStage1: 1,
            transitionAgcDetectorStage2: 1,
            transitionAgcGainDb: 0,
            transitionAgcLinearGain: 1,
            transitionInverseAgcLinearGain: 1,
            dcPreviousInput: 0,
            dcPreviousOutput: 0,
            dcCoefficient: Math.exp(-TWO_PI * 20 / sampleRate),
            cquamInterpI: makeBank(3),
            cquamInterpQ: makeBank(3),
            cquamSumDecimation: makeBank(2),
            cquamDifferenceDecimation: makeBank(2),
            cquamInterpolatorDelayHostSamples: 0,
            cquamPllPhase: 0,
            cquamPllFrequency: 0,
            cquamPllFrequencyLimit: TWO_PI * 500 / sampleRate,
            cquamPllTotalFrequencyHz: 0,
            cquamPllTotalFrequencyValid: false,
            cquamPllTotalFrequencyAlpha: 1 - Math.exp(-1 / (sampleRate * 0.200)),
            cquamPllFrequencyWarmupSamples,
            cquamPllFrequencyWarmupRemaining: cquamPllFrequencyWarmupSamples,
            cquamPllPreviousI: 0,
            cquamPllPreviousQ: 0,
            cquamPllPreviousValid: false,
            cquamPllResidualFrequencyHz: 0,
            cquamPllState: 'CAPTURE',
            cquamPllQualifyHold: 0,
            cquamPllOutsideHold: 0,
            cquamPllPilotLossHold: 0,
            cquamPllQualifySamples,
            cquamPllOutsideSamples: Math.max(1, Math.round(sampleRate * 0.200)),
            cquamPllPilotLossSamples: Math.max(1, Math.round(sampleRate * 1.000)),
            cquamPllFrequencyHistory: new Float64Array(cquamPllQualifySamples),
            cquamPllHistoryPosition: 0,
            cquamPilotBandPass: makeBiquad(),
            cquamPilotLevel: 0,
            cquamPilotLevelAlpha: 1 - Math.exp(-1 / (sampleRate * 0.200)),
            cquamNominalPilotAtAgcTarget: CQUAM_PILOT_AMPLITUDE * Math.pow(10, -6 / 20),
            cquamPilotDetected: false,
            cquamBlend: 0,
            qualityTerm: 1,
            qualityPilotBandPass: makeBiquad(),
            qualitySumStrength: 0,
            qualityPilotStrength: 0,
            qualitySumReference: 0,
            qualityPilotReference: 0,
            qualityDetectedSum: 0,
            qualityPilotPowerSum: 0,
            qualityDetectedCount: 0,
            qualityWindowSamples: Math.max(1, Math.round(sampleRate * 0.100)),
            qualityObservationValid: false,
            qualityStrengthAlpha: 1 - Math.exp(-0.100 / 0.200),
            qualityPilotStrengthAlpha: 1 - Math.exp(-0.100 / 0.050),
            qualityReferenceRiseAlpha: 1 - Math.exp(-0.100 / 0.500),
            qualityReferenceFallAlpha: 1 - Math.exp(-0.100 / 60.000),
            cquamBlendAlpha: 1 - Math.exp(-1 / (sampleRate * 0.100)),
            cquamLeftPilotNotch: makeBiquad(),
            cquamRightPilotNotch: makeBiquad(),
            cquamDcLeftInput: 0,
            cquamDcLeftOutput: 0,
            cquamDcRightInput: 0,
            cquamDcRightOutput: 0,
            lastIfEnvelope: 0,
            transitionLastIfEnvelope: 0,
            speakerHighPass: makeBiquad(),
            speakerPeak: makeBiquad(),
            speakerLowPass: makeBiquad(),
            nextSpeakerHighPass: makeBiquad(),
            nextSpeakerPeak: makeBiquad(),
            nextSpeakerLowPass: makeBiquad(),
            cquamSpeakerHighPassLeft: makeBiquad(),
            cquamSpeakerPeakLeft: makeBiquad(),
            cquamSpeakerLowPassLeft: makeBiquad(),
            cquamSpeakerHighPassRight: makeBiquad(),
            cquamSpeakerPeakRight: makeBiquad(),
            cquamSpeakerLowPassRight: makeBiquad(),
            nextCquamSpeakerHighPassLeft: makeBiquad(),
            nextCquamSpeakerPeakLeft: makeBiquad(),
            nextCquamSpeakerLowPassLeft: makeBiquad(),
            nextCquamSpeakerHighPassRight: makeBiquad(),
            nextCquamSpeakerPeakRight: makeBiquad(),
            nextCquamSpeakerLowPassRight: makeBiquad(),
            cquamSpeaker: speaker,
            cquamSpeakerTarget: speaker,
            cquamSpeakerTransitionTotal: 0,
            cquamSpeakerTransitionRemaining: 0,
            outputGain: 1,
            mix: 1,
            dryMix: 0,
            speakerTarget: speaker,
            speakerTransitionTotal: 0,
            speakerTransitionRemaining: 0,
            carrierPreAgcDb: 0,
            transitionCarrierPreAgcDb: 0,
            modPercent: 0,
            fadeDb: 0,
            staticCount: 0,
            clipCount: 0,
            clipActive: false,
            stereoBlend: 0
        };
        configureHighPass(state.txHighPass, 50, SQRT_HALF, sampleRate);
        configureHighPass(state.txDifferenceHighPass, 50, SQRT_HALF, sampleRate);
        configureBank(state.txInterp, 14000, BUTTERWORTH_4_Q, sampleRate * 3);
        configureBank(state.txFilters, parameters.tb * 1000, BUTTERWORTH_8_Q, sampleRate * 3);
        configureBank(state.txDifferenceInterp, 14000, BUTTERWORTH_4_Q, sampleRate * 3);
        configureBank(state.txDifferenceFilters, parameters.tb * 1000,
            BUTTERWORTH_8_Q, sampleRate * 3);
        configureBank(state.ifI, parameters.bw * 500, BUTTERWORTH_6_Q, sampleRate);
        configureBank(state.ifQ, parameters.bw * 500, BUTTERWORTH_6_Q, sampleRate);
        updateTuningModel(state);
        const initialPath = Math.sqrt(1 - parameters.sk * 0.01);
        const initialIfResponse = butterworth6Magnitude(
            state.stationTuningOffsetHz < 0 ? -state.stationTuningOffsetHz :
                state.stationTuningOffsetHz,
            parameters.bw * 500);
        const initialStation = Math.pow(10, parameters.sg / 20) * initialPath *
            state.stationTuningGain * initialIfResponse;
        const initialNoise = 0.001 * Math.sqrt(parameters.bw / 12);
        let initialCarrier = Math.sqrt(initialStation * initialStation + initialNoise * initialNoise);
        if (initialCarrier < 1e-6) initialCarrier = 1e-6;
        const initialCarrierDb = 20 * Math.log10(initialCarrier);
        let initialAgcGainDb = AGC_TARGET_DB - initialCarrierDb;
        if (initialAgcGainDb < AGC_MINIMUM_GAIN_DB) initialAgcGainDb = AGC_MINIMUM_GAIN_DB;
        if (initialAgcGainDb > AGC_MAXIMUM_GAIN_DB) initialAgcGainDb = AGC_MAXIMUM_GAIN_DB;
        state.agcDetectorStage1 = initialCarrier;
        state.agcDetectorStage2 = initialCarrier;
        state.agcGainDb = initialAgcGainDb;
        state.carrierPreAgcDb = initialCarrierDb;
        state.transitionAgcDetectorStage1 = initialCarrier;
        state.transitionAgcDetectorStage2 = initialCarrier;
        state.transitionAgcGainDb = initialAgcGainDb;
        state.transitionCarrierPreAgcDb = initialCarrierDb;
        configureBank(state.interfererFilters, 4500, BUTTERWORTH_4_Q, sampleRate);
        state.interfererNormalizer = bankNoiseNormalizer(state.interfererFilters);
        configureBank(state.detectorInterpI, 14000, BUTTERWORTH_6_Q, sampleRate * 5);
        configureBank(state.detectorInterpQ, 14000, BUTTERWORTH_6_Q, sampleRate * 5);
        configureBank(state.detectorDecimation, 10000, BUTTERWORTH_4_Q, sampleRate * 5);
        configureBank(state.cquamInterpI, 14000, BUTTERWORTH_6_Q, sampleRate * 5);
        configureBank(state.cquamInterpQ, 14000, BUTTERWORTH_6_Q, sampleRate * 5);
        configureBank(state.cquamSumDecimation, 10000, BUTTERWORTH_4_Q, sampleRate * 5);
        configureBank(state.cquamDifferenceDecimation, 10000, BUTTERWORTH_4_Q,
            sampleRate * 5);
        state.cquamInterpolatorDelayHostSamples = filterGroupDelayAtDc(state.cquamInterpI) / 5;
        configureBandPass(state.cquamPilotBandPass, CQUAM_PILOT_FREQUENCY, 8, sampleRate);
        configureBandPass(state.qualityPilotBandPass, CQUAM_PILOT_FREQUENCY, 4, sampleRate);
        configureNotch(state.cquamLeftPilotNotch, CQUAM_PILOT_FREQUENCY, 2.5, sampleRate);
        configureNotch(state.cquamRightPilotNotch, CQUAM_PILOT_FREQUENCY, 2.5, sampleRate);
        updateDetectorCoefficients(state);
        updateControlCoefficients(state, agcSpeedIndex(parameters.ag));
        state.transitionAgcLinearGain = state.agcLinearGain;
        state.transitionInverseAgcLinearGain = state.inverseAgcLinearGain;
        for (let index = 0; index < state.ifI.length; index++) {
            copyBiquad(state.transitionIfI[index], state.ifI[index]);
            copyBiquad(state.transitionIfQ[index], state.ifQ[index]);
        }
        configureSpeakerPath(speaker, state.speakerHighPass, state.speakerPeak,
            state.speakerLowPass, sampleRate);
        configureSpeakerPath(speaker, state.cquamSpeakerHighPassLeft,
            state.cquamSpeakerPeakLeft, state.cquamSpeakerLowPassLeft, sampleRate);
        configureSpeakerPath(speaker, state.cquamSpeakerHighPassRight,
            state.cquamSpeakerPeakRight, state.cquamSpeakerLowPassRight, sampleRate);
        return state;
    }

    function copySpeakerState(targetHighPass, targetPeak, targetLowPass,
        sourceHighPass, sourcePeak, sourceLowPass) {
        copyBiquad(targetHighPass, sourceHighPass);
        copyBiquad(targetPeak, sourcePeak);
        copyBiquad(targetLowPass, sourceLowPass);
    }

    function resetCquamPll(state) {
        state.cquamPllPhase = 0;
        state.cquamPllFrequency = 0;
        state.cquamPllTotalFrequencyHz = 0;
        state.cquamPllTotalFrequencyValid = false;
        state.cquamPllFrequencyWarmupRemaining = state.cquamPllFrequencyWarmupSamples;
        state.cquamPllPreviousI = 0;
        state.cquamPllPreviousQ = 0;
        state.cquamPllPreviousValid = false;
        state.cquamPllResidualFrequencyHz = 0;
        state.cquamPllState = 'CAPTURE';
        state.cquamPllQualifyHold = 0;
        state.cquamPllOutsideHold = 0;
        state.cquamPllPilotLossHold = 0;
        state.cquamPllHistoryPosition = 0;
        state.cquamPllFrequencyHistory.fill(0);
    }

    function ensureCquamMask(state) {
        if (state.cquamMaskCoefficients || !state.cquamMaskSupported) return;
        state.cquamMaskCoefficients = designCquamMask(state.sampleRate);
        state.cquamMaskI = new Float64Array(state.cquamMaskCoefficients.length);
        state.cquamMaskQ = new Float64Array(state.cquamMaskCoefficients.length);
    }

    function resetCquamState(state) {
        state.delayQ.fill(0);
        state.transitionDelayQ.fill(0);
        resetBiquadState(state.txDifferenceHighPass);
        state.differencePreEmphasisLow = 0;
        resetBankState(state.txDifferenceInterp);
        resetBankState(state.txDifferenceFilters);
        state.cquamMaskI.fill(0);
        state.cquamMaskQ.fill(0);
        state.cquamMaskPosition = 0;
        state.cquamOversampledCounter = 0;
        resetBankState(state.cquamInterpI);
        resetBankState(state.cquamInterpQ);
        resetBankState(state.cquamSumDecimation);
        resetBankState(state.cquamDifferenceDecimation);
        resetCquamPll(state);
        resetBiquadState(state.cquamPilotBandPass);
        resetBiquadState(state.qualityPilotBandPass);
        resetBiquadState(state.cquamLeftPilotNotch);
        resetBiquadState(state.cquamRightPilotNotch);
        state.cquamPilotLevel = 0;
        state.cquamPilotDetected = false;
        state.cquamBlend = 0;
        state.qualityTerm = 1;
        state.qualitySumStrength = 0;
        state.qualityPilotStrength = 0;
        state.qualitySumReference = 0;
        state.qualityPilotReference = 0;
        state.qualityDetectedSum = 0;
        state.qualityPilotPowerSum = 0;
        state.qualityDetectedCount = 0;
        state.qualityObservationValid = false;
        state.cquamDcLeftInput = 0;
        state.cquamDcLeftOutput = 0;
        state.cquamDcRightInput = 0;
        state.cquamDcRightOutput = 0;
        state.stereoBlend = 0;
    }

    function startCquamSpeakerTransition(state, speaker) {
        configureSpeakerPath(speaker, state.nextCquamSpeakerHighPassLeft,
            state.nextCquamSpeakerPeakLeft, state.nextCquamSpeakerLowPassLeft, state.sampleRate);
        configureSpeakerPath(speaker, state.nextCquamSpeakerHighPassRight,
            state.nextCquamSpeakerPeakRight, state.nextCquamSpeakerLowPassRight, state.sampleRate);
        state.cquamSpeakerTarget = speaker;
        const samples = Math.floor(state.sampleRate * SPEAKER_TRANSITION_TIME + 0.5);
        state.cquamSpeakerTransitionTotal = samples >= 1 ? samples : 1;
        state.cquamSpeakerTransitionRemaining = state.cquamSpeakerTransitionTotal;
    }

    function startModeTransition(state, nextMode) {
        state.previousStereoMode = state.stereoMode;
        state.stereoMode = nextMode;
        state.transitionDelay.fill(0);
        state.transitionDelayQ.fill(0);
        state.transitionDelayPosition = state.delayPosition;
        for (let index = 0; index < state.ifI.length; index++) {
            copyBiquad(state.transitionIfI[index], state.ifI[index]);
            copyBiquad(state.transitionIfQ[index], state.ifQ[index]);
        }
        state.transitionAgcDetectorStage1 = state.agcDetectorStage1;
        state.transitionAgcDetectorStage2 = state.agcDetectorStage2;
        state.transitionAgcGainDb = state.agcGainDb;
        state.transitionAgcLinearGain = state.agcLinearGain;
        state.transitionInverseAgcLinearGain = state.inverseAgcLinearGain;
        state.transitionCarrierPreAgcDb = state.carrierPreAgcDb;
        state.transitionLastIfEnvelope = state.lastIfEnvelope;
        if (nextMode === 'C-QUAM') {
            ensureCquamMask(state);
            resetCquamState(state);
            copySpeakerState(state.cquamSpeakerHighPassLeft, state.cquamSpeakerPeakLeft,
                state.cquamSpeakerLowPassLeft, state.speakerHighPass, state.speakerPeak,
                state.speakerLowPass);
            copySpeakerState(state.cquamSpeakerHighPassRight, state.cquamSpeakerPeakRight,
                state.cquamSpeakerLowPassRight, state.speakerHighPass, state.speakerPeak,
                state.speakerLowPass);
            state.cquamSpeaker = state.speaker;
            state.cquamSpeakerTarget = state.speaker;
            state.cquamSpeakerTransitionRemaining = 0;
        } else {
            state.detectorCapacitor = Number.isFinite(state.lastIfEnvelope) ?
                state.lastIfEnvelope : 0;
            copySpeakerState(state.speakerHighPass, state.speakerPeak, state.speakerLowPass,
                state.cquamSpeakerHighPassLeft, state.cquamSpeakerPeakLeft,
                state.cquamSpeakerLowPassLeft);
            state.speaker = state.cquamSpeaker;
            state.speakerTarget = state.cquamSpeaker;
            state.speakerTransitionRemaining = 0;
        }
        state.modeTransitionTotal = Math.max(1,
            Math.round(state.sampleRate * SPEAKER_TRANSITION_TIME));
        state.modeTransitionPosition = 0;
    }

    function finishModeTransition(state) {
        [state.delay, state.transitionDelay] = [state.transitionDelay, state.delay];
        [state.delayQ, state.transitionDelayQ] = [state.transitionDelayQ, state.delayQ];
        state.delayPosition = state.transitionDelayPosition;
        [state.ifI, state.transitionIfI] = [state.transitionIfI, state.ifI];
        [state.ifQ, state.transitionIfQ] = [state.transitionIfQ, state.ifQ];
        [state.agcDetectorStage1, state.transitionAgcDetectorStage1] =
            [state.transitionAgcDetectorStage1, state.agcDetectorStage1];
        [state.agcDetectorStage2, state.transitionAgcDetectorStage2] =
            [state.transitionAgcDetectorStage2, state.agcDetectorStage2];
        [state.agcGainDb, state.transitionAgcGainDb] =
            [state.transitionAgcGainDb, state.agcGainDb];
        [state.agcLinearGain, state.transitionAgcLinearGain] =
            [state.transitionAgcLinearGain, state.agcLinearGain];
        [state.inverseAgcLinearGain, state.transitionInverseAgcLinearGain] =
            [state.transitionInverseAgcLinearGain, state.inverseAgcLinearGain];
        [state.carrierPreAgcDb, state.transitionCarrierPreAgcDb] =
            [state.transitionCarrierPreAgcDb, state.carrierPreAgcDb];
        [state.lastIfEnvelope, state.transitionLastIfEnvelope] =
            [state.transitionLastIfEnvelope, state.lastIfEnvelope];
        state.previousStereoMode = null;
    }

    function stepCquamPll(state, i, q) {
        const magnitude = Math.sqrt(i * i + q * q);
        const valid = magnitude >= CQUAM_EPSILON_ABSOLUTE;
        if (state.cquamPllFrequencyWarmupRemaining > 0) {
            state.cquamPllFrequencyWarmupRemaining--;
            state.cquamPllPreviousValid = false;
        } else {
            if (valid && state.cquamPllPreviousValid) {
                const productReal = i * state.cquamPllPreviousI + q * state.cquamPllPreviousQ;
                const productImaginary = q * state.cquamPllPreviousI - i * state.cquamPllPreviousQ;
                const instantaneousHz = Math.atan2(productImaginary, productReal) *
                    state.sampleRate / TWO_PI;
                if (!state.cquamPllTotalFrequencyValid) {
                    state.cquamPllTotalFrequencyHz = instantaneousHz;
                    state.cquamPllTotalFrequencyValid = true;
                } else {
                    state.cquamPllTotalFrequencyHz += state.cquamPllTotalFrequencyAlpha *
                        (instantaneousHz - state.cquamPllTotalFrequencyHz);
                }
            }
            state.cquamPllPreviousI = i;
            state.cquamPllPreviousQ = q;
            state.cquamPllPreviousValid = valid;
        }

        const cosine = Math.cos(state.cquamPllPhase);
        const sine = Math.sin(state.cquamPllPhase);
        const rotatedI = i * cosine + q * sine;
        const rotatedQ = q * cosine - i * sine;
        const inverse = 1 / (magnitude > CQUAM_EPSILON_ABSOLUTE ?
            magnitude : CQUAM_EPSILON_ABSOLUTE);
        const error = rotatedQ * inverse;
        const naturalFrequency = state.cquamPllState === 'TRACK' ? 1.5 : 60;
        const damping = state.cquamPllState === 'TRACK' ? 1.0 : 0.7;
        const normalized = TWO_PI * naturalFrequency / state.sampleRate;
        let frequency = state.cquamPllFrequency + normalized * normalized * error;
        if (frequency < -state.cquamPllFrequencyLimit) {
            frequency = -state.cquamPllFrequencyLimit;
        } else if (frequency > state.cquamPllFrequencyLimit) {
            frequency = state.cquamPllFrequencyLimit;
        }
        state.cquamPllFrequency = frequency;
        const correctedPhase = state.cquamPllPhase + 2 * damping * normalized * error;
        state.cquamPllPhase = correctedPhase + frequency;
        if (state.cquamPllPhase >= TWO_PI) state.cquamPllPhase -= TWO_PI;
        else if (state.cquamPllPhase < 0) state.cquamPllPhase += TWO_PI;

        const estimatedFrequencyHz = frequency * state.sampleRate / TWO_PI;
        state.cquamPllResidualFrequencyHz = state.cquamPllTotalFrequencyHz -
            estimatedFrequencyHz;
        const oldFrequencyHz = state.cquamPllFrequencyHistory[state.cquamPllHistoryPosition];
        state.cquamPllFrequencyHistory[state.cquamPllHistoryPosition] = estimatedFrequencyHz;
        state.cquamPllHistoryPosition++;
        if (state.cquamPllHistoryPosition === state.cquamPllFrequencyHistory.length) {
            state.cquamPllHistoryPosition = 0;
        }
        const frequencyDelta = estimatedFrequencyHz - oldFrequencyHz;
        const absoluteFrequencyDelta = frequencyDelta < 0 ? -frequencyDelta : frequencyDelta;
        const absoluteResidual = state.cquamPllResidualFrequencyHz < 0 ?
            -state.cquamPllResidualFrequencyHz : state.cquamPllResidualFrequencyHz;
        const absoluteTotal = state.cquamPllTotalFrequencyHz < 0 ?
            -state.cquamPllTotalFrequencyHz : state.cquamPllTotalFrequencyHz;
        if (state.cquamPllState === 'CAPTURE') {
            const eligible = state.cquamPllTotalFrequencyValid && absoluteFrequencyDelta < 5 &&
                absoluteResidual < 5 && absoluteTotal <= 480;
            state.cquamPllQualifyHold = eligible ? state.cquamPllQualifyHold + 1 : 0;
            if (state.cquamPllQualifyHold >= state.cquamPllQualifySamples) {
                state.cquamPllState = 'TRACK';
                state.cquamPllQualifyHold = 0;
                state.cquamPllOutsideHold = 0;
                state.cquamPllPilotLossHold = 0;
            }
        } else {
            state.cquamPllOutsideHold = absoluteTotal >= 520 ?
                state.cquamPllOutsideHold + 1 : 0;
            state.cquamPllPilotLossHold = state.cquamPilotDetected ? 0 :
                state.cquamPllPilotLossHold + 1;
            if (state.cquamPllOutsideHold >= state.cquamPllOutsideSamples ||
                state.cquamPllPilotLossHold >= state.cquamPllPilotLossSamples) {
                state.cquamPllState = 'CAPTURE';
                state.cquamPllQualifyHold = 0;
                state.cquamPllOutsideHold = 0;
                state.cquamPllPilotLossHold = 0;
            }
        }
        state.cquamPllCorrectedPhase = correctedPhase;
    }

    function processCquamDecoder(state, i, q, inverseAgcLinearGain) {
        stepCquamPll(state, i, q);
        let detected = 0;
        let decodedDifference = 0;
        for (let phase = 0; phase < 5; phase++) {
            const interpolatedI = processBank(state.cquamInterpI, phase === 0 ? i * 5 : 0);
            const interpolatedQ = processBank(state.cquamInterpQ, phase === 0 ? q * 5 : 0);
            const magnitude = Math.sqrt(interpolatedI * interpolatedI +
                interpolatedQ * interpolatedQ);
            detected = processBank(state.cquamSumDecimation, magnitude);
            if (magnitude < CQUAM_EPSILON_ABSOLUTE) {
                decodedDifference = processBank(state.cquamDifferenceDecimation, 0);
            } else {
                const subSamplePhase = state.cquamPllFrequency * phase / 5;
                const delayCompensation = state.cquamPllFrequency *
                    state.cquamInterpolatorDelayHostSamples;
                const usedPhase = state.cquamPllCorrectedPhase + subSamplePhase -
                    delayCompensation;
                const cosine = Math.cos(usedPhase);
                const sine = Math.sin(usedPhase);
                const rotatedI = interpolatedI * cosine + interpolatedQ * sine;
                const rotatedQ = interpolatedQ * cosine - interpolatedI * sine;
                const relativeFloor = CQUAM_EPSILON_RELATIVE * magnitude;
                const firstFloor = rotatedI > relativeFloor ? rotatedI : relativeFloor;
                const denominator = firstFloor > CQUAM_EPSILON_ABSOLUTE ?
                    firstFloor : CQUAM_EPSILON_ABSOLUTE;
                decodedDifference = processBank(state.cquamDifferenceDecimation,
                    magnitude * rotatedQ / denominator);
            }
        }
        const pilotBand = processBiquad(state.cquamPilotBandPass, decodedDifference);
        const qualityPilotBand = processBiquad(
            state.qualityPilotBandPass,
            decodedDifference * inverseAgcLinearGain);
        state.cquamPilotLevel += state.cquamPilotLevelAlpha *
            (2 * pilotBand * pilotBand - state.cquamPilotLevel);
        const pilotPower = state.cquamPilotLevel > 0 ? state.cquamPilotLevel : 0;
        const pilotAmplitude = Math.sqrt(pilotPower);
        if (!state.cquamPilotDetected &&
            pilotAmplitude > state.cquamNominalPilotAtAgcTarget * 0.5) {
            state.cquamPilotDetected = true;
        } else if (state.cquamPilotDetected &&
            pilotAmplitude < state.cquamNominalPilotAtAgcTarget * 0.25) {
            state.cquamPilotDetected = false;
        }
        if (state.cquamPllState === 'TRACK' && state.cquamPilotDetected) {
            state.qualityDetectedSum += detected * inverseAgcLinearGain;
            state.qualityPilotPowerSum += 2 * qualityPilotBand * qualityPilotBand;
            state.qualityDetectedCount++;
            if (state.qualityDetectedCount === state.qualityWindowSamples) {
                const sumObservation = state.qualityDetectedSum /
                    state.qualityDetectedCount;
                const pilotMeanPower = state.qualityPilotPowerSum /
                    state.qualityDetectedCount;
                const pilotObservation = Math.sqrt(
                    pilotMeanPower > 0 ? pilotMeanPower : 0);
                state.qualityDetectedSum = 0;
                state.qualityPilotPowerSum = 0;
                state.qualityDetectedCount = 0;
                if (!state.qualityObservationValid) {
                    state.qualitySumStrength = sumObservation;
                    state.qualityPilotStrength = pilotObservation;
                    state.qualitySumReference = sumObservation;
                    state.qualityPilotReference = pilotObservation;
                    state.qualityObservationValid = true;
                    state.qualityTerm = 1;
                } else {
                    state.qualitySumStrength += state.qualityStrengthAlpha *
                        (sumObservation - state.qualitySumStrength);
                    state.qualityPilotStrength +=
                        state.qualityPilotStrengthAlpha *
                        (pilotObservation - state.qualityPilotStrength);
                    const sumReferenceAlpha = state.qualitySumStrength >
                        state.qualitySumReference ?
                        state.qualityReferenceRiseAlpha :
                        state.qualityReferenceFallAlpha;
                    const pilotReferenceAlpha = state.qualityPilotStrength >
                        state.qualityPilotReference ?
                        state.qualityReferenceRiseAlpha :
                        state.qualityReferenceFallAlpha;
                    state.qualitySumReference += sumReferenceAlpha *
                        (state.qualitySumStrength - state.qualitySumReference);
                    state.qualityPilotReference += pilotReferenceAlpha *
                        (state.qualityPilotStrength - state.qualityPilotReference);
                    const sumReference = state.qualitySumReference > 1e-12 ?
                        state.qualitySumReference : 1e-12;
                    const pilotReference = state.qualityPilotReference > 1e-12 ?
                        state.qualityPilotReference : 1e-12;
                    const sumRatio = state.qualitySumStrength / sumReference;
                    const pilotRatio = state.qualityPilotStrength / pilotReference;
                    let sumBoundedRatio =
                        sumRatio / QUALITY_PROGRAM_ALLOWANCE_RATIO;
                    if (sumBoundedRatio > 1) sumBoundedRatio = 1;
                    let pilotBoundedRatio =
                        pilotRatio / QUALITY_PROGRAM_ALLOWANCE_RATIO;
                    if (pilotBoundedRatio > 1) pilotBoundedRatio = 1;
                    let sumEffectiveRatio =
                        sumBoundedRatio - QUALITY_EXCESS_RATIO_OFFSET;
                    if (sumEffectiveRatio < 0) sumEffectiveRatio = 0;
                    let pilotEffectiveRatio =
                        pilotBoundedRatio - QUALITY_EXCESS_RATIO_OFFSET;
                    if (pilotEffectiveRatio < 0) pilotEffectiveRatio = 0;
                    let sumQualityTerm;
                    if (sumEffectiveRatio >= QUALITY_FULL_RATIO) {
                        sumQualityTerm = 1;
                    } else if (sumEffectiveRatio <= QUALITY_MONO_RATIO) {
                        sumQualityTerm = 0;
                    } else {
                        sumQualityTerm = (sumEffectiveRatio - QUALITY_MONO_RATIO) /
                            (QUALITY_FULL_RATIO - QUALITY_MONO_RATIO);
                    }
                    let pilotQualityTerm;
                    if (pilotEffectiveRatio >= QUALITY_FULL_RATIO) {
                        pilotQualityTerm = 1;
                    } else if (pilotEffectiveRatio <= QUALITY_MONO_RATIO) {
                        pilotQualityTerm = 0;
                    } else {
                        pilotQualityTerm =
                            (pilotEffectiveRatio - QUALITY_MONO_RATIO) /
                            (QUALITY_FULL_RATIO - QUALITY_MONO_RATIO);
                    }
                    state.qualityTerm = 1 - Math.sqrt(
                        (1 - sumQualityTerm) * (1 - pilotQualityTerm));
                }
            }
        } else {
            state.qualityDetectedSum = 0;
            state.qualityPilotPowerSum = 0;
            state.qualityDetectedCount = 0;
            state.qualityObservationValid = false;
            state.qualityTerm = 1;
        }
        let carrierTerm = (state.carrierPreAgcDb + 50) / 20;
        if (carrierTerm < 0) carrierTerm = 0;
        else if (carrierTerm > 1) carrierTerm = 1;
        const blendTarget = state.cquamPllState === 'TRACK' && state.cquamPilotDetected ?
            carrierTerm * state.qualityTerm : 0;
        state.cquamBlend += state.cquamBlendAlpha * (blendTarget - state.cquamBlend);
        const leftMatrix = detected + state.cquamBlend * decodedDifference;
        const rightMatrix = detected - state.cquamBlend * decodedDifference;
        const leftNotched = processBiquad(state.cquamLeftPilotNotch, leftMatrix);
        const rightNotched = processBiquad(state.cquamRightPilotNotch, rightMatrix);
        const left = leftNotched - state.cquamDcLeftInput +
            state.dcCoefficient * state.cquamDcLeftOutput;
        state.cquamDcLeftInput = leftNotched;
        state.cquamDcLeftOutput = left;
        const right = rightNotched - state.cquamDcRightInput +
            state.dcCoefficient * state.cquamDcRightOutput;
        state.cquamDcRightInput = rightNotched;
        state.cquamDcRightOutput = right;
        state.cquamDecodedLeft = left * 1.4142135623730951;
        state.cquamDecodedRight = right * 1.4142135623730951;
    }

    function processCquamSpeakers(state, left, right) {
        const currentLeft = processSpeakerPath(state.cquamSpeaker,
            state.cquamSpeakerHighPassLeft, state.cquamSpeakerPeakLeft,
            state.cquamSpeakerLowPassLeft, left);
        const currentRight = processSpeakerPath(state.cquamSpeaker,
            state.cquamSpeakerHighPassRight, state.cquamSpeakerPeakRight,
            state.cquamSpeakerLowPassRight, right);
        if (state.cquamSpeakerTransitionRemaining > 0) {
            const nextLeft = processSpeakerPath(state.cquamSpeakerTarget,
                state.nextCquamSpeakerHighPassLeft, state.nextCquamSpeakerPeakLeft,
                state.nextCquamSpeakerLowPassLeft, left);
            const nextRight = processSpeakerPath(state.cquamSpeakerTarget,
                state.nextCquamSpeakerHighPassRight, state.nextCquamSpeakerPeakRight,
                state.nextCquamSpeakerLowPassRight, right);
            const progress = (state.cquamSpeakerTransitionTotal -
                state.cquamSpeakerTransitionRemaining) / state.cquamSpeakerTransitionTotal;
            const blend = 0.5 - 0.5 * Math.cos(PI * progress);
            state.cquamSpeakerOutputLeft = currentLeft + blend * (nextLeft - currentLeft);
            state.cquamSpeakerOutputRight = currentRight + blend * (nextRight - currentRight);
            state.cquamSpeakerTransitionRemaining--;
            if (state.cquamSpeakerTransitionRemaining === 0) {
                let previous = state.cquamSpeakerHighPassLeft;
                state.cquamSpeakerHighPassLeft = state.nextCquamSpeakerHighPassLeft;
                state.nextCquamSpeakerHighPassLeft = previous;
                previous = state.cquamSpeakerPeakLeft;
                state.cquamSpeakerPeakLeft = state.nextCquamSpeakerPeakLeft;
                state.nextCquamSpeakerPeakLeft = previous;
                previous = state.cquamSpeakerLowPassLeft;
                state.cquamSpeakerLowPassLeft = state.nextCquamSpeakerLowPassLeft;
                state.nextCquamSpeakerLowPassLeft = previous;
                previous = state.cquamSpeakerHighPassRight;
                state.cquamSpeakerHighPassRight = state.nextCquamSpeakerHighPassRight;
                state.nextCquamSpeakerHighPassRight = previous;
                previous = state.cquamSpeakerPeakRight;
                state.cquamSpeakerPeakRight = state.nextCquamSpeakerPeakRight;
                state.nextCquamSpeakerPeakRight = previous;
                previous = state.cquamSpeakerLowPassRight;
                state.cquamSpeakerLowPassRight = state.nextCquamSpeakerLowPassRight;
                state.nextCquamSpeakerLowPassRight = previous;
                state.cquamSpeaker = state.cquamSpeakerTarget;
            }
        } else {
            state.cquamSpeakerOutputLeft = currentLeft;
            state.cquamSpeakerOutputRight = currentRight;
        }
    }

    function updateFadeTap(state, tap, pole, normalizer) {
        const inputI = gaussian(state) * SQRT_HALF;
        const inputQ = gaussian(state) * SQRT_HALF;
        const feed = 1 - pole;
        tap.i1 = pole * tap.i1 + feed * inputI;
        tap.i2 = pole * tap.i2 + feed * tap.i1;
        tap.q1 = pole * tap.q1 + feed * inputQ;
        tap.q2 = pole * tap.q2 + feed * tap.q1;
        const targetI = tap.i2 * normalizer;
        const targetQ = tap.q2 * normalizer;
        tap.stepI = (targetI - tap.i) / CONTROL_INTERVAL;
        tap.stepQ = (targetQ - tap.q) / CONTROL_INTERVAL;
    }

    function updateControl(state) {
        const requestedMode = parameters.sm === 'C-QUAM' && state.cquamMaskSupported ?
            'C-QUAM' : 'Mono';
        if (requestedMode !== state.stereoMode && state.previousStereoMode === null) {
            startModeTransition(state, requestedMode);
        }
        const keys = ['tb', 'pe', 'md', 'cp', 'sg', 'sk', 'fd', 'st', 'in', 'io', 'tn', 'bw', 'dt', 'hm', 'og', 'mx'];
        for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            state.controls[key] += state.controlSmoothing * (parameters[key] - state.controls[key]);
        }
        state.controls.hz += state.controlSmoothing * (Number(parameters.hz) - state.controls.hz);
        configureBank(state.txFilters, state.controls.tb * 1000, BUTTERWORTH_8_Q, state.sampleRate * 3);
        configureBank(state.txDifferenceFilters, state.controls.tb * 1000,
            BUTTERWORTH_8_Q, state.sampleRate * 3);
        configureBank(state.ifI, state.controls.bw * 500, BUTTERWORTH_6_Q, state.sampleRate);
        configureBank(state.ifQ, state.controls.bw * 500, BUTTERWORTH_6_Q, state.sampleRate);
        if (state.previousStereoMode !== null) {
            configureBank(state.transitionIfI, state.controls.bw * 500,
                BUTTERWORTH_6_Q, state.sampleRate);
            configureBank(state.transitionIfQ, state.controls.bw * 500,
                BUTTERWORTH_6_Q, state.sampleRate);
        }
        updateTuningModel(state);
        updateDetectorCoefficients(state);

        const controlRate = state.sampleRate / CONTROL_INTERVAL;
        const pole = Math.exp(-TWO_PI * state.controls.fd / controlRate);
        const oneMinus = 1 - pole;
        const varianceGain = oneMinus * oneMinus * oneMinus * oneMinus *
            (1 + pole * pole) / Math.pow(1 - pole * pole, 3);
        const normalizer = varianceGain > 1e-20 ? 1 / Math.sqrt(varianceGain) : 0;
        updateFadeTap(state, state.fade1, pole, normalizer);
        updateFadeTap(state, state.fade2, pole, normalizer);

        const detected = state.agcDetectorStage2 > 1e-12 ? state.agcDetectorStage2 : 1e-12;
        const detectedDb = 20 * Math.log10(detected);
        let targetGain = AGC_TARGET_DB - detectedDb;
        if (targetGain < AGC_MINIMUM_GAIN_DB) targetGain = AGC_MINIMUM_GAIN_DB;
        if (targetGain > AGC_MAXIMUM_GAIN_DB) targetGain = AGC_MAXIMUM_GAIN_DB;
        const speed = agcSpeedIndex(parameters.ag);
        const time = targetGain < state.agcGainDb ? AGC_ATTACK_TIMES[speed] : AGC_RELEASE_TIMES[speed];
        const coefficient = 1 - Math.exp(-CONTROL_INTERVAL / (state.sampleRate * time));
        state.agcGainDb += coefficient * (targetGain - state.agcGainDb);
        let preAgc = detectedDb;
        if (preAgc < -80) preAgc = -80;
        if (preAgc > 6) preAgc = 6;
        state.carrierPreAgcDb = preAgc;
        updateControlCoefficients(state, speed);
        if (state.previousStereoMode !== null) {
            const transitionDetected = state.transitionAgcDetectorStage2 > 1e-12 ?
                state.transitionAgcDetectorStage2 : 1e-12;
            const transitionDetectedDb = 20 * Math.log10(transitionDetected);
            let transitionTargetGain = AGC_TARGET_DB - transitionDetectedDb;
            if (transitionTargetGain < AGC_MINIMUM_GAIN_DB) {
                transitionTargetGain = AGC_MINIMUM_GAIN_DB;
            }
            if (transitionTargetGain > AGC_MAXIMUM_GAIN_DB) {
                transitionTargetGain = AGC_MAXIMUM_GAIN_DB;
            }
            const transitionTime = transitionTargetGain < state.transitionAgcGainDb ?
                AGC_ATTACK_TIMES[speed] : AGC_RELEASE_TIMES[speed];
            const transitionCoefficient = 1 - Math.exp(-CONTROL_INTERVAL /
                (state.sampleRate * transitionTime));
            state.transitionAgcGainDb += transitionCoefficient *
                (transitionTargetGain - state.transitionAgcGainDb);
            let transitionPreAgc = transitionDetectedDb;
            if (transitionPreAgc < -80) transitionPreAgc = -80;
            if (transitionPreAgc > 6) transitionPreAgc = 6;
            state.transitionCarrierPreAgcDb = transitionPreAgc;
            state.transitionAgcLinearGain = Math.pow(10, state.transitionAgcGainDb / 20);
            state.transitionInverseAgcLinearGain = 1 / state.transitionAgcLinearGain;
        }
        state.controlRemaining = CONTROL_INTERVAL;
    }

    function detectorStep(state, i, q) {
        const magnitude = Math.sqrt(i * i + q * q);
        state.detectorClipping = magnitude < state.detectorCapacitor &&
            state.detectorCapacitor > magnitude * 1.05;
        const coefficient = magnitude > state.detectorCapacitor ?
            state.detectorCharge : state.detectorRelease;
        state.detectorCapacitor = magnitude + coefficient * (state.detectorCapacitor - magnitude);
        return state.detectorCapacitor;
    }

    const sampleRate = parameters.sampleRate;
    const blockSize = parameters.blockSize;
    const pairChannels = parameters.channelCount >= 2 ? 2 : 1;
    const selectedSpeaker = speakerIndex(parameters.sp);
    if (!Number.isInteger(context.__amRadioBaseSeed)) {
        const seeded = typeof context.__seededRandom === 'function' ? context.__seededRandom() : 0.937232635;
        context.__amRadioBaseSeed = Math.floor(seeded * FLOAT53_SCALE) >>> 0;
    }
    let state = context.__amRadioSimulator;
    if (!state || state.sampleRate !== sampleRate || state.pairChannels !== pairChannels) {
        state = makeState(sampleRate, pairChannels, selectedSpeaker, context.__amRadioBaseSeed);
        context.__amRadioSimulator = state;
    } else if (state.stereoMode === 'C-QUAM') {
        if (state.cquamSpeakerTransitionRemaining === 0 &&
            state.cquamSpeaker !== selectedSpeaker) {
            startCquamSpeakerTransition(state, selectedSpeaker);
        }
    } else if (state.speakerTransitionRemaining === 0 && state.speaker !== selectedSpeaker) {
        startSpeakerTransition(state, selectedSpeaker);
    }

    let blockModPeak = 0;
    for (let frame = 0; frame < blockSize; frame++) {
        if (state.controlRemaining === 0) updateControl(state);
        state.controlRemaining--;
        state.fade1.i += state.fade1.stepI;
        state.fade1.q += state.fade1.stepQ;
        state.fade2.i += state.fade2.stepI;
        state.fade2.q += state.fade2.stepQ;

        const leftIndex = frame;
        const rightIndex = pairChannels === 2 ? blockSize + frame : frame;
        const inputLeft = data[leftIndex];
        const inputRight = data[rightIndex];
        const mono = pairChannels === 2 ? (inputLeft + inputRight) * 0.5 : inputLeft;
        const difference = pairChannels === 2 ? (inputLeft - inputRight) * 0.5 : 0;
        const needMonoPath = state.stereoMode === 'Mono' ||
            state.previousStereoMode === 'Mono';
        const needCquamPath = state.stereoMode === 'C-QUAM' ||
            state.previousStereoMode === 'C-QUAM';

        const highPassed = processBiquad(state.txHighPass, mono);
        state.preEmphasisLow = state.preEmphasisPole * state.preEmphasisLow +
            (1 - state.preEmphasisPole) * highPassed;
        const emphasized = highPassed + state.preEmphasisShelfGain *
            (highPassed - state.preEmphasisLow);
        let emphasizedDifference = 0;
        if (needCquamPath) {
            const differenceHighPassed = processBiquad(state.txDifferenceHighPass, difference);
            state.differencePreEmphasisLow = state.preEmphasisPole *
                state.differencePreEmphasisLow + (1 - state.preEmphasisPole) *
                differenceHighPassed;
            emphasizedDifference = differenceHighPassed + state.preEmphasisShelfGain *
                (differenceHighPassed - state.differencePreEmphasisLow);
        }
        const absoluteInput = emphasized < 0 ? -emphasized : emphasized;
        const envelopeCoefficient = absoluteInput > state.limiterEnvelope ?
            state.limiterAttackCoefficient : state.limiterReleaseCoefficient;
        state.limiterEnvelope = absoluteInput + envelopeCoefficient * (state.limiterEnvelope - absoluteInput);
        let targetGain = 1;
        if (state.limiterEnvelope > state.limiterThreshold && state.limiterEnvelope > 1e-12) {
            const ratio = state.limiterThreshold / state.limiterEnvelope;
            targetGain = 1 + state.limiterDepth * (ratio - 1);
        }
        const gainCoefficient = targetGain < state.limiterGain ?
            state.limiterAttackCoefficient : state.limiterReleaseCoefficient;
        state.limiterGain = targetGain + gainCoefficient * (state.limiterGain - targetGain);
        const compressed = emphasized * state.limiterGain;
        const compressedDifference = emphasizedDifference * state.limiterGain;

        let tx = 0;
        let txDifference = 0;
        let transmittedMono = 0;
        let transmittedCquamI = 0;
        let transmittedCquamQ = 0;
        let transmittedMonoI = 0;
        for (let phase = 0; phase < 3; phase++) {
            const interpolated = processBank(state.txInterp,
                phase === 0 ? compressed * 3 : 0);
            let differenceInterpolated = 0;
            if (needCquamPath) {
                differenceInterpolated = processBank(state.txDifferenceInterp,
                    phase === 0 ? compressedDifference * 3 : 0);
            }
            tx = processBank(state.txFilters, asymmetricLimit(interpolated));
            if (needCquamPath) {
                txDifference = processBank(state.txDifferenceFilters, differenceInterpolated);
                const pilot = CQUAM_PILOT_AMPLITUDE * Math.sin(TWO_PI *
                    CQUAM_PILOT_FREQUENCY * state.cquamOversampledCounter /
                    (state.sampleRate * 3));
                const inPhase = 1 + state.modulation * tx;
                const quadratureAudio = state.modulation * txDifference;
                let normalizedI;
                let normalizedQ;
                if (inPhase <= 0) {
                    normalizedI = inPhase;
                    normalizedQ = 0;
                } else {
                    const limit = state.cquamTanInternalPhaseLimit * inPhase;
                    let limitedPilot = pilot;
                    if (limitedPilot < -limit) limitedPilot = -limit;
                    else if (limitedPilot > limit) limitedPilot = limit;
                    let limitedAudio = quadratureAudio;
                    const audioMinimum = -limit - limitedPilot;
                    const audioMaximum = limit - limitedPilot;
                    if (limitedAudio < audioMinimum) limitedAudio = audioMinimum;
                    else if (limitedAudio > audioMaximum) limitedAudio = audioMaximum;
                    const quadrature = limitedAudio + limitedPilot;
                    let magnitude = Math.sqrt(inPhase * inPhase + quadrature * quadrature);
                    if (magnitude < CQUAM_EPSILON_ABSOLUTE) magnitude = CQUAM_EPSILON_ABSOLUTE;
                    normalizedI = inPhase * inPhase / magnitude;
                    normalizedQ = inPhase * quadrature / magnitude;
                }
                const masked = processCquamMask(state, normalizedI, normalizedQ, phase === 2);
                if (phase === 2) {
                    transmittedCquamI = masked.i;
                    transmittedCquamQ = masked.q;
                    transmittedMonoI = inPhase;
                }
                state.cquamOversampledCounter++;
            }
            if (phase === 2) {
                transmittedMono = 1 + state.modulation * tx;
                if (!needCquamPath) transmittedMonoI = transmittedMono;
            }
        }
        const modulationDeviation = (tx < 0 ? -tx : tx) * state.modulation * 100;
        if (modulationDeviation > blockModPeak) blockModPeak = modulationDeviation;

        const propagate = (mode, delay, delayQ, position) => {
            const transmittedI = mode === 'C-QUAM' ? transmittedCquamI : transmittedMono;
            const transmittedQ = mode === 'C-QUAM' ? transmittedCquamQ : 0;
            delay[position] = transmittedI;
            if (mode === 'C-QUAM') delayQ[position] = transmittedQ;
            let position1 = position - state.delay1Samples;
            if (position1 < 0) position1 += delay.length;
            let position2 = position - state.delay2Samples;
            if (position2 < 0) position2 += delay.length;
            const delayed1 = delay[position1];
            const delayed2 = delay[position2];
            const delayed1Q = mode === 'C-QUAM' ? delayQ[position1] : 0;
            const delayed2Q = mode === 'C-QUAM' ? delayQ[position2] : 0;
            position++;
            if (position === delay.length) position = 0;
            let i;
            let q;
            if (mode === 'C-QUAM') {
                const sky1I = state.fade1.i * delayed1 - state.fade1.q * delayed1Q;
                const sky1Q = state.fade1.i * delayed1Q + state.fade1.q * delayed1;
                const sky2I = state.fade2.i * delayed2 - state.fade2.q * delayed2Q;
                const sky2Q = state.fade2.i * delayed2Q + state.fade2.q * delayed2;
                i = state.signalGain * (state.groundGain * transmittedI +
                    state.skyGain * (sky1I + sky2I));
                q = state.signalGain * (state.groundGain * transmittedQ +
                    state.skyGain * (sky1Q + sky2Q));
            } else {
                i = state.signalGain * (state.groundGain * transmittedI + state.skyGain *
                    (state.fade1.i * delayed1 + state.fade2.i * delayed2));
                q = state.signalGain * state.skyGain *
                    (state.fade1.q * delayed1 + state.fade2.q * delayed2);
            }
            return { i, q, position };
        };

        const mainPathMode = state.previousStereoMode ?? state.stereoMode;
        const station = propagate(mainPathMode, state.delay, state.delayQ, state.delayPosition);
        state.delayPosition = station.position;
        let transitionStation = null;
        if (state.previousStereoMode !== null) {
            transitionStation = propagate(state.stereoMode, state.transitionDelay,
                state.transitionDelayQ, state.transitionDelayPosition);
            state.transitionDelayPosition = transitionStation.position;
        }
        const tuningCosine = Math.cos(state.tuningPhase);
        const tuningSine = Math.sin(state.tuningPhase);
        advancePhase(state, 'tuningPhase', state.stationTuningPhaseIncrement);

        state.interfererProgram = processBank(state.interfererFilters, gaussian(state)) *
            state.interfererNormalizer;
        const interfererEnvelope = state.interfererTuningGain * state.interfererGain *
            (1 + 0.35 * state.interfererProgram);
        const interfererI = interfererEnvelope * Math.cos(state.interfererPhase);
        const interfererQ = interfererEnvelope * Math.sin(state.interfererPhase);
        advancePhase(state, 'interfererPhase', state.interfererTuningPhaseIncrement);

        const thermalI = gaussian(state) * state.thermalNoiseStd;
        const thermalQ = gaussian(state) * state.thermalNoiseStd;
        const legacyStaticEvent = nextRandom(state) < state.staticProbability;
        if (legacyStaticEvent) {
            nextRandom(state);
            nextRandom(state);
        }
        let staticEvent = false;
        let staticI = 0;
        let staticQ = 0;
        const staticRate = parameters.st;
        const staticSampleEndSeconds =
            (state.sampleCounter + 1) / state.sampleRate;
        if (staticRate > 0) {
            if (!state.staticScheduleActive) {
                state.staticScheduleActive = true;
                state.staticNextEventDeadlineSeconds =
                    state.sampleCounter / state.sampleRate +
                    staticIntervalSeconds(state, staticRate);
            } else if (state.staticScheduledRate !== staticRate) {
                // Exponential inter-arrival times are memoryless, so rescaling
                // the remaining time by the rate ratio keeps the pending draw
                // valid while making a rate increase audible immediately. No
                // extra RNG draw is consumed (parity depends on the stream).
                const nowSeconds = state.sampleCounter / state.sampleRate;
                const remainingSeconds =
                    state.staticNextEventDeadlineSeconds - nowSeconds;
                if (remainingSeconds > 0) {
                    state.staticNextEventDeadlineSeconds = nowSeconds +
                        remainingSeconds *
                        (state.staticScheduledRate / staticRate);
                }
            }
            state.staticScheduledRate = staticRate;
            while (state.staticNextEventDeadlineSeconds <=
                staticSampleEndSeconds) {
                staticEvent = true;
                const nextIntervalSeconds =
                    staticIntervalSeconds(state, staticRate);
                const staticPhase = TWO_PI * nextStaticRandom(state);
                const staticAreaSeconds = STATIC_CARRIER_AREA_SECONDS *
                    state.signalGain * (0.5 + nextStaticRandom(state));
                const eventArea = staticAreaSeconds * sampleRate;
                staticI += eventArea * Math.cos(staticPhase);
                staticQ += eventArea * Math.sin(staticPhase);
                state.staticCount = (state.staticCount + 1) >>> 0;
                state.staticNextEventDeadlineSeconds += nextIntervalSeconds;
            }
        } else {
            state.staticScheduleActive = false;
            state.staticNextEventDeadlineSeconds = -1;
            state.staticScheduledRate = 0;
        }

        const hum = Math.sin(state.humPhase);
        state.humPhase += state.humPhaseIncrement;
        if (state.humPhase >= TWO_PI) state.humPhase -= TWO_PI;
        const receive = (pathStation, ifI, ifQ, agcLinearGain, inverseAgcLinearGain,
            agcStage1, agcStage2) => {
            let i = state.stationTuningGain *
                (pathStation.i * tuningCosine - pathStation.q * tuningSine);
            let q = state.stationTuningGain *
                (pathStation.i * tuningSine + pathStation.q * tuningCosine);
            i += interfererI;
            q += interfererQ;
            i += thermalI;
            q += thermalQ;
            if (staticEvent) {
                i += staticI;
                q += staticQ;
            }
            const radioGain = agcLinearGain * (1 + state.humAmount * hum);
            const outputI = processBank(ifI, i * radioGain);
            const outputQ = processBank(ifQ, q * radioGain);
            const preAgcMagnitude = Math.sqrt(outputI * outputI + outputQ * outputQ) *
                inverseAgcLinearGain;
            agcStage1 += state.agcDetectorAttackCoefficient *
                (preAgcMagnitude - agcStage1);
            const detectorStage2Coefficient = agcStage1 > agcStage2 ?
                state.agcDetectorAttackCoefficient : state.agcDetectorReleaseCoefficient;
            agcStage2 += detectorStage2Coefficient * (agcStage1 - agcStage2);
            return {
                i: outputI,
                q: outputQ,
                agcStage1,
                agcStage2,
                envelope: Math.sqrt(outputI * outputI + outputQ * outputQ)
            };
        };

        const mainIf = receive(station, state.ifI, state.ifQ, state.agcLinearGain,
            state.inverseAgcLinearGain, state.agcDetectorStage1, state.agcDetectorStage2);
        state.agcDetectorStage1 = mainIf.agcStage1;
        state.agcDetectorStage2 = mainIf.agcStage2;
        state.lastIfEnvelope = mainIf.envelope;
        let monoIf = mainPathMode === 'Mono' ? mainIf : null;
        let cquamIf = mainPathMode === 'C-QUAM' ? mainIf : null;
        if (transitionStation) {
            const transitionIf = receive(transitionStation, state.transitionIfI,
                state.transitionIfQ, state.transitionAgcLinearGain,
                state.transitionInverseAgcLinearGain, state.transitionAgcDetectorStage1,
                state.transitionAgcDetectorStage2);
            state.transitionAgcDetectorStage1 = transitionIf.agcStage1;
            state.transitionAgcDetectorStage2 = transitionIf.agcStage2;
            state.transitionLastIfEnvelope = transitionIf.envelope;
            if (state.stereoMode === 'C-QUAM') cquamIf = transitionIf;
            else monoIf = transitionIf;
        }
        let monoWet = 0;
        if (needMonoPath) {
            let detected = 0;
            for (let phase = 0; phase < 5; phase++) {
                const interpolatedI = processBank(state.detectorInterpI,
                    phase === 0 ? monoIf.i * 5 : 0);
                const interpolatedQ = processBank(state.detectorInterpQ,
                    phase === 0 ? monoIf.q * 5 : 0);
                const envelope = detectorStep(state, interpolatedI, interpolatedQ);
                detected = processBank(state.detectorDecimation, envelope);
            }

            const audio = detected - state.dcPreviousInput +
                state.dcCoefficient * state.dcPreviousOutput;
            state.dcPreviousInput = detected;
            state.dcPreviousOutput = audio;
            monoWet = (audio + state.humAmount * 0.2 * hum) * 1.4142135623730951;
            const currentSpeakerWet = processSpeakerPath(state.speaker,
                state.speakerHighPass, state.speakerPeak, state.speakerLowPass, monoWet);
            if (state.speakerTransitionRemaining > 0) {
                const nextSpeakerWet = processSpeakerPath(state.speakerTarget,
                    state.nextSpeakerHighPass, state.nextSpeakerPeak,
                    state.nextSpeakerLowPass, monoWet);
                const progress = (state.speakerTransitionTotal -
                    state.speakerTransitionRemaining) / state.speakerTransitionTotal;
                const blend = 0.5 - 0.5 * Math.cos(PI * progress);
                monoWet = currentSpeakerWet + blend * (nextSpeakerWet - currentSpeakerWet);
                state.speakerTransitionRemaining--;
                if (state.speakerTransitionRemaining === 0) {
                    const previousHighPass = state.speakerHighPass;
                    const previousPeak = state.speakerPeak;
                    const previousLowPass = state.speakerLowPass;
                    state.speakerHighPass = state.nextSpeakerHighPass;
                    state.speakerPeak = state.nextSpeakerPeak;
                    state.speakerLowPass = state.nextSpeakerLowPass;
                    state.nextSpeakerHighPass = previousHighPass;
                    state.nextSpeakerPeak = previousPeak;
                    state.nextSpeakerLowPass = previousLowPass;
                    state.speaker = state.speakerTarget;
                }
            } else {
                monoWet = currentSpeakerWet;
            }
            monoWet *= state.outputGain;
        }

        let cquamWetLeft = 0;
        let cquamWetRight = 0;
        if (needCquamPath) {
            const cquamInverseAgc = mainPathMode === 'C-QUAM' ?
                state.inverseAgcLinearGain :
                state.transitionInverseAgcLinearGain;
            processCquamDecoder(state, cquamIf.i, cquamIf.q, cquamInverseAgc);
            const cquamHum = state.humAmount * 0.2 * hum;
            processCquamSpeakers(state, state.cquamDecodedLeft + cquamHum,
                state.cquamDecodedRight + cquamHum);
            cquamWetLeft = state.cquamSpeakerOutputLeft * state.outputGain;
            cquamWetRight = state.cquamSpeakerOutputRight * state.outputGain;
        }

        let wetLeft;
        let wetRight;
        if (state.previousStereoMode !== null) {
            const transitionProgress = state.modeTransitionTotal <= 1 ? 1 :
                state.modeTransitionPosition / (state.modeTransitionTotal - 1);
            const nextWeight = 0.5 - 0.5 * Math.cos(PI * transitionProgress);
            const previousWeight = 1 - nextWeight;
            if (state.stereoMode === 'C-QUAM') {
                wetLeft = previousWeight * monoWet + nextWeight * cquamWetLeft;
                wetRight = previousWeight * monoWet + nextWeight * cquamWetRight;
                state.stereoBlend = nextWeight * state.cquamBlend;
            } else {
                wetLeft = previousWeight * cquamWetLeft + nextWeight * monoWet;
                wetRight = previousWeight * cquamWetRight + nextWeight * monoWet;
                state.stereoBlend = previousWeight * state.cquamBlend;
            }
            state.modeTransitionPosition++;
            if (state.modeTransitionPosition === state.modeTransitionTotal) {
                finishModeTransition(state);
            }
        } else if (state.stereoMode === 'C-QUAM') {
            wetLeft = cquamWetLeft;
            wetRight = cquamWetRight;
            state.stereoBlend = state.cquamBlend;
        } else {
            wetLeft = monoWet;
            wetRight = monoWet;
            state.stereoBlend = 0;
        }

        data[leftIndex] = state.dryMix * inputLeft + state.mix * wetLeft;
        if (pairChannels === 2) {
            data[rightIndex] = state.dryMix * inputRight + state.mix * wetRight;
        }

        const pathI = state.groundGain + state.skyGain * (state.fade1.i + state.fade2.i);
        const pathQ = state.skyGain * (state.fade1.q + state.fade2.q);
        const pathMagnitude = Math.sqrt(pathI * pathI + pathQ * pathQ);
        let fadeDb = 20 * Math.log10(pathMagnitude > 1e-4 ? pathMagnitude : 1e-4);
        if (fadeDb < -80) fadeDb = -80;
        if (fadeDb > 6) fadeDb = 6;
        state.fadeDb = fadeDb;
        const clipNow = transmittedMonoI < 0 ||
            (state.stereoMode === 'Mono' && state.detectorClipping);
        if (clipNow && !state.clipActive) state.clipCount = (state.clipCount + 1) >>> 0;
        state.clipActive = clipNow;
        state.sampleCounter++;
    }
    state.modPercent += 0.2 * (blockModPeak - state.modPercent);
    if (state.modPercent < 0) state.modPercent = 0;
    if (state.modPercent > 160) state.modPercent = 160;
    data.measurements = {
        carrierPreAgcDb: state.carrierPreAgcDb,
        agcGainDb: state.agcGainDb,
        modPercent: state.modPercent,
        fadeDb: state.fadeDb,
        staticCount: state.staticCount,
        clipCount: state.clipCount,
        stereoBlend: state.stereoBlend
    };
    return data;
`;

let amRadioSimulatorInstanceSerial = 0;

class AMRadioSimulatorPlugin extends PluginBase {
    constructor() {
        super('AM Radio Simulator', 'Physical AM transmission, propagation, receiver, and speaker simulation');
        this.tb = 6;
        this.pe = 50;
        this.md = 90;
        this.cp = 6;
        this.sm = 'Mono';
        this.sg = -12;
        this.sk = 1;
        this.fd = 0.15;
        this.st = 0.3;
        this.in = -65;
        this.io = 9;
        this.tn = 0;
        this.bw = 12;
        this.ag = 'Fast';
        this.dt = 50;
        this.hm = -70;
        this.hz = '50';
        this.sp = 'Table';
        this.og = 0;
        this.mx = 100;
        this.fr = false;
        this.temporalCapability = 'must-process';
        this.executionState = { state: 'pending', reason: null };
        this.selectedTab = 'station';
        this.hudValues = {
            carrierPreAgcDb: -80,
            agcGainDb: 6.4,
            modPercent: 0,
            fadeDb: 0,
            staticRate: 0,
            clipRate: 0,
            stereoBlend: 0
        };
        this.lastCounters = null;
        this.lastCounterAt = 0;
        this.lastTelemetryAt = 0;
        this.eventFlashUntil = 0;
        this.animationFrameId = null;
        this.hudCanvas = null;
        this.stereoLamp = null;
        this.hudVisible = true;
        this.hudGraphDispose = null;
        this.hudObserver = null;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspTelemetry = frame => this.handleDspTelemetry(frame);
        this.registerProcessor(AM_RADIO_SIMULATOR_REFERENCE_PROCESSOR);
    }

    getTemporalCapability() {
        return this.enabled !== false && this.mx > 0 ? 'must-process' : 'reset-on-resume';
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            tb: this.tb, pe: this.pe, md: this.md, cp: this.cp, sm: this.sm,
            sg: this.sg, sk: this.sk, fd: this.fd, st: this.st, in: this.in, io: this.io,
            tn: this.tn, bw: this.bw, ag: this.ag, dt: this.dt, hm: this.hm, hz: this.hz,
            sp: this.sp, og: this.og, mx: this.mx,
            fr: this.fr,
            enabled: this.enabled
        };
    }

    getSerializableParameters() {
        const params = super.getSerializableParameters();
        delete params.fr;
        return params;
    }

    getWorkletPluginData(parameters = this.getParameters()) {
        const runtimeParameters = { ...parameters };
        delete runtimeParameters.fr;
        return super.getWorkletPluginData(runtimeParameters);
    }

    setParameters(params) {
        const setNumber = (key, minimum, maximum) => {
            if (params[key] !== undefined && params[key] !== null) {
                this[key] = this.parseFiniteNumber(params[key], minimum, maximum, this[key]);
            }
        };
        setNumber('tb', 2, 10);
        setNumber('pe', 0, 100);
        setNumber('md', 10, 125);
        setNumber('cp', 0, 20);
        setNumber('sg', -50, 0);
        setNumber('sk', 0, 100);
        setNumber('fd', 0.05, 2);
        setNumber('st', 0, 100);
        setNumber('in', -80, 0);
        setNumber('io', 5, 10);
        setNumber('tn', -30, 30);
        setNumber('bw', 2, 20);
        setNumber('dt', 20, 500);
        setNumber('hm', -80, -20);
        setNumber('og', -24, 24);
        setNumber('mx', 0, 100);
        if (params.sm !== undefined) {
            this.sm = ['Mono', 'C-QUAM'].includes(params.sm) ? params.sm : this.sm;
        }
        if (params.ag !== undefined) this.ag = ['Slow', 'Mid', 'Fast'].includes(params.ag) ? params.ag : this.ag;
        if (params.hz !== undefined) this.hz = String(params.hz) === '60' ? '60' : '50';
        if (params.sp !== undefined) this.sp = ['Off', 'Small', 'Table'].includes(params.sp) ? params.sp : this.sp;
        if (params.fr !== undefined) this.fr = params.fr === true || params.fr === 1 || params.fr === 'true';
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        this.updateParameters();
    }

    _setupMessageHandler() {
        super._setupMessageHandler();
        this.ensureDspTelemetrySubscription();
    }

    ensureDspTelemetrySubscription() {
        const hub = window.dspTelemetryHub;
        const tapId = this.id;
        const validTapId = Number.isInteger(tapId) && tapId >= 0 && tapId <= 0xffffffff;
        if (!validTapId || !hub || typeof hub.subscribe !== 'function') return false;
        if (this._dspTelemetryUnsubscribe && hub === this._dspTelemetryHub && tapId === this._dspTelemetryTapId) {
            return true;
        }
        this.disposeDspTelemetrySubscription();
        try {
            const unsubscribe = hub.subscribe(tapId, AM_RADIO_SIMULATOR_TAP_STATUS, this._boundDspTelemetry);
            if (typeof unsubscribe !== 'function') return false;
            this._dspTelemetryHub = hub;
            this._dspTelemetryTapId = tapId;
            this._dspTelemetryUnsubscribe = unsubscribe;
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

    parseDspTelemetryFrame(frame) {
        if (frame?.frameType !== AM_RADIO_SIMULATOR_TAP_STATUS) return null;
        const version = frame.formatVersion;
        if (version !== AM_RADIO_SIMULATOR_TELEMETRY_VERSION &&
            version !== AM_RADIO_SIMULATOR_TELEMETRY_V1_VERSION) return null;
        const payload = frame.payload;
        const expectedBytes = version === AM_RADIO_SIMULATOR_TELEMETRY_VERSION ?
            AM_RADIO_SIMULATOR_TELEMETRY_BYTES : AM_RADIO_SIMULATOR_TELEMETRY_V1_BYTES;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            typeof payload.getUint32 !== 'function' || payload.byteLength !== expectedBytes) {
            return null;
        }
        const v2 = version === AM_RADIO_SIMULATOR_TELEMETRY_VERSION;
        const measurements = {
            carrierPreAgcDb: payload.getFloat32(0, true),
            agcGainDb: payload.getFloat32(4, true),
            modPercent: payload.getFloat32(8, true),
            fadeDb: payload.getFloat32(12, true),
            staticCount: payload.getUint32(v2 ? 20 : 16, true),
            clipCount: payload.getUint32(v2 ? 24 : 20, true)
        };
        const scalars = ['carrierPreAgcDb', 'agcGainDb', 'modPercent', 'fadeDb'];
        if (v2) {
            measurements.stereoBlend = payload.getFloat32(16, true);
            scalars.push('stereoBlend');
        }
        return scalars.every(key => Number.isFinite(measurements[key])) ? measurements : null;
    }

    handleDspTelemetry(frame) {
        const measurements = this.parseDspTelemetryFrame(frame);
        if (measurements) this._applyMeasurements(measurements);
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        if (message.type === 'dspExecutionState' && message.pluginId === this.id &&
            message.validated === true) {
            this.executionState = { state: message.state, reason: message.reason || null };
            return;
        }
        if (message.type !== 'processBuffer' || message.pluginId !== this.id || !message.measurements) return;
        if (message.measurements.bypass === true) return;
        if (Number.isFinite(message.measurements.carrierPreAgcDb)) this._applyMeasurements(message.measurements);
    }

    _applyMeasurements(measurements) {
        const now = performance.now();
        const scalarKeys = ['carrierPreAgcDb', 'agcGainDb', 'modPercent', 'fadeDb',
            'stereoBlend'];
        for (const key of scalarKeys) {
            if (Number.isFinite(measurements[key])) this.hudValues[key] = measurements[key];
        }
        const counters = {
            staticCount: measurements.staticCount >>> 0,
            clipCount: measurements.clipCount >>> 0
        };
        if (this.lastCounters && this.lastCounterAt) {
            const elapsed = (now - this.lastCounterAt) / 1000;
            if (elapsed > 0 && elapsed < 10) {
                let staticDifference = (counters.staticCount - this.lastCounters.staticCount) >>> 0;
                let clipDifference = (counters.clipCount - this.lastCounters.clipCount) >>> 0;
                if (staticDifference > 0x80000000) staticDifference = 0;
                if (clipDifference > 0x80000000) clipDifference = 0;
                this.hudValues.staticRate = staticDifference / elapsed;
                this.hudValues.clipRate = clipDifference / elapsed;
                if (staticDifference || clipDifference) this.eventFlashUntil = now + 180;
            }
        }
        this.lastCounters = counters;
        this.lastCounterAt = now;
        this.lastTelemetryAt = now;
    }

    _createZeroAwareLogControl(label, max, value, setter, unit) {
        const row = document.createElement('div');
        row.className = 'parameter-row';
        const slug = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const sliderId = `${this.id}-${this.name}-${slug}-slider`;
        const valueId = `${this.id}-${this.name}-${slug}-value`;
        const labelElement = document.createElement('label');
        labelElement.textContent = `${label} (${unit}):`;
        labelElement.htmlFor = sliderId;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.name = sliderId;
        slider.min = '0';
        slider.max = '1000';
        slider.step = '1';
        slider.autocomplete = 'off';
        const number = document.createElement('input');
        number.type = 'number';
        number.id = valueId;
        number.name = valueId;
        number.min = '0';
        number.max = String(max);
        number.step = '0.01';
        number.autocomplete = 'off';
        const floor = 0.001;
        const sync = current => {
            slider.value = current <= 0 ? '0' : String(1 + 999 * Math.log(current / floor) / Math.log(max / floor));
            number.value = current === 0 ? '0' : Number(current.toPrecision(4)).toString();
        };
        const fromSlider = position => position <= 0 ? 0 : floor * Math.pow(max / floor, (position - 1) / 999);
        sync(value);
        slider.addEventListener('input', event => {
            const next = fromSlider(parseFloat(event.target.value));
            setter(next);
            sync(next);
        });
        number.addEventListener('change', event => {
            const next = this.parseFiniteNumber(event.target.value, 0, max, 0);
            setter(next);
            sync(next);
        });
        row.appendChild(labelElement);
        row.appendChild(slider);
        row.appendChild(number);
        return row;
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        this.stopAnimation();
        this.hudObserver?.disconnect();
        this.hudGraphDispose?.();
        const container = document.createElement('div');
        const instanceId = `am-radio-simulator-${Date.now()}-${++amRadioSimulatorInstanceSerial}`;
        container.className = 'am-radio-simulator-container';
        container.setAttribute('data-instance-id', instanceId);
        const panel = document.createElement('div');
        panel.className = 'am-radio-simulator-panel';
        const tabs = document.createElement('div');
        tabs.className = 'am-radio-simulator-tabs';
        tabs.setAttribute('role', 'tablist');
        const contents = document.createElement('div');
        contents.className = 'am-radio-simulator-tab-contents';
        const definitions = [
            { id: 'station', label: 'Station', create: content => {
                content.appendChild(this.createRadioGroup('Stereo Mode', ['Mono', 'C-QUAM'],
                    this.sm, value => this.setParameters({ sm: value })));
                content.appendChild(this.createParameterControl('TX Bandwidth', 2, 10, 0.1, this.tb, value => this.setParameters({ tb: value }), 'kHz'));
                content.appendChild(this.createParameterControl('Pre-emphasis', 0, 100, 1, this.pe, value => this.setParameters({ pe: value }), '%'));
                content.appendChild(this.createParameterControl('Mod Depth', 10, 125, 1, this.md, value => this.setParameters({ md: value }), '%'));
                content.appendChild(this.createParameterControl('Compression', 0, 20, 0.1, this.cp, value => this.setParameters({ cp: value }), 'dB'));
            } },
            { id: 'path', label: 'Path', create: content => {
                content.appendChild(this.createParameterControl('Signal', -50, 0, 0.1, this.sg, value => this.setParameters({ sg: value }), 'dB'));
                content.appendChild(this.createParameterControl('Skywave', 0, 100, 1, this.sk, value => this.setParameters({ sk: value }), '%'));
                content.appendChild(this.createLogarithmicParameterControl('Fading Speed', 0.05, 2, 0.01, this.fd, value => this.setParameters({ fd: value }), 'Hz'));
                content.appendChild(this._createZeroAwareLogControl('Static', 100, this.st, value => this.setParameters({ st: value }), '/s'));
                content.appendChild(this.createParameterControl('Interference', -80, 0, 1, this.in, value => this.setParameters({ in: value }), 'dB'));
                content.appendChild(this.createParameterControl('Interf. Offset', 5, 10, 0.1, this.io, value => this.setParameters({ io: value }), 'kHz'));
            } },
            { id: 'receiver', label: 'Receiver', create: content => {
                content.appendChild(this.createParameterControl('Tuning', -30, 30, 0.01, this.tn, value => this.setParameters({ tn: value }), 'kHz'));
                content.appendChild(this.createParameterControl('IF Bandwidth', 2, 20, 0.1, this.bw, value => this.setParameters({ bw: value }), 'kHz'));
                content.appendChild(this.createRadioGroup('AGC Speed', ['Slow', 'Mid', 'Fast'], this.ag, value => this.setParameters({ ag: value })));
                content.appendChild(this.createLogarithmicParameterControl('Detector RC', 20, 500, 1, this.dt, value => this.setParameters({ dt: value }), 'µs'));
                content.appendChild(this.createParameterControl('Hum', -80, -20, 1, this.hm, value => this.setParameters({ hm: value }), 'dB'));
                content.appendChild(this.createRadioGroup('Hum Freq', ['50', '60'], this.hz, value => this.setParameters({ hz: value }), 'Hz'));
            } },
            { id: 'output', label: 'Output', create: content => {
                content.appendChild(this.createRadioGroup('Speaker', ['Off', 'Small', 'Table'], this.sp, value => this.setParameters({ sp: value })));
                content.appendChild(this.createParameterControl('Output Gain', -24, 24, 0.1, this.og, value => this.setParameters({ og: value }), 'dB'));
                content.appendChild(this.createParameterControl('Mix', 0, 100, 1, this.mx, value => this.setParameters({ mx: value }), '%'));
            } }
        ];
        for (const definition of definitions) {
            const active = definition.id === this.selectedTab;
            const tab = document.createElement('button');
            const content = document.createElement('div');
            tab.type = 'button';
            tab.id = `${instanceId}-${definition.id}-tab`;
            tab.className = `am-radio-simulator-tab ${active ? 'active' : ''}`;
            tab.textContent = definition.label;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.setAttribute('aria-controls', `${instanceId}-${definition.id}-panel`);
            content.id = `${instanceId}-${definition.id}-panel`;
            content.className = `am-radio-simulator-tab-content plugin-parameter-ui ${active ? 'active' : ''}`;
            content.setAttribute('role', 'tabpanel');
            content.setAttribute('aria-labelledby', tab.id);
            content.hidden = !active;
            definition.create(content);
            tab.addEventListener('click', () => {
                tabs.querySelectorAll('.am-radio-simulator-tab').forEach(item => {
                    const selected = item === tab;
                    item.classList.toggle('active', selected);
                    item.setAttribute('aria-selected', selected ? 'true' : 'false');
                });
                contents.querySelectorAll('.am-radio-simulator-tab-content').forEach(item => {
                    const selected = item === content;
                    item.classList.toggle('active', selected);
                    item.hidden = !selected;
                });
                this.selectedTab = definition.id;
            });
            tabs.appendChild(tab);
            contents.appendChild(content);
        }
        panel.appendChild(tabs);
        panel.appendChild(contents);
        container.appendChild(panel);
        const graph = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '16 / 1',
            mobileAspectRatio: '3 / 1',
            className: 'am-radio-simulator-hud',
            onResize: () => this.drawHud()
        });
        this.hudGraphDispose = graph.dispose;
        this.hudCanvas = graph.canvas;
        this.hudCanvas.setAttribute('aria-label', 'AM radio receiver status');
        const stereoLamp = document.createElement('div');
        stereoLamp.className = 'am-radio-simulator-stereo-lamp';
        stereoLamp.setAttribute('role', 'status');
        stereoLamp.setAttribute('aria-label', 'Stereo reception off');
        const stereoIndicator = document.createElement('span');
        stereoIndicator.className = 'am-radio-simulator-stereo-lamp-indicator';
        stereoIndicator.setAttribute('aria-hidden', 'true');
        const stereoLabel = document.createElement('span');
        stereoLabel.textContent = 'STEREO';
        stereoLamp.appendChild(stereoIndicator);
        stereoLamp.appendChild(stereoLabel);
        graph.container.appendChild(stereoLamp);
        this.stereoLamp = stereoLamp;
        container.appendChild(graph.container);
        graph.resize();
        if (typeof IntersectionObserver === 'function') {
            this.hudObserver = new IntersectionObserver(entries => {
                this.hudVisible = entries.some(entry => entry.isIntersecting);
                if (this.hudVisible) this.startAnimation();
                else this.stopAnimation();
            });
            this.hudObserver.observe(this.hudCanvas);
        }
        this.startAnimation();
        return container;
    }

    startAnimation() {
        if (!this.hudVisible || this.animationFrameId) return;
        const animate = () => {
            this.drawHud();
            this.animationFrameId = this.requestPowerAnimationFrame(animate);
        };
        this.animationFrameId = this.requestPowerAnimationFrame(animate);
    }

    stopAnimation() {
        if (!this.animationFrameId) return;
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    drawHud() {
        const canvas = this.hudCanvas;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        const width = canvas.width;
        const height = canvas.height;
        const cssWidth = canvas.clientWidth || canvas.getBoundingClientRect?.().width || width || 1;
        const scale = width / cssWidth;
        const values = this.hudValues;
        let stereoBlend = Number.isFinite(values.stereoBlend) ? values.stereoBlend : 0;
        if (stereoBlend < 0) stereoBlend = 0;
        else if (stereoBlend > 1) stereoBlend = 1;
        if (this.stereoLamp) {
            const lampBlend = this.enabled !== false && this.canRunAnimation() &&
                this.executionState.state === 'active' ? stereoBlend : 0;
            this.stereoLamp.style.setProperty('--stereo-blend', String(lampBlend));
            this.stereoLamp.classList.toggle('active', lampBlend > 0.01);
            this.stereoLamp.setAttribute('aria-label', lampBlend > 0.5 ?
                'Stereo reception on' : 'Stereo reception off');
        }
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#171717';
        context.fillRect(0, 0, width, height);
        if (this.enabled === false || !this.canRunAnimation()) {
            context.fillStyle = '#aaa';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.font = `${Math.round(13 * scale)}px Arial`;
            context.fillText(this.enabled === false ? 'Effect is off' : 'Receiver display paused', width / 2, height / 2);
            return;
        }
        if (this.executionState.state === 'pending') {
            context.fillStyle = '#9db7c7';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.font = `600 ${Math.round(13 * scale)}px Arial`;
            context.fillText('Loading AM radio processing…', width / 2, height / 2);
            return;
        }
        if (this.executionState.state === 'bypassed') {
            context.fillStyle = '#ffbf69';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.font = `600 ${Math.round(13 * scale)}px Arial`;
            context.fillText('AM radio processing is unavailable in this environment.', width / 2, height * 0.42);
            context.fillStyle = '#aaa';
            context.font = `${Math.round(11 * scale)}px Arial`;
            context.fillText('Audio remains unchanged.', width / 2, height * 0.65);
            return;
        }
        const narrow = cssWidth < 560;
        const columns = narrow ? 2 : 4;
        const rows = narrow ? 2 : 1;
        const padding = 6 * scale;
        const gap = 5 * scale;
        const cardWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
        const cardHeight = (height - padding * 2 - gap * (rows - 1)) / rows;
        const sValue = values.carrierPreAgcDb <= -73 ? 1 : (values.carrierPreAgcDb >= -25 ? 9 : 1 + (values.carrierPreAgcDb + 73) / 6);
        const eventActive = performance.now() < this.eventFlashUntil;
        const cards = [
            { title: 'S METER', value: `S${sValue.toFixed(1)}`, level: sValue / 9 },
            { title: 'AGC GAIN', value: `${values.agcGainDb >= 0 ? '+' : ''}${values.agcGainDb.toFixed(1)} dB`, level: (values.agcGainDb - AM_RADIO_SIMULATOR_MINIMUM_AGC_GAIN_DB) / (AM_RADIO_SIMULATOR_MAXIMUM_AGC_GAIN_DB - AM_RADIO_SIMULATOR_MINIMUM_AGC_GAIN_DB) },
            { title: 'MODULATION', value: `${values.modPercent.toFixed(0)}%`, level: values.modPercent / 160 },
            { title: 'FADE / EVENTS', value: `${values.fadeDb.toFixed(1)} dB  ⚡${values.staticRate.toFixed(1)}  ▲${values.clipRate.toFixed(1)}`, level: eventActive ? 1 : (values.fadeDb + 80) / 86 }
        ];
        cards.forEach((card, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const x = padding + column * (cardWidth + gap);
            const y = padding + row * (cardHeight + gap);
            context.fillStyle = '#222';
            context.fillRect(x, y, cardWidth, cardHeight);
            context.strokeStyle = eventActive && index === 3 ? '#ffb347' : '#454545';
            context.strokeRect(x + 0.5 * scale, y + 0.5 * scale, cardWidth - scale, cardHeight - scale);
            context.fillStyle = '#9db7c7';
            context.textAlign = 'left';
            context.textBaseline = 'top';
            context.font = `600 ${Math.round(9 * scale)}px Arial`;
            context.fillText(card.title, x + 6 * scale, y + 5 * scale);
            context.fillStyle = '#f0f0f0';
            context.font = `${Math.round(11 * scale)}px Arial`;
            context.fillText(card.value, x + 6 * scale, y + 21 * scale, cardWidth - 12 * scale);
            const level = card.level < 0 ? 0 : (card.level > 1 ? 1 : card.level);
            context.fillStyle = '#363636';
            context.fillRect(x + 6 * scale, y + cardHeight - 9 * scale, cardWidth - 12 * scale, 4 * scale);
            context.fillStyle = eventActive && index === 3 ? '#ffb347' : '#69c8ff';
            context.fillRect(x + 6 * scale, y + cardHeight - 9 * scale, (cardWidth - 12 * scale) * level, 4 * scale);
        });
    }

    cleanup() {
        this.disposeDspTelemetrySubscription();
        this.stopAnimation();
        this.hudObserver?.disconnect();
        this.hudObserver = null;
        this.hudGraphDispose?.();
        this.hudGraphDispose = null;
        this.hudCanvas = null;
        this.stereoLamp = null;
        super.cleanup();
    }
}

window.AMRadioSimulatorPlugin = AMRadioSimulatorPlugin;
