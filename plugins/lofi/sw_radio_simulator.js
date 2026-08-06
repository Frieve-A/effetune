// SW (Shortwave) Radio Simulator.
// Runtime processing is WASM-only. The JavaScript implementation below is the
// frozen reference used to generate the golden vectors, gated behind the hidden `fr`
// parameter; with `fr` off the processor is a pass-through that reports a bypass marker.
//
// The signal chain is a fork of the shipped AM
// Radio Simulator complex-envelope engine with the C-QUAM stereo machinery removed and the
// HF differences applied: ionospheric delay spread (ds), Doppler spread up to 10 Hz,
// heterodyne offsets down to 0.1 kHz, skywave-dominant defaults, and an optional
// synchronous detector built on the carrier-recovery PLL proven by the C-QUAM work.

const SW_RADIO_SIMULATOR_MINIMUM_AGC_GAIN_DB = -12;
const SW_RADIO_SIMULATOR_MAXIMUM_AGC_GAIN_DB = 42;
const SW_RADIO_SIMULATOR_S_METER_MINIMUM_DB = -50;
const SW_RADIO_SIMULATOR_S_METER_MAXIMUM_DB = 6;

// Binary telemetry contract shared with dsp/plugins/lofi/sw_radio_simulator/kernel.cpp and
// registered in js/audio/telemetry-hub.js. Format version 1 is exactly 24 little-endian
// bytes: four float32 scalars followed by two cumulative u32 event counters.
const SW_RADIO_SIMULATOR_TAP_STATUS = 18;
const SW_RADIO_SIMULATOR_TELEMETRY_VERSION = 1;
const SW_RADIO_SIMULATOR_TELEMETRY_BYTES = 24;

const SW_RADIO_SIMULATOR_REFERENCE_PROCESSOR = `
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
    const AGC_MINIMUM_GAIN_DB = ${SW_RADIO_SIMULATOR_MINIMUM_AGC_GAIN_DB};
    const AGC_MAXIMUM_GAIN_DB = ${SW_RADIO_SIMULATOR_MAXIMUM_AGC_GAIN_DB};
    const DETECTOR_DIODE_TO_LOAD_RESISTANCE_RATIO = 0.02;
    const TRANSITION_TIME = 0.020;
    const MAXIMUM_DIGITAL_TUNING_HZ = 15000;
    const STATIC_RANDOM_SALT = 0xa511e9b3;
    const STATIC_ZERO_FALLBACK = 0xeffe7a5e;
    const STATIC_CARRIER_AREA_SECONDS = 20.0e-6;
    // The salted static stream starts from a low-entropy neighbour of the base seed; 16 idle
    // xorshift draws decorrelate it before the first Poisson interval is drawn.
    const STATIC_RANDOM_WARMUP_DRAWS = 16;
    // One-sided ENBW of the complex-baseband IF cascade - the 6th-order Butterworth low-pass
    // that runs on each quadrature - measured as 3033.599 Hz at a 3000 Hz cutoff (a 6 kHz IF
    // bandwidth) and 96 kHz. It is neither the AM default nor the shortwave default bandwidth.
    // The ENBW is proportional to the cutoff, so the same measurement also sizes the in-band
    // noise the AGC is seeded with.
    const IF_CASCADE_ENBW_RATIO = 3033.599 / 3000;
    // Modulation depth of the co-channel interferer, whose programme is a 4.5 kHz shaped
    // unit-variance noise. The sidebands it produces are what the IF still passes once the
    // interferer carrier itself sits outside the passband.
    const INTERFERER_MODULATION_DEPTH = 0.35;
    // Per-quadrature thermal noise density, calibrated against that ENBW.
    const THERMAL_NOISE_CALIBRATION = 0.9944467442996018;
    // Ionospheric tap geometry: tau1 = 0.4375*ds, tau2 = tau1 + ds. ITU-R F.1487 defines ds as
    // the differential delay between the two sky modes; the 0.4375 ratio reproduces the shipped
    // AM geometry (0.7 ms / 2.3 ms) exactly at ds = 1.6 ms.
    const SKY_FIRST_DELAY_RATIO = 0.4375;
    const MAXIMUM_DELAY_SPREAD_SECONDS = 0.008;
    const MINIMUM_IF_CUTOFF_HZ = 1000;
    const SYNC_PLL_CAPTURE_NATURAL_HZ = 60;
    const SYNC_PLL_TRACK_NATURAL_HZ = 1.5;
    const SYNC_PLL_CAPTURE_DAMPING = 0.7;
    const SYNC_PLL_TRACK_DAMPING = 1.0;
    const SYNC_PLL_FREQUENCY_LIMIT_HZ = 1000;
    const SYNC_PLL_TOTAL_FREQUENCY_TAU = 0.200;
    const SYNC_PLL_QUALIFY_SECONDS = 0.100;
    const SYNC_PLL_OUTSIDE_SECONDS = 0.200;
    const SYNC_PLL_QUALIFY_DELTA_HZ = 5;
    const SYNC_PLL_QUALIFY_RESIDUAL_HZ = 5;
    const SYNC_PLL_INSIDE_RATIO = 0.96;
    const SYNC_PLL_OUTSIDE_RATIO = 1.04;
    const SYNC_EPSILON_ABSOLUTE = 1e-6;
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

    function bankResponsePower(bank, omega) {
        const cosine1 = Math.cos(omega);
        const sine1 = -Math.sin(omega);
        const cosine2 = Math.cos(2 * omega);
        const sine2 = -Math.sin(2 * omega);
        let power = 1;
        for (let index = 0; index < bank.length; index++) {
            const filter = bank[index];
            const numeratorReal = filter.b0 + filter.b1 * cosine1 + filter.b2 * cosine2;
            const numeratorImaginary = filter.b1 * sine1 + filter.b2 * sine2;
            const denominatorReal = 1 + filter.a1 * cosine1 + filter.a2 * cosine2;
            const denominatorImaginary = filter.a1 * sine1 + filter.a2 * sine2;
            power *= (numeratorReal * numeratorReal + numeratorImaginary * numeratorImaginary) /
                (denominatorReal * denominatorReal + denominatorImaginary * denominatorImaginary);
        }
        return power;
    }

    function resetBiquadState(filter) {
        filter.z1 = 0;
        filter.z2 = 0;
    }

    function resetBankState(bank) {
        for (let index = 0; index < bank.length; index++) resetBiquadState(bank[index]);
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

    function syncWarmupSamples(sampleRate) {
        let maximumPoleRadius = 0;
        const filter = makeBiquad();
        for (let index = 0; index < BUTTERWORTH_6_Q.length; index++) {
            configureLowPass(filter, MINIMUM_IF_CUTOFF_HZ, BUTTERWORTH_6_Q[index], sampleRate);
            const poleRadius = Math.sqrt(filter.a2 > 0 ? filter.a2 : 0);
            if (poleRadius > maximumPoleRadius) maximumPoleRadius = poleRadius;
        }
        return maximumPoleRadius > 0 && maximumPoleRadius < 1 ?
            Math.ceil(Math.log(SYNC_EPSILON_ABSOLUTE) / Math.log(maximumPoleRadius)) : 0;
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

    function updateDelayGeometry(state) {
        const spreadSeconds = state.controls.ds * 1e-3;
        const first = spreadSeconds * SKY_FIRST_DELAY_RATIO;
        const second = first + spreadSeconds;
        state.delay1Samples = Math.floor(state.sampleRate * first + 0.5);
        state.delay2Samples = Math.floor(state.sampleRate * second + 0.5);
        if (state.delay2Samples >= state.delay.length) state.delay2Samples = state.delay.length - 1;
    }

    function advancePhase(state, key, increment) {
        state[key] += increment;
        if (state[key] >= TWO_PI) state[key] -= TWO_PI;
        else if (state[key] < 0) state[key] += TWO_PI;
    }

    function speakerIndex(value) {
        return value === 'Off' ? 0 : (value === 'Table' ? 2 : 1);
    }

    function agcSpeedIndex(value) {
        return value === 'Slow' ? 0 : (value === 'Fast' ? 2 : 1);
    }

    function detectorIndex(value) {
        return value === 'Synchronous' ? 1 : 0;
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

    function transitionSamples(sampleRate) {
        const samples = Math.floor(sampleRate * TRANSITION_TIME + 0.5);
        return samples >= 1 ? samples : 1;
    }

    function startSpeakerTransition(state, speaker) {
        configureSpeakerPath(speaker, state.nextSpeakerHighPass, state.nextSpeakerPeak,
            state.nextSpeakerLowPass, state.sampleRate);
        state.speakerTarget = speaker;
        state.speakerTransitionTotal = transitionSamples(state.sampleRate);
        state.speakerTransitionRemaining = state.speakerTransitionTotal;
    }

    function makeDetectorChain() {
        return {
            interpI: makeBank(3),
            interpQ: makeBank(3),
            decimation: makeBank(2),
            capacitor: 0,
            clipping: false
        };
    }

    function configureDetectorChain(chain, sampleRate) {
        configureBank(chain.interpI, 14000, BUTTERWORTH_6_Q, sampleRate * 5);
        configureBank(chain.interpQ, 14000, BUTTERWORTH_6_Q, sampleRate * 5);
        configureBank(chain.decimation, 10000, BUTTERWORTH_4_Q, sampleRate * 5);
        resetBankState(chain.interpI);
        resetBankState(chain.interpQ);
        resetBankState(chain.decimation);
        chain.capacitor = 0;
        chain.clipping = false;
    }

    function resetSyncPll(state) {
        state.syncPllPhase = 0;
        state.syncPllFrequency = 0;
        state.syncPllCorrectedPhase = 0;
        state.syncPllTotalFrequencyHz = 0;
        state.syncPllTotalFrequencyValid = false;
        state.syncPllWarmupRemaining = state.syncPllWarmupSamples;
        state.syncPllPreviousI = 0;
        state.syncPllPreviousQ = 0;
        state.syncPllPreviousValid = false;
        state.syncPllResidualHz = 0;
        state.syncPllState = 0;
        state.syncPllQualifyHold = 0;
        state.syncPllOutsideHold = 0;
        state.syncPllHistoryPosition = 0;
        state.syncPllHistory.fill(0);
    }

    // Engaging the synchronous detector restarts carrier acquisition, exactly as a real
    // receiver does; the 20 ms crossfade only covers the detector level step.
    function startDetectorTransition(state, detector) {
        configureDetectorChain(state.detectorSecondary, state.sampleRate);
        if (detector === 0) {
            state.detectorSecondary.capacitor =
                Number.isFinite(state.lastIfEnvelope) ? state.lastIfEnvelope : 0;
        } else {
            resetSyncPll(state);
        }
        state.detectorTarget = detector;
        state.detectorTransitionTotal = transitionSamples(state.sampleRate);
        state.detectorTransitionRemaining = state.detectorTransitionTotal;
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

    function fadeFilterPole(state) {
        const controlRate = state.sampleRate / CONTROL_INTERVAL;
        return Math.exp(-TWO_PI * state.controls.fd / controlRate);
    }

    function fadeTapNormalizer(pole) {
        const oneMinus = 1 - pole;
        const poleSquared = pole * pole;
        const denominator = 1 - poleSquared;
        const varianceGain = oneMinus * oneMinus * oneMinus * oneMinus * (1 + poleSquared) /
            (denominator * denominator * denominator);
        return varianceGain > 1e-20 ? 1 / Math.sqrt(varianceGain) : 0;
    }

    // Cold start for the two-pole Doppler shaping filters. Leaving them at zero would place
    // every sky mode in a simultaneous null, a state no real path presents, and the receiver
    // would then have to chase the recovery from a level the channel never actually delivers.
    // Driven by w ~ N(0, 1/2) the stationary covariance of the pair (x1, x2) is known in closed
    // form, so its Cholesky factor turns two standard normals per quadrature into an exactly
    // settled draw: Rayleigh taps with E[|tap|^2] = 1 at every sample rate, RNG consumption
    // fixed at four draws per tap, and the cost paid once per reset.
    function seedFadeTap(state, tap, pole, normalizer) {
        const feed = 1 - pole;
        const denominator = 1 - pole * pole;
        const usable = denominator > 1e-20;
        const firstScale = usable ? SQRT_HALF * feed / Math.sqrt(denominator) : 0;
        const secondScale = usable ?
            SQRT_HALF * feed * feed / (denominator * Math.sqrt(denominator)) : 0;
        const inphaseFirst = gaussian(state);
        const inphaseSecond = gaussian(state);
        const quadratureFirst = gaussian(state);
        const quadratureSecond = gaussian(state);
        tap.i1 = firstScale * inphaseFirst;
        tap.i2 = secondScale * (inphaseFirst + pole * inphaseSecond);
        tap.q1 = firstScale * quadratureFirst;
        tap.q2 = secondScale * (quadratureFirst + pole * quadratureSecond);
        tap.i = tap.i2 * normalizer;
        tap.q = tap.q2 * normalizer;
        tap.stepI = 0;
        tap.stepQ = 0;
    }

    function makeState(sampleRate, pairChannels, speaker, detector, baseSeed) {
        // Worst-case ionospheric geometry: tau2 = (1 + SKY_FIRST_DELAY_RATIO) * ds_max.
        const delayLength = Math.ceil(sampleRate * (1 + SKY_FIRST_DELAY_RATIO) *
            MAXIMUM_DELAY_SPREAD_SECONDS) + 4;
        const normalizedBase = (baseSeed >>> 0) === 0 ? STATIC_ZERO_FALLBACK : baseSeed >>> 0;
        let staticRandomState = (normalizedBase ^ STATIC_RANDOM_SALT) >>> 0;
        if (staticRandomState === 0) staticRandomState = STATIC_ZERO_FALLBACK;
        const qualifySamples = Math.max(1, Math.round(sampleRate * SYNC_PLL_QUALIFY_SECONDS));
        const state = {
            sampleRate,
            pairChannels,
            speaker,
            detector,
            randomState: normalizedBase,
            staticRandomState,
            staticNextEventDeadlineSeconds: -1,
            staticScheduledRate: 0,
            staticScheduleActive: false,
            gaussianHasSpare: false,
            gaussianSpare: 0,
            delay: new Float64Array(delayLength >= 4 ? delayLength : 4),
            delayPosition: 0,
            delay1Samples: 0,
            delay2Samples: 0,
            sampleCounter: 0,
            controlRemaining: 0,
            controlSmoothing: 1 - Math.exp(-CONTROL_INTERVAL / (sampleRate * 0.020)),
            controls: {
                tb: parameters.tb, pe: parameters.pe, md: parameters.md, cp: parameters.cp,
                sg: parameters.sg, sk: parameters.sk, fd: parameters.fd, ds: parameters.ds,
                in: parameters.in, io: parameters.io, tn: parameters.tn, bw: parameters.bw,
                dt: parameters.dt, hm: parameters.hm, og: parameters.og, mx: parameters.mx,
                hz: Number(parameters.hz)
            },
            txHighPass: makeBiquad(),
            preEmphasisPole: Math.exp(-TWO_PI * 2100 / sampleRate),
            preEmphasisShelfGain: 0,
            preEmphasisLow: 0,
            limiterAttackCoefficient: Math.exp(-1 / (sampleRate * 0.002)),
            limiterReleaseCoefficient: Math.exp(-1 / (sampleRate * 0.080)),
            limiterThreshold: 1,
            limiterDepth: 0,
            limiterEnvelope: 0,
            limiterGain: 1,
            modulation: 0,
            txInterp: makeBank(2),
            txFilters: makeBank(4),
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
            humPhase: 0,
            humAmount: 0,
            humPhaseIncrement: 0,
            ifI: makeBank(3),
            ifQ: makeBank(3),
            detectorPrimary: makeDetectorChain(),
            detectorSecondary: makeDetectorChain(),
            detectorTarget: detector,
            detectorTransitionTotal: 0,
            detectorTransitionRemaining: 0,
            detectorCharge: 0,
            detectorRelease: 0,
            interpolatorDelayHostSamples: 0,
            syncPllPhase: 0,
            syncPllFrequency: 0,
            syncPllCorrectedPhase: 0,
            syncPllFrequencyLimit: TWO_PI * SYNC_PLL_FREQUENCY_LIMIT_HZ / sampleRate,
            syncPllTotalFrequencyHz: 0,
            syncPllTotalFrequencyValid: false,
            syncPllTotalAlpha: 1 - Math.exp(-1 / (sampleRate * SYNC_PLL_TOTAL_FREQUENCY_TAU)),
            syncPllWarmupSamples: syncWarmupSamples(sampleRate),
            syncPllWarmupRemaining: 0,
            syncPllPreviousI: 0,
            syncPllPreviousQ: 0,
            syncPllPreviousValid: false,
            syncPllResidualHz: 0,
            syncPllState: 0,
            syncPllQualifyHold: 0,
            syncPllOutsideHold: 0,
            syncPllOutsideSamples: Math.max(1, Math.round(sampleRate * SYNC_PLL_OUTSIDE_SECONDS)),
            syncPllHistory: new Float64Array(qualifySamples),
            syncPllHistoryPosition: 0,
            agcDetectorStage1: 1,
            agcDetectorStage2: 1,
            agcDetectorAttackCoefficient: 0,
            agcDetectorReleaseCoefficient: 0,
            agcGainDb: 0,
            agcLinearGain: 1,
            inverseAgcLinearGain: 1,
            dcPreviousInput: 0,
            dcPreviousOutput: 0,
            dcCoefficient: Math.exp(-TWO_PI * 20 / sampleRate),
            lastIfEnvelope: 0,
            speakerHighPass: makeBiquad(),
            speakerPeak: makeBiquad(),
            speakerLowPass: makeBiquad(),
            nextSpeakerHighPass: makeBiquad(),
            nextSpeakerPeak: makeBiquad(),
            nextSpeakerLowPass: makeBiquad(),
            speakerTarget: speaker,
            speakerTransitionTotal: 0,
            speakerTransitionRemaining: 0,
            outputGain: 1,
            mix: 1,
            dryMix: 0,
            carrierPreAgcDb: 0,
            modPercent: 0,
            fadeDb: 0,
            staticCount: 0,
            clipCount: 0,
            clipActive: false
        };
        for (let index = 0; index < STATIC_RANDOM_WARMUP_DRAWS; index++) nextStaticRandom(state);
        configureHighPass(state.txHighPass, 50, SQRT_HALF, sampleRate);
        configureBank(state.txInterp, 14000, BUTTERWORTH_4_Q, sampleRate * 3);
        configureBank(state.txFilters, parameters.tb * 1000, BUTTERWORTH_8_Q, sampleRate * 3);
        configureBank(state.ifI, parameters.bw * 500, BUTTERWORTH_6_Q, sampleRate);
        configureBank(state.ifQ, parameters.bw * 500, BUTTERWORTH_6_Q, sampleRate);
        updateTuningModel(state);
        updateDelayGeometry(state);
        const initialFadePole = fadeFilterPole(state);
        const initialFadeNormalizer = fadeTapNormalizer(initialFadePole);
        seedFadeTap(state, state.fade1, initialFadePole, initialFadeNormalizer);
        seedFadeTap(state, state.fade2, initialFadePole, initialFadeNormalizer);
        configureBank(state.interfererFilters, 4500, BUTTERWORTH_4_Q, sampleRate);
        state.interfererNormalizer = bankNoiseNormalizer(state.interfererFilters);
        // AGC cold start from the stationary expectation of the pre-AGC IF magnitude. Ground
        // wave and sky wave form an equal-power mixture by construction (ground^2 + sky^2 = 1
        // with E[|tap|^2] = 1 per mode), so the propagation factor is unity whatever the skywave
        // share; the co-channel station and the in-band noise then add in RSS.
        const initialIfCutoffHz = state.controls.bw * 500;
        const initialStationOffsetHz = state.stationTuningOffsetHz < 0 ?
            -state.stationTuningOffsetHz : state.stationTuningOffsetHz;
        const initialInterfererOffsetHz = state.interfererTuningOffsetHz < 0 ?
            -state.interfererTuningOffsetHz : state.interfererTuningOffsetHz;
        const initialStation = Math.pow(10, state.controls.sg / 20) * state.stationTuningGain *
            butterworth6Magnitude(initialStationOffsetHz, initialIfCutoffHz);
        const initialInterfererLevel = Math.pow(10, state.controls.in / 20) *
            state.interfererTuningGain;
        const initialInterfererCarrier = initialInterfererLevel *
            butterworth6Magnitude(initialInterfererOffsetHz, initialIfCutoffHz);
        // The interferer is an AM station, not a bare carrier: its programme sidebands sit around
        // the offset and are 4.5 kHz wide, so once the offset moves the carrier out of the IF the
        // sidebands are what the receiver still hears. Their two-sided density is not flat across
        // the IF passband - across a wide IF the 4th-order programme shaping makes the density
        // itself vary by ~40 dB at 96 kHz (~51 dB at 48 kHz), and a single sample taken at the
        // offset then underestimates the passband average by up to ~17 dB at 96 kHz. The density
        // that multiplies the complex IF noise bandwidth is therefore approximated numerically as
        // the power mean of five samples spanning that bandwidth, at the offset and at +/-B/2 and
        // +/-B with B = ENBW ratio * IF cutoff. The programme filter is real, so a probe that
        // crosses zero folds back onto its mirror frequency.
        const initialSidebandSpanHz = IF_CASCADE_ENBW_RATIO * initialIfCutoffHz;
        let initialSidebandPower = 0;
        for (let probe = -2; probe <= 2; probe++) {
            const probeHz = initialInterfererOffsetHz + probe * 0.5 * initialSidebandSpanHz;
            const foldedHz = probeHz < 0 ? -probeHz : probeHz;
            initialSidebandPower += bankResponsePower(state.interfererFilters,
                TWO_PI * foldedHz / sampleRate);
        }
        initialSidebandPower *= 0.2;
        const initialInterfererSidebandDensity = INTERFERER_MODULATION_DEPTH *
            initialInterfererLevel * state.interfererNormalizer *
            Math.sqrt(initialSidebandPower);
        const initialInterfererSideband = initialInterfererSidebandDensity *
            Math.sqrt(2 * IF_CASCADE_ENBW_RATIO * initialIfCutoffHz / sampleRate);
        const initialInterferer = Math.sqrt(
            initialInterfererCarrier * initialInterfererCarrier +
            initialInterfererSideband * initialInterfererSideband);
        // Both quadratures carry the shaped thermal noise, so the magnitude the carrier detector
        // sees is sqrt(2) above the per-quadrature RMS the IF cascade passes.
        const initialNoise = state.thermalNoiseStd *
            Math.sqrt(4 * IF_CASCADE_ENBW_RATIO * initialIfCutoffHz / sampleRate);
        let initialCarrier = Math.sqrt(initialStation * initialStation +
            initialInterferer * initialInterferer + initialNoise * initialNoise);
        if (initialCarrier < 1e-6) initialCarrier = 1e-6;
        const initialCarrierDb = 20 * Math.log10(initialCarrier);
        let initialAgcGainDb = AGC_TARGET_DB - initialCarrierDb;
        if (initialAgcGainDb < AGC_MINIMUM_GAIN_DB) initialAgcGainDb = AGC_MINIMUM_GAIN_DB;
        if (initialAgcGainDb > AGC_MAXIMUM_GAIN_DB) initialAgcGainDb = AGC_MAXIMUM_GAIN_DB;
        state.agcDetectorStage1 = initialCarrier;
        state.agcDetectorStage2 = initialCarrier;
        state.agcGainDb = initialAgcGainDb;
        state.carrierPreAgcDb = initialCarrierDb;
        configureDetectorChain(state.detectorPrimary, sampleRate);
        configureDetectorChain(state.detectorSecondary, sampleRate);
        state.interpolatorDelayHostSamples =
            filterGroupDelayAtDc(state.detectorPrimary.interpI) / 5;
        resetSyncPll(state);
        updateDetectorCoefficients(state);
        updateControlCoefficients(state, agcSpeedIndex(parameters.ag));
        configureSpeakerPath(speaker, state.speakerHighPass, state.speakerPeak,
            state.speakerLowPass, sampleRate);
        return state;
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
        const keys = ['tb', 'pe', 'md', 'cp', 'sg', 'sk', 'fd', 'ds', 'in', 'io', 'tn', 'bw',
            'dt', 'hm', 'og', 'mx'];
        for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            state.controls[key] += state.controlSmoothing * (parameters[key] - state.controls[key]);
        }
        state.controls.hz += state.controlSmoothing * (Number(parameters.hz) - state.controls.hz);
        configureBank(state.txFilters, state.controls.tb * 1000, BUTTERWORTH_8_Q,
            state.sampleRate * 3);
        configureBank(state.ifI, state.controls.bw * 500, BUTTERWORTH_6_Q, state.sampleRate);
        configureBank(state.ifQ, state.controls.bw * 500, BUTTERWORTH_6_Q, state.sampleRate);
        updateTuningModel(state);
        updateDetectorCoefficients(state);
        updateDelayGeometry(state);

        const pole = fadeFilterPole(state);
        const normalizer = fadeTapNormalizer(pole);
        updateFadeTap(state, state.fade1, pole, normalizer);
        updateFadeTap(state, state.fade2, pole, normalizer);

        const detected = state.agcDetectorStage2 > 1e-12 ? state.agcDetectorStage2 : 1e-12;
        const detectedDb = 20 * Math.log10(detected);
        let targetGain = AGC_TARGET_DB - detectedDb;
        if (targetGain < AGC_MINIMUM_GAIN_DB) targetGain = AGC_MINIMUM_GAIN_DB;
        if (targetGain > AGC_MAXIMUM_GAIN_DB) targetGain = AGC_MAXIMUM_GAIN_DB;
        const speed = agcSpeedIndex(parameters.ag);
        const time = targetGain < state.agcGainDb ?
            AGC_ATTACK_TIMES[speed] : AGC_RELEASE_TIMES[speed];
        const coefficient = 1 - Math.exp(-CONTROL_INTERVAL / (state.sampleRate * time));
        state.agcGainDb += coefficient * (targetGain - state.agcGainDb);
        let preAgc = detectedDb;
        if (preAgc < -80) preAgc = -80;
        if (preAgc > 6) preAgc = 6;
        state.carrierPreAgcDb = preAgc;
        updateControlCoefficients(state, speed);
        state.controlRemaining = CONTROL_INTERVAL;
    }

    function stepSyncPll(state, i, q) {
        const magnitude = Math.sqrt(i * i + q * q);
        const valid = magnitude >= SYNC_EPSILON_ABSOLUTE;
        if (state.syncPllWarmupRemaining > 0) {
            state.syncPllWarmupRemaining--;
            state.syncPllPreviousValid = false;
        } else {
            if (valid && state.syncPllPreviousValid) {
                const productReal = i * state.syncPllPreviousI + q * state.syncPllPreviousQ;
                const productImaginary = q * state.syncPllPreviousI - i * state.syncPllPreviousQ;
                const instantaneousHz = Math.atan2(productImaginary, productReal) *
                    state.sampleRate / TWO_PI;
                if (!state.syncPllTotalFrequencyValid) {
                    state.syncPllTotalFrequencyHz = instantaneousHz;
                    state.syncPllTotalFrequencyValid = true;
                } else {
                    state.syncPllTotalFrequencyHz += state.syncPllTotalAlpha *
                        (instantaneousHz - state.syncPllTotalFrequencyHz);
                }
            }
            state.syncPllPreviousI = i;
            state.syncPllPreviousQ = q;
            state.syncPllPreviousValid = valid;
        }

        const cosine = Math.cos(state.syncPllPhase);
        const sine = Math.sin(state.syncPllPhase);
        const rotatedQ = q * cosine - i * sine;
        const inverse = 1 / (magnitude > SYNC_EPSILON_ABSOLUTE ? magnitude : SYNC_EPSILON_ABSOLUTE);
        const error = rotatedQ * inverse;
        const naturalFrequency = state.syncPllState === 1 ?
            SYNC_PLL_TRACK_NATURAL_HZ : SYNC_PLL_CAPTURE_NATURAL_HZ;
        const damping = state.syncPllState === 1 ?
            SYNC_PLL_TRACK_DAMPING : SYNC_PLL_CAPTURE_DAMPING;
        const normalized = TWO_PI * naturalFrequency / state.sampleRate;
        let frequency = state.syncPllFrequency + normalized * normalized * error;
        if (frequency < -state.syncPllFrequencyLimit) frequency = -state.syncPllFrequencyLimit;
        else if (frequency > state.syncPllFrequencyLimit) frequency = state.syncPllFrequencyLimit;
        state.syncPllFrequency = frequency;
        const correctedPhase = state.syncPllPhase + 2 * damping * normalized * error;
        state.syncPllPhase = correctedPhase + frequency;
        if (state.syncPllPhase >= TWO_PI) state.syncPllPhase -= TWO_PI;
        else if (state.syncPllPhase < 0) state.syncPllPhase += TWO_PI;

        const estimatedHz = frequency * state.sampleRate / TWO_PI;
        state.syncPllResidualHz = state.syncPllTotalFrequencyHz - estimatedHz;
        const oldHz = state.syncPllHistory[state.syncPllHistoryPosition];
        state.syncPllHistory[state.syncPllHistoryPosition] = estimatedHz;
        state.syncPllHistoryPosition++;
        if (state.syncPllHistoryPosition === state.syncPllHistory.length) {
            state.syncPllHistoryPosition = 0;
        }
        const delta = estimatedHz - oldHz;
        const absoluteDelta = delta < 0 ? -delta : delta;
        const absoluteResidual = state.syncPllResidualHz < 0 ?
            -state.syncPllResidualHz : state.syncPllResidualHz;
        const absoluteTotal = state.syncPllTotalFrequencyHz < 0 ?
            -state.syncPllTotalFrequencyHz : state.syncPllTotalFrequencyHz;
        if (state.syncPllState === 0) {
            const eligible = state.syncPllTotalFrequencyValid &&
                absoluteDelta < SYNC_PLL_QUALIFY_DELTA_HZ &&
                absoluteResidual < SYNC_PLL_QUALIFY_RESIDUAL_HZ &&
                absoluteTotal <= SYNC_PLL_FREQUENCY_LIMIT_HZ * SYNC_PLL_INSIDE_RATIO;
            state.syncPllQualifyHold = eligible ? state.syncPllQualifyHold + 1 : 0;
            if (state.syncPllQualifyHold >= state.syncPllHistory.length) {
                state.syncPllState = 1;
                state.syncPllQualifyHold = 0;
                state.syncPllOutsideHold = 0;
            }
        } else {
            state.syncPllOutsideHold =
                absoluteTotal >= SYNC_PLL_FREQUENCY_LIMIT_HZ * SYNC_PLL_OUTSIDE_RATIO ?
                    state.syncPllOutsideHold + 1 : 0;
            if (state.syncPllOutsideHold >= state.syncPllOutsideSamples) {
                state.syncPllState = 0;
                state.syncPllQualifyHold = 0;
                state.syncPllOutsideHold = 0;
            }
        }
        state.syncPllCorrectedPhase = correctedPhase;
    }

    function runDetector(state, mode, chain, inputI, inputQ) {
        let detected = 0;
        if (mode === 1) {
            // One sin/cos pair per host sample; the five sub-sample phases advance by a constant
            // small angle handled with a truncated series (|delta| <= 0.0131 rad at 96 kHz with
            // the 1000 Hz clamp, series error < 1e-12). The WASM kernel must use this exact
            // recurrence - parity depends on it.
            const delayCompensation = state.syncPllFrequency * state.interpolatorDelayHostSamples;
            const base = state.syncPllCorrectedPhase - delayCompensation;
            let cosineUsed = Math.cos(base);
            let sineUsed = Math.sin(base);
            const delta = state.syncPllFrequency * 0.2;
            const deltaSquared = delta * delta;
            const cosineStep = 1 - deltaSquared * 0.5 + deltaSquared * deltaSquared / 24;
            const sineStep = delta * (1 - deltaSquared / 6 + deltaSquared * deltaSquared / 120);
            for (let phase = 0; phase < 5; phase++) {
                const interpolatedI = processBank(chain.interpI, phase === 0 ? inputI * 5 : 0);
                const interpolatedQ = processBank(chain.interpQ, phase === 0 ? inputQ * 5 : 0);
                const rotatedI = interpolatedI * cosineUsed + interpolatedQ * sineUsed;
                detected = processBank(chain.decimation, rotatedI);
                const nextCosine = cosineUsed * cosineStep - sineUsed * sineStep;
                sineUsed = cosineUsed * sineStep + sineUsed * cosineStep;
                cosineUsed = nextCosine;
            }
            chain.clipping = false;
            return detected;
        }
        for (let phase = 0; phase < 5; phase++) {
            const interpolatedI = processBank(chain.interpI, phase === 0 ? inputI * 5 : 0);
            const interpolatedQ = processBank(chain.interpQ, phase === 0 ? inputQ * 5 : 0);
            const magnitude = Math.sqrt(interpolatedI * interpolatedI +
                interpolatedQ * interpolatedQ);
            chain.clipping = magnitude < chain.capacitor && chain.capacitor > magnitude * 1.05;
            const coefficient = magnitude > chain.capacitor ?
                state.detectorCharge : state.detectorRelease;
            chain.capacitor = magnitude + coefficient * (chain.capacitor - magnitude);
            detected = processBank(chain.decimation, chain.capacitor);
        }
        return detected;
    }

    const sampleRate = parameters.sampleRate;
    const blockSize = parameters.blockSize;
    const pairChannels = parameters.channelCount >= 2 ? 2 : 1;
    const selectedSpeaker = speakerIndex(parameters.sp);
    const selectedDetector = detectorIndex(parameters.de);
    if (!Number.isInteger(context.__swRadioBaseSeed)) {
        const seeded = typeof context.__seededRandom === 'function' ?
            context.__seededRandom() : 0.937232635;
        context.__swRadioBaseSeed = Math.floor(seeded * FLOAT53_SCALE) >>> 0;
    }
    let state = context.__swRadioSimulator;
    if (!state || state.sampleRate !== sampleRate || state.pairChannels !== pairChannels) {
        state = makeState(sampleRate, pairChannels, selectedSpeaker, selectedDetector,
            context.__swRadioBaseSeed);
        context.__swRadioSimulator = state;
    } else {
        if (state.speakerTransitionRemaining === 0 && state.speaker !== selectedSpeaker) {
            startSpeakerTransition(state, selectedSpeaker);
        }
        if (state.detectorTransitionRemaining === 0 && state.detector !== selectedDetector) {
            startDetectorTransition(state, selectedDetector);
        }
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

        const highPassed = processBiquad(state.txHighPass, mono);
        state.preEmphasisLow = state.preEmphasisPole * state.preEmphasisLow +
            (1 - state.preEmphasisPole) * highPassed;
        const emphasized = highPassed + state.preEmphasisShelfGain *
            (highPassed - state.preEmphasisLow);
        const absoluteInput = emphasized < 0 ? -emphasized : emphasized;
        const envelopeCoefficient = absoluteInput > state.limiterEnvelope ?
            state.limiterAttackCoefficient : state.limiterReleaseCoefficient;
        state.limiterEnvelope = absoluteInput +
            envelopeCoefficient * (state.limiterEnvelope - absoluteInput);
        let targetGain = 1;
        if (state.limiterEnvelope > state.limiterThreshold && state.limiterEnvelope > 1e-12) {
            const ratio = state.limiterThreshold / state.limiterEnvelope;
            targetGain = 1 + state.limiterDepth * (ratio - 1);
        }
        const gainCoefficient = targetGain < state.limiterGain ?
            state.limiterAttackCoefficient : state.limiterReleaseCoefficient;
        state.limiterGain = targetGain + gainCoefficient * (state.limiterGain - targetGain);
        const compressed = emphasized * state.limiterGain;

        let tx = 0;
        for (let phase = 0; phase < 3; phase++) {
            const interpolated = processBank(state.txInterp, phase === 0 ? compressed * 3 : 0);
            tx = processBank(state.txFilters, asymmetricLimit(interpolated));
        }
        const transmitted = 1 + state.modulation * tx;
        const modulationDeviation = (tx < 0 ? -tx : tx) * state.modulation * 100;
        if (modulationDeviation > blockModPeak) blockModPeak = modulationDeviation;

        state.delay[state.delayPosition] = transmitted;
        const size = state.delay.length;
        const position1 = state.delayPosition >= state.delay1Samples ?
            state.delayPosition - state.delay1Samples :
            size + state.delayPosition - state.delay1Samples;
        const position2 = state.delayPosition >= state.delay2Samples ?
            state.delayPosition - state.delay2Samples :
            size + state.delayPosition - state.delay2Samples;
        const delayed1 = state.delay[position1];
        const delayed2 = state.delay[position2];
        state.delayPosition++;
        if (state.delayPosition === size) state.delayPosition = 0;
        const stationI = state.signalGain * (state.groundGain * transmitted +
            state.skyGain * (state.fade1.i * delayed1 + state.fade2.i * delayed2));
        const stationQ = state.signalGain * state.skyGain *
            (state.fade1.q * delayed1 + state.fade2.q * delayed2);

        const tuningCosine = Math.cos(state.tuningPhase);
        const tuningSine = Math.sin(state.tuningPhase);
        advancePhase(state, 'tuningPhase', state.stationTuningPhaseIncrement);

        state.interfererProgram = processBank(state.interfererFilters, gaussian(state)) *
            state.interfererNormalizer;
        const interfererEnvelope = state.interfererTuningGain * state.interfererGain *
            (1 + INTERFERER_MODULATION_DEPTH * state.interfererProgram);
        const interfererI = interfererEnvelope * Math.cos(state.interfererPhase);
        const interfererQ = interfererEnvelope * Math.sin(state.interfererPhase);
        advancePhase(state, 'interfererPhase', state.interfererTuningPhaseIncrement);

        const thermalI = gaussian(state) * state.thermalNoiseStd;
        const thermalQ = gaussian(state) * state.thermalNoiseStd;

        let staticEvent = false;
        let staticI = 0;
        let staticQ = 0;
        const staticRate = parameters.st;
        const staticSampleEndSeconds = (state.sampleCounter + 1) / state.sampleRate;
        if (staticRate > 0) {
            if (!state.staticScheduleActive) {
                state.staticScheduleActive = true;
                state.staticNextEventDeadlineSeconds = state.sampleCounter / state.sampleRate +
                    staticIntervalSeconds(state, staticRate);
            } else if (state.staticScheduledRate !== staticRate) {
                // Exponential inter-arrival times are memoryless, so rescaling
                // the remaining time by the rate ratio keeps the pending draw
                // valid while making a rate increase audible immediately. No
                // extra RNG draw is consumed (parity depends on the stream).
                const nowSeconds = state.sampleCounter / state.sampleRate;
                const remainingSeconds = state.staticNextEventDeadlineSeconds - nowSeconds;
                if (remainingSeconds > 0) {
                    state.staticNextEventDeadlineSeconds = nowSeconds +
                        remainingSeconds * (state.staticScheduledRate / staticRate);
                }
            }
            state.staticScheduledRate = staticRate;
            while (state.staticNextEventDeadlineSeconds <= staticSampleEndSeconds) {
                staticEvent = true;
                const nextIntervalSeconds = staticIntervalSeconds(state, staticRate);
                const staticPhase = TWO_PI * nextStaticRandom(state);
                const staticAreaSeconds = STATIC_CARRIER_AREA_SECONDS * state.signalGain *
                    (0.5 + nextStaticRandom(state));
                const eventArea = staticAreaSeconds * state.sampleRate;
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

        let i = state.stationTuningGain * (stationI * tuningCosine - stationQ * tuningSine);
        let q = state.stationTuningGain * (stationI * tuningSine + stationQ * tuningCosine);
        i += interfererI + thermalI;
        q += interfererQ + thermalQ;
        if (staticEvent) {
            i += staticI;
            q += staticQ;
        }
        const radioGain = state.agcLinearGain * (1 + state.humAmount * hum);
        const ifOutputI = processBank(state.ifI, i * radioGain);
        const ifOutputQ = processBank(state.ifQ, q * radioGain);
        const ifEnvelope = Math.sqrt(ifOutputI * ifOutputI + ifOutputQ * ifOutputQ);
        const preAgcMagnitude = ifEnvelope * state.inverseAgcLinearGain;
        state.agcDetectorStage1 += state.agcDetectorAttackCoefficient *
            (preAgcMagnitude - state.agcDetectorStage1);
        const stage2Coefficient = state.agcDetectorStage1 > state.agcDetectorStage2 ?
            state.agcDetectorAttackCoefficient : state.agcDetectorReleaseCoefficient;
        state.agcDetectorStage2 += stage2Coefficient *
            (state.agcDetectorStage1 - state.agcDetectorStage2);
        state.lastIfEnvelope = ifEnvelope;

        const detectorTransitioning = state.detectorTransitionRemaining > 0;
        if (state.detector === 1 || (detectorTransitioning && state.detectorTarget === 1)) {
            stepSyncPll(state, ifOutputI, ifOutputQ);
        }
        let detected = runDetector(state, state.detector, state.detectorPrimary,
            ifOutputI, ifOutputQ);
        let detectorClipping = state.detectorPrimary.clipping;
        if (detectorTransitioning) {
            const nextDetected = runDetector(state, state.detectorTarget, state.detectorSecondary,
                ifOutputI, ifOutputQ);
            const progress = (state.detectorTransitionTotal -
                state.detectorTransitionRemaining) / state.detectorTransitionTotal;
            const blend = 0.5 - 0.5 * Math.cos(PI * progress);
            detected += blend * (nextDetected - detected);
            detectorClipping = detectorClipping || state.detectorSecondary.clipping;
            state.detectorTransitionRemaining--;
            if (state.detectorTransitionRemaining === 0) {
                const previousChain = state.detectorPrimary;
                state.detectorPrimary = state.detectorSecondary;
                state.detectorSecondary = previousChain;
                state.detector = state.detectorTarget;
            }
        }

        const receiverAudio = detected - state.dcPreviousInput +
            state.dcCoefficient * state.dcPreviousOutput;
        state.dcPreviousInput = detected;
        state.dcPreviousOutput = receiverAudio;
        let wet = (receiverAudio + state.humAmount * 0.2 * hum) * 1.4142135623730951;
        const currentSpeakerWet = processSpeakerPath(state.speaker, state.speakerHighPass,
            state.speakerPeak, state.speakerLowPass, wet);
        if (state.speakerTransitionRemaining > 0) {
            const nextSpeakerWet = processSpeakerPath(state.speakerTarget,
                state.nextSpeakerHighPass, state.nextSpeakerPeak,
                state.nextSpeakerLowPass, wet);
            const progress = (state.speakerTransitionTotal -
                state.speakerTransitionRemaining) / state.speakerTransitionTotal;
            const blend = 0.5 - 0.5 * Math.cos(PI * progress);
            wet = currentSpeakerWet + blend * (nextSpeakerWet - currentSpeakerWet);
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
            wet = currentSpeakerWet;
        }
        wet *= state.outputGain;

        data[leftIndex] = state.dryMix * inputLeft + state.mix * wet;
        if (pairChannels === 2) {
            data[rightIndex] = state.dryMix * inputRight + state.mix * wet;
        }

        const pathI = state.groundGain + state.skyGain * (state.fade1.i + state.fade2.i);
        const pathQ = state.skyGain * (state.fade1.q + state.fade2.q);
        const pathMagnitude = Math.sqrt(pathI * pathI + pathQ * pathQ);
        let fadeDb = 20 * Math.log10(pathMagnitude > 1e-4 ? pathMagnitude : 1e-4);
        if (fadeDb < -80) fadeDb = -80;
        if (fadeDb > 6) fadeDb = 6;
        state.fadeDb = fadeDb;
        // Negative-peak (over-modulation) clipping is detector independent; the diagonal
        // clipping term only exists in the envelope detector.
        const clipNow = transmitted < 0 || detectorClipping;
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
        clipCount: state.clipCount
    };
    return data;
`;

let swRadioSimulatorInstanceSerial = 0;

class SWRadioSimulatorPlugin extends PluginBase {
    constructor() {
        super('SW Radio Simulator',
            'Physical shortwave transmission, ionospheric propagation, receiver, and speaker simulation');
        this.tb = 4.5;
        this.pe = 50;
        this.md = 90;
        this.cp = 6;
        this.sg = -15;
        this.sk = 55;
        this.fd = 0.5;
        this.ds = 1.4;
        this.st = 2;
        this.in = -47;
        this.io = 1;
        this.tn = 0;
        this.bw = 6;
        this.de = 'Envelope';
        this.ag = 'Fast';
        this.dt = 50;
        this.hm = -80;
        this.hz = '50';
        this.sp = 'Small';
        this.og = 0;
        this.mx = 100;
        this.fr = false;
        this.temporalCapability = 'must-process';
        this.executionState = { state: 'pending', reason: null };
        this.executionStateReceived = false;
        this.selectedTab = 'station';
        this.hudValues = {
            carrierPreAgcDb: -80,
            agcGainDb: 6.4,
            modPercent: 0,
            fadeDb: 0,
            staticRate: 0,
            clipRate: 0
        };
        this.lastCounters = null;
        this.lastCounterAt = 0;
        this.lastTelemetryAt = 0;
        this.bypassSince = 0;
        this.lastBypassAt = 0;
        this.hudCreatedAt = 0;
        this.eventFlashUntil = 0;
        this.animationFrameId = null;
        this.hudCanvas = null;
        this.hudVisible = true;
        this.hudGraphDispose = null;
        this.hudObserver = null;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspTelemetry = frame => this.handleDspTelemetry(frame);
        this.registerProcessor(SW_RADIO_SIMULATOR_REFERENCE_PROCESSOR);
    }

    getTemporalCapability() {
        return this.enabled !== false && this.mx > 0 ? 'must-process' : 'reset-on-resume';
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            tb: this.tb, pe: this.pe, md: this.md, cp: this.cp,
            sg: this.sg, sk: this.sk, fd: this.fd, ds: this.ds, st: this.st,
            in: this.in, io: this.io,
            tn: this.tn, bw: this.bw, de: this.de, ag: this.ag, dt: this.dt,
            hm: this.hm, hz: this.hz,
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
        setNumber('fd', 0.1, 10);
        setNumber('ds', 0.2, 8);
        setNumber('st', 0, 100);
        setNumber('in', -80, 0);
        setNumber('io', 0.1, 10);
        setNumber('tn', -5, 5);
        setNumber('bw', 2, 10);
        setNumber('dt', 20, 500);
        setNumber('hm', -80, -20);
        setNumber('og', -24, 24);
        setNumber('mx', 0, 100);
        if (params.de !== undefined) {
            this.de = this.isAllowedEnum(params.de, ['Envelope', 'Synchronous'], this.de);
        }
        if (params.ag !== undefined) {
            this.ag = this.isAllowedEnum(params.ag, ['Slow', 'Mid', 'Fast'], this.ag);
        }
        if (params.hz !== undefined) this.hz = String(params.hz) === '60' ? '60' : '50';
        if (params.sp !== undefined) {
            this.sp = this.isAllowedEnum(params.sp, ['Off', 'Small', 'Table'], this.sp);
        }
        if (params.fr !== undefined) {
            this.fr = params.fr === true || params.fr === 1 || params.fr === 'true';
        }
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
        if (this._dspTelemetryUnsubscribe && hub === this._dspTelemetryHub &&
            tapId === this._dspTelemetryTapId) {
            return true;
        }
        this.disposeDspTelemetrySubscription();
        try {
            const unsubscribe = hub.subscribe(tapId, SW_RADIO_SIMULATOR_TAP_STATUS,
                this._boundDspTelemetry);
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
        if (frame?.frameType !== SW_RADIO_SIMULATOR_TAP_STATUS) return null;
        if (frame.formatVersion !== SW_RADIO_SIMULATOR_TELEMETRY_VERSION) return null;
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            typeof payload.getUint32 !== 'function' ||
            payload.byteLength !== SW_RADIO_SIMULATOR_TELEMETRY_BYTES) {
            return null;
        }
        const measurements = {
            carrierPreAgcDb: payload.getFloat32(0, true),
            agcGainDb: payload.getFloat32(4, true),
            modPercent: payload.getFloat32(8, true),
            fadeDb: payload.getFloat32(12, true),
            staticCount: payload.getUint32(16, true),
            clipCount: payload.getUint32(20, true)
        };
        const scalars = ['carrierPreAgcDb', 'agcGainDb', 'modPercent', 'fadeDb'];
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
            this.executionStateReceived = true;
            return;
        }
        if (message.type !== 'processBuffer' || message.pluginId !== this.id ||
            !message.measurements) return;
        if (message.measurements.bypass === true) {
            const now = performance.now();
            if (!this.bypassSince || this.lastTelemetryAt >= this.bypassSince) {
                this.bypassSince = now;
            }
            this.lastBypassAt = now;
            return;
        }
        if (Number.isFinite(message.measurements.carrierPreAgcDb)) {
            this._applyMeasurements(message.measurements);
        }
    }

    _applyMeasurements(measurements) {
        const now = performance.now();
        const scalarKeys = ['carrierPreAgcDb', 'agcGainDb', 'modPercent', 'fadeDb'];
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
            slider.value = current <= 0 ? '0' :
                String(1 + 999 * Math.log(current / floor) / Math.log(max / floor));
            number.value = current === 0 ? '0' : Number(current.toPrecision(4)).toString();
        };
        const fromSlider = position =>
            position <= 0 ? 0 : floor * Math.pow(max / floor, (position - 1) / 999);
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
        this.hudGraphDispose = null;
        this.hudCreatedAt = performance.now();
        this.hudVisible = true;
        const container = document.createElement('div');
        const instanceId = `sw-radio-simulator-${Date.now()}-${++swRadioSimulatorInstanceSerial}`;
        container.className = 'sw-radio-simulator-container';
        container.setAttribute('data-instance-id', instanceId);
        const panel = document.createElement('div');
        panel.className = 'sw-radio-simulator-panel';
        const tabs = document.createElement('div');
        tabs.className = 'sw-radio-simulator-tabs';
        tabs.setAttribute('role', 'tablist');
        const contents = document.createElement('div');
        contents.className = 'sw-radio-simulator-tab-contents';
        const definitions = [
            { id: 'station', label: 'Station', create: content => {
                content.appendChild(this.createParameterControl('TX Bandwidth', 2, 10, 0.1,
                    this.tb, value => this.setParameters({ tb: value }), 'kHz'));
                content.appendChild(this.createParameterControl('Pre-emphasis', 0, 100, 1,
                    this.pe, value => this.setParameters({ pe: value }), '%'));
                content.appendChild(this.createParameterControl('Mod Depth', 10, 125, 1,
                    this.md, value => this.setParameters({ md: value }), '%'));
                content.appendChild(this.createParameterControl('Compression', 0, 20, 0.1,
                    this.cp, value => this.setParameters({ cp: value }), 'dB'));
            } },
            { id: 'propagation', label: 'Propagation', create: content => {
                content.appendChild(this.createParameterControl('Signal', -50, 0, 0.1,
                    this.sg, value => this.setParameters({ sg: value }), 'dB'));
                content.appendChild(this.createParameterControl('Fading', 0, 100, 1,
                    this.sk, value => this.setParameters({ sk: value }), '%'));
                content.appendChild(this.createLogarithmicParameterControl('Fading Speed',
                    0.1, 10, 0.01, this.fd, value => this.setParameters({ fd: value }), 'Hz'));
                content.appendChild(this.createLogarithmicParameterControl('Delay Spread',
                    0.2, 8, 0.01, this.ds, value => this.setParameters({ ds: value }), 'ms'));
                content.appendChild(this._createZeroAwareLogControl('Static', 100, this.st,
                    value => this.setParameters({ st: value }), '/s'));
                content.appendChild(this.createParameterControl('Interference', -80, 0, 1,
                    this.in, value => this.setParameters({ in: value }), 'dB'));
                content.appendChild(this.createLogarithmicParameterControl('Interf. Offset',
                    0.1, 10, 0.01, this.io, value => this.setParameters({ io: value }), 'kHz'));
            } },
            { id: 'receiver', label: 'Receiver', create: content => {
                content.appendChild(this.createParameterControl('Tuning', -5, 5, 0.01,
                    this.tn, value => this.setParameters({ tn: value }), 'kHz'));
                content.appendChild(this.createParameterControl('IF Bandwidth', 2, 10, 0.1,
                    this.bw, value => this.setParameters({ bw: value }), 'kHz'));
                content.appendChild(this.createRadioGroup('Detector',
                    ['Envelope', 'Synchronous'], this.de,
                    value => this.setParameters({ de: value })));
                content.appendChild(this.createRadioGroup('AGC Speed', ['Slow', 'Mid', 'Fast'],
                    this.ag, value => this.setParameters({ ag: value })));
                content.appendChild(this.createLogarithmicParameterControl('Detector RC',
                    20, 500, 1, this.dt, value => this.setParameters({ dt: value }), 'µs'));
                content.appendChild(this.createParameterControl('Hum', -80, -20, 1,
                    this.hm, value => this.setParameters({ hm: value }), 'dB'));
                content.appendChild(this.createRadioGroup('Hum Freq', ['50', '60'], this.hz,
                    value => this.setParameters({ hz: value }), 'Hz'));
            } },
            { id: 'output', label: 'Output', create: content => {
                content.appendChild(this.createRadioGroup('Speaker', ['Small', 'Table', 'Off'],
                    this.sp, value => this.setParameters({ sp: value })));
                content.appendChild(this.createParameterControl('Output Gain', -24, 24, 0.1,
                    this.og, value => this.setParameters({ og: value }), 'dB'));
                content.appendChild(this.createParameterControl('Mix', 0, 100, 1,
                    this.mx, value => this.setParameters({ mx: value }), '%'));
            } }
        ];
        for (const definition of definitions) {
            const active = definition.id === this.selectedTab;
            const tab = document.createElement('button');
            const content = document.createElement('div');
            tab.type = 'button';
            tab.id = `${instanceId}-${definition.id}-tab`;
            tab.className = `sw-radio-simulator-tab ${active ? 'active' : ''}`;
            tab.textContent = definition.label;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.setAttribute('aria-controls', `${instanceId}-${definition.id}-panel`);
            content.id = `${instanceId}-${definition.id}-panel`;
            content.className =
                `sw-radio-simulator-tab-content plugin-parameter-ui ${active ? 'active' : ''}`;
            content.setAttribute('role', 'tabpanel');
            content.setAttribute('aria-labelledby', tab.id);
            content.hidden = !active;
            definition.create(content);
            tab.addEventListener('click', () => {
                tabs.querySelectorAll('.sw-radio-simulator-tab').forEach(item => {
                    const selected = item === tab;
                    item.classList.toggle('active', selected);
                    item.setAttribute('aria-selected', selected ? 'true' : 'false');
                });
                contents.querySelectorAll('.sw-radio-simulator-tab-content').forEach(item => {
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
            className: 'sw-radio-simulator-hud',
            onResize: () => this.drawHud()
        });
        this.hudGraphDispose = graph.dispose;
        this.hudCanvas = graph.canvas;
        this.hudCanvas.setAttribute('role', 'img');
        this.hudCanvas.setAttribute('aria-label', 'Shortwave radio receiver status');
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

    _hudMode(now) {
        if (this.enabled === false) return 'disabled';
        if (!this.canRunAnimation()) return 'paused';
        const streaming = this.lastTelemetryAt > 0 && now - this.lastTelemetryAt < 1200;
        if (this.executionStateReceived) {
            if (this.executionState.state === 'bypassed') return 'bypass';
            if (this.executionState.state === 'pending') return 'loading';
            return streaming ? 'active' : 'idle';
        }
        if (streaming) return 'active';
        if (now - this.hudCreatedAt < 1500) return 'loading';
        if (now - this.lastBypassAt < 700 && this.bypassSince &&
            now - this.bypassSince >= 350) return 'bypass';
        return 'idle';
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
        const now = performance.now();
        const mode = this._hudMode(now);
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#171717';
        context.fillRect(0, 0, width, height);
        if (mode !== 'active') {
            const messages = {
                disabled: ['Effect is off', ''],
                paused: ['Receiver display paused', ''],
                loading: ['Loading SW radio processing…', ''],
                idle: ['Waiting for audio', 'Start playback to view the receiver status.'],
                bypass: ['WASM is required',
                    'This effect is bypassed because its simulation engine is unavailable.']
            };
            const [title, detail] = messages[mode];
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillStyle = mode === 'bypass' ? '#ffbf69' :
                (mode === 'loading' ? '#9db7c7' : '#aaa');
            context.font = `600 ${Math.round(13 * scale)}px Arial`;
            context.fillText(title, width / 2, detail ? height * 0.42 : height / 2);
            if (detail) {
                context.fillStyle = '#aaa';
                context.font = `${Math.round(11 * scale)}px Arial`;
                context.fillText(detail, width / 2, height * 0.65);
            }
            return;
        }
        const values = this.hudValues;
        const narrow = cssWidth < 560;
        const columns = narrow ? 2 : 4;
        const rows = narrow ? 2 : 1;
        const padding = 6 * scale;
        const gap = 5 * scale;
        const cardWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
        const cardHeight = (height - padding * 2 - gap * (rows - 1)) / rows;
        let sLevel = (values.carrierPreAgcDb - SW_RADIO_SIMULATOR_S_METER_MINIMUM_DB) /
            (SW_RADIO_SIMULATOR_S_METER_MAXIMUM_DB -
                SW_RADIO_SIMULATOR_S_METER_MINIMUM_DB);
        if (sLevel < 0) sLevel = 0;
        else if (sLevel > 1) sLevel = 1;
        const sValue = 1 + 8 * sLevel;
        const eventActive = now < this.eventFlashUntil;
        const cards = [
            { title: 'S METER', value: `S${sValue.toFixed(1)}`, level: sLevel },
            { title: 'FADE', value: `${values.fadeDb.toFixed(1)} dB`,
                level: (values.fadeDb + 80) / 86 },
            { title: 'AGC GAIN',
                value: `${values.agcGainDb >= 0 ? '+' : ''}${values.agcGainDb.toFixed(1)} dB`,
                level: (values.agcGainDb - SW_RADIO_SIMULATOR_MINIMUM_AGC_GAIN_DB) /
                    (SW_RADIO_SIMULATOR_MAXIMUM_AGC_GAIN_DB -
                        SW_RADIO_SIMULATOR_MINIMUM_AGC_GAIN_DB) },
            { title: 'MOD / EVENTS',
                value: `${values.modPercent.toFixed(0)}%  ⚡${values.staticRate.toFixed(1)}  ▲${values.clipRate.toFixed(1)}`,
                level: values.modPercent / 160 }
        ];
        cards.forEach((card, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const x = padding + column * (cardWidth + gap);
            const y = padding + row * (cardHeight + gap);
            context.fillStyle = '#222';
            context.fillRect(x, y, cardWidth, cardHeight);
            context.strokeStyle = eventActive && index === 3 ? '#ffb347' : '#454545';
            context.strokeRect(x + 0.5 * scale, y + 0.5 * scale, cardWidth - scale,
                cardHeight - scale);
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
            context.fillRect(x + 6 * scale, y + cardHeight - 9 * scale,
                cardWidth - 12 * scale, 4 * scale);
            context.fillStyle = eventActive && index === 3 ? '#ffb347' : '#69c8ff';
            context.fillRect(x + 6 * scale, y + cardHeight - 9 * scale,
                (cardWidth - 12 * scale) * level, 4 * scale);
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
        super.cleanup();
    }
}

window.SWRadioSimulatorPlugin = SWRadioSimulatorPlugin;
