// FM Radio Simulator: physical FM broadcast transmission -> propagation -> reception chain.
// Runtime processing is WASM-only. This JS reference implementation is used offline
// for parity/golden generation via the hidden `fr` parameter and mirrors the C++ kernel
// (dsp/plugins/lofi/fm_radio_simulator/kernel.cpp):
// three-tier split-rate layout (host / MPX / RF core), Kaiser polyphase rational resamplers
// with the polyphase-shifted window, shared polynomial sincos/atan2, xorshift64 + Marsaglia
// polar noise, PLL pilot recovery, and the CNR stereo blend. Every f32 operation of the
// C++ kernel is mirrored with Math.fround so outputs match within the f32 parity tolerance.

const FM_RADIO_SIMULATOR_REFERENCE_PROCESSOR = `
    if (!parameters.fr || typeof context.__seededRandom !== 'function') {
        data.measurements = { bypass: true };
        return data;
    }
    if (!parameters.enabled || parameters.channelCount < 1 ||
        parameters.blockSize < 1 || parameters.sampleRate <= 0) return data;

    const F = Math.fround;
    const PI = 3.141592653589793;
    const HALF_PI = 0.5 * PI;
    const QUARTER_PI = 0.25 * PI;
    const TWO_PI = 2 * PI;
    const INV_TWO_PI = 1 / TWO_PI;
    const DC_CUT_HZ = 5;
    const PI_F = F(PI);
    const HALF_PI_F = F(HALF_PI);
    const QUARTER_PI_F = F(QUARTER_PI);
    const KAISER_BETA = 10.06126;
    const PEAK_LOOKAHEAD = 16;
    const MAX_FRAMES = 8192;
    const MASK_64 = (1n << 64n) - 1n;
    const FALLBACK_SEED = 0x00000000effe7a5en;
    const FLOAT32_SCALE = 4294967296;
    const FLOAT53 = 9007199254740992;
    const C045 = F(0.45);
    const C009 = F(0.09);
    const C098 = F(0.98);
    const C002 = F(0.02);
    const C001 = F(0.01);
    const C06 = F(0.6);
    const LOCK_KEEP = F(0.9995);
    const LOCK_GAIN = F(0.0005);
    const NOISE_SIGMA = F(0.0005);
    const INV09 = F(1 / F(0.9));
    const TAU50 = F(50.0e-6);
    const TAU75 = F(75.0e-6);
    const ATAN_KNEE = F(0.41421356237);
    const ATAN_TINY = F(1.0e-20);
    const MAG_FLOOR = F(1.0e-20);
    const RS_FLOOR = F(1.0e-12);
    const LN2_F = F(0.6931471805599453);
    const L3 = F(1 / 3), L5 = F(1 / 5), L7 = F(1 / 7), L9 = F(1 / 9);
    const A3 = F(-1 / 3), A5 = F(1 / 5), A7 = F(-1 / 7), A9 = F(1 / 9);
    const A11 = F(-1 / 11), A13 = F(1 / 13), A15 = F(-1 / 15);

    // { host: [mpx, core, hostMpxTaps, mpxCoreTaps] } rate table.
    const RATE_PLANS = {
        44100: [176400, 441000, 80, 80],
        48000: [192000, 480000, 80, 72],
        88200: [176400, 441000, 20, 80],
        96000: [192000, 480000, 20, 72],
        176400: [176400, 529200, 1, 80],
        192000: [192000, 576000, 1, 72],
        352800: [352800, 705600, 1, 80],
        384000: [384000, 768000, 1, 72]
    };

    // scipy.signal.ellip(10, 0.1, 90, 15000, fs=rate, output='sos'), identical to kernel.cpp.
    const ELLIPTIC_15K = {
        44100: [
            [0.0420168499, 0.0827391790, 0.0420168499, -0.359724107, 0.117568170],
            [1, 1.77649254, 1, 0.215642997, 0.442965361],
            [1, 1.56008794, 1, 0.693893110, 0.716853892],
            [1, 1.41631250, 1, 0.951321918, 0.872596049],
            [1, 1.35082567, 1, 1.07086568, 0.963422260]],
        48000: [
            [0.0237371392, 0.0463957353, 0.0237371392, -0.561249044, 0.156596567],
            [1, 1.67780479, 1, -0.0654565122, 0.438833606],
            [1, 1.38149779, 1, 0.388621814, 0.701349775],
            [1, 1.19259173, 1, 0.649333438, 0.862144622],
            [1, 1.10855418, 1, 0.770892315, 0.959948393]],
        88200: [
            [0.00102728240, 0.00177318967, 0.00102728240, -1.31148696, 0.461709853],
            [1, 0.563311146, 1, -1.19262368, 0.589658264],
            [1, -0.156858886, 1, -1.05149093, 0.748185648],
            [1, -0.472121084, 1, -0.956922291, 0.872835949],
            [1, -0.588921070, 1, -0.925263235, 0.961556600]],
        96000: [
            [0.000742915758, 0.00124027328, 0.000742915758, -1.37040948, 0.497175060],
            [1, 0.371350870, 1, -1.27779750, 0.614634718],
            [1, -0.356579649, 1, -1.16715097, 0.761998832],
            [1, -0.658921123, 1, -1.09394515, 0.879299104],
            [1, -0.768554389, 1, -1.07372117, 0.963462591]],
        176400: [
            [0.000133696875, 0.000130638214, 0.000133696875, -1.65958281, 0.698501825],
            [1, -0.894927144, 1, -1.66151762, 0.766168535],
            [1, -1.38171518, 1, -1.66617084, 0.853566587],
            [1, -1.53284740, 1, -1.67578578, 0.925150692],
            [1, -1.58226156, 1, -1.69530475, 0.977377415]],
        192000: [
            [0.000113042507, 0.0000945661520, 0.000113042507, -1.68696082, 0.720036924],
            [1, -1.03085256, 1, -1.69399297, 0.782914460],
            [1, -1.46875286, 1, -1.70492756, 0.864101112],
            [1, -1.60111928, 1, -1.71887314, 0.930571914],
            [1, -1.64403939, 1, -1.73978341, 0.979034722]],
        352800: [
            [0.0000495974835, -0.0000173955670, 0.0000495974835, -1.82813382, 0.838377059],
            [1, -1.66294730, 1, -1.84789634, 0.875297725],
            [1, -1.83115244, 1, -1.87373781, 0.922458291],
            [1, -1.87643921, 1, -1.89625585, 0.960638940],
            [1, -1.89063430, 1, -1.91591382, 0.988193035]],
        384000: [
            [0.0000462230629, -0.0000237570176, 0.0000462230629, -1.84190464, 0.850596011],
            [1, -1.71220565, 1, -1.86159253, 0.884822845],
            [1, -1.85678959, 1, -1.88720131, 0.928460121],
            [1, -1.89538801, 1, -1.90924978, 0.963720202],
            [1, -1.90745807, 1, -1.92802572, 0.989126265]]
    };

    const CAST_F32 = new Float32Array(1);
    const CAST_U32 = new Uint32Array(CAST_F32.buffer);
    const SINCOS = { sin: 0, cos: 0 };
    const COMPLEX = { real: 0, imag: 0 };

    function fastSinCos(phase) {
        while (phase > PI) phase -= TWO_PI;
        while (phase < -PI) phase += TWO_PI;
        const scaled = phase / HALF_PI;
        const quadrant = Math.trunc(scaled + (scaled >= 0 ? 0.5 : -0.5));
        const reduced = phase - quadrant * HALF_PI;
        const squared = reduced * reduced;
        const reducedSine = reduced *
            (1 + squared * (-1 / 6 + squared * (1 / 120 + squared * (-1 / 5040 +
                squared * (1 / 362880 + squared * (-1 / 39916800))))));
        const reducedCosine = 1 + squared * (-1 / 2 + squared * (1 / 24 +
            squared * (-1 / 720 + squared * (1 / 40320 + squared * (-1 / 3628800)))));
        switch (quadrant & 3) {
            case 0: SINCOS.sin = F(reducedSine); SINCOS.cos = F(reducedCosine); break;
            case 1: SINCOS.sin = F(reducedCosine); SINCOS.cos = F(-reducedSine); break;
            case 2: SINCOS.sin = F(-reducedSine); SINCOS.cos = F(-reducedCosine); break;
            default: SINCOS.sin = F(-reducedCosine); SINCOS.cos = F(reducedSine); break;
        }
    }

    function fastInverseSqrt(value) {
        CAST_F32[0] = value;
        CAST_U32[0] = 0x5f375a86 - (CAST_U32[0] >>> 1);
        let estimate = CAST_F32[0];
        const half = F(0.5 * value);
        estimate = F(estimate * F(1.5 - F(F(half * estimate) * estimate)));
        estimate = F(estimate * F(1.5 - F(F(half * estimate) * estimate)));
        return estimate;
    }

    function fastLog(value) {
        CAST_F32[0] = value;
        const bits = CAST_U32[0];
        const exponent = ((bits >>> 23) & 0xff) - 127;
        CAST_U32[0] = (bits & 0x007fffff) | 0x3f800000;
        const mantissa = CAST_F32[0];
        const y = F(F(mantissa - 1) / F(mantissa + 1));
        const squared = F(y * y);
        const series = F(y * F(1 + F(squared * F(L3 + F(squared * F(L5 +
            F(squared * F(L7 + F(squared * L9)))))))));
        return F(F(2 * series) + F(exponent * LN2_F));
    }

    function atanSmall(value) {
        const squared = F(value * value);
        let t = F(squared * A15);
        t = F(A13 + t); t = F(squared * t);
        t = F(A11 + t); t = F(squared * t);
        t = F(A9 + t); t = F(squared * t);
        t = F(A7 + t); t = F(squared * t);
        t = F(A5 + t); t = F(squared * t);
        t = F(A3 + t); t = F(squared * t);
        t = F(1 + t);
        return F(value * t);
    }

    function fastAtanUnit(value) {
        if (value > ATAN_KNEE) {
            return F(QUARTER_PI_F + atanSmall(F(F(value - 1) / F(value + 1))));
        }
        return atanSmall(value);
    }

    function fastAtan2(y, x) {
        const absoluteX = x < 0 ? -x : x;
        const absoluteY = y < 0 ? -y : y;
        if (F(absoluteX + absoluteY) < ATAN_TINY) return 0;
        let angle;
        if (absoluteX >= absoluteY) angle = fastAtanUnit(F(absoluteY / absoluteX));
        else angle = F(HALF_PI_F - fastAtanUnit(F(absoluteX / absoluteY)));
        if (x < 0) angle = F(PI_F - angle);
        return y < 0 ? -angle : angle;
    }

    function besselI0(value) {
        const half = value * 0.5;
        let sum = 1;
        let term = 1;
        for (let index = 1; index <= 24; index++) {
            term *= half / index;
            const addition = term * term;
            sum += addition;
            if (addition < sum * 1.0e-16) break;
        }
        return sum;
    }

    function normalizedSinc(value) {
        const absolute = value < 0 ? -value : value;
        return absolute < 1.0e-12 ? 1 : Math.sin(PI * value) / (PI * value);
    }

    function greatestCommonDivisor(a, b) {
        while (b !== 0) { const t = a % b; a = b; b = t; }
        return a;
    }

    function makeBiquad() { return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, s1: 0, s2: 0 }; }

    function processBiquad(filter, input) {
        const output = F(F(filter.b0 * input) + filter.s1);
        filter.s1 = F(F(F(filter.b1 * input) - F(filter.a1 * output)) + filter.s2);
        filter.s2 = F(F(filter.b2 * input) - F(filter.a2 * output));
        return output;
    }

    function makeCascade(rate) {
        const table = ELLIPTIC_15K[rate];
        const filters = [];
        for (let section = 0; section < 5; section++) {
            const filter = makeBiquad();
            filter.b0 = F(table[section][0]);
            filter.b1 = F(table[section][1]);
            filter.b2 = F(table[section][2]);
            filter.a1 = F(table[section][3]);
            filter.a2 = F(table[section][4]);
            filters.push(filter);
        }
        return filters;
    }

    function processCascade(filters, input) {
        let output = input;
        for (let index = 0; index < 5; index++) output = processBiquad(filters[index], output);
        return output;
    }

    function configureLowPass(filter, frequency, q, sampleRate) {
        const omega = TWO_PI * frequency / sampleRate;
        const cosine = Math.cos(omega);
        const sine = Math.sin(omega);
        const alpha = sine / (2 * q);
        const inverseA0 = 1 / (1 + alpha);
        const half = 0.5 * (1 - cosine);
        filter.b0 = F(half * inverseA0);
        filter.b1 = F((1 - cosine) * inverseA0);
        filter.b2 = F(half * inverseA0);
        filter.a1 = F(-2 * cosine * inverseA0);
        filter.a2 = F((1 - alpha) * inverseA0);
    }

    function makeResampler(channels) {
        return {
            channels, interpolation: 1, decimation: 1, tapsPerPhase: 1,
            coefficients: new Float32Array(1), rings: [],
            ringPosition: 0, inputIndex: 0, outputIndex: 0
        };
    }

    function configureResampler(resampler, inputRate, outputRate, passHz, totalTaps) {
        const divisor = greatestCommonDivisor(inputRate, outputRate);
        resampler.interpolation = outputRate / divisor;
        resampler.decimation = inputRate / divisor;
        resampler.ringPosition = 0;
        resampler.inputIndex = 0;
        resampler.outputIndex = 0;
        if (resampler.interpolation === 1 && resampler.decimation === 1) {
            resampler.tapsPerPhase = 1;
            resampler.coefficients = Float32Array.of(1);
            resampler.rings = [];
            for (let channel = 0; channel < resampler.channels; channel++) {
                resampler.rings.push(new Float32Array(1));
            }
            return;
        }
        let tapsPerPhase = Math.floor((totalTaps + resampler.interpolation - 1) /
            resampler.interpolation);
        if (tapsPerPhase < 2) tapsPerPhase = 2;
        resampler.tapsPerPhase = tapsPerPhase;
        resampler.coefficients = new Float32Array(resampler.interpolation * tapsPerPhase);
        resampler.rings = [];
        for (let channel = 0; channel < resampler.channels; channel++) {
            resampler.rings.push(new Float32Array(tapsPerPhase));
        }
        // Windowed-sinc cutoff at the middle of the designed transition band, and the Kaiser
        // window shifted by the polyphase fraction (kernel.cpp rationale comments).
        const lowerRate = inputRate < outputRate ? inputRate : outputRate;
        const stopHz = lowerRate - passHz;
        const cutoff = 0.5 * (passHz + stopHz) / inputRate;
        const delay = 0.5 * (tapsPerPhase - 1);
        const inverseI0 = 1 / besselI0(KAISER_BETA);
        for (let phase = 0; phase < resampler.interpolation; phase++) {
            const fraction = phase / resampler.interpolation;
            let sum = 0;
            for (let tap = 0; tap < tapsPerPhase; tap++) {
                const distance = fraction - delay + tap;
                const windowPosition = delay > 0 ? distance / delay : 0;
                let radicand = 1 - windowPosition * windowPosition;
                if (radicand < 0) radicand = 0;
                const window = besselI0(KAISER_BETA * Math.sqrt(radicand)) * inverseI0;
                const coefficient = 2 * cutoff * normalizedSinc(2 * cutoff * distance) * window;
                resampler.coefficients[phase * tapsPerPhase + tap] = coefficient;
                sum += coefficient;
            }
            if (sum !== 0) {
                const inverseSum = F(1 / sum);
                for (let tap = 0; tap < tapsPerPhase; tap++) {
                    const index = phase * tapsPerPhase + tap;
                    resampler.coefficients[index] = F(resampler.coefficients[index] * inverseSum);
                }
            }
        }
    }

    function processResampler(resampler, inputs, inputCount, outputs, outputCapacity) {
        if (resampler.interpolation === 1 && resampler.decimation === 1) {
            const count = inputCount < outputCapacity ? inputCount : outputCapacity;
            for (let channel = 0; channel < resampler.channels; channel++) {
                for (let index = 0; index < count; index++) {
                    outputs[channel][index] = inputs[channel][index];
                }
            }
            resampler.inputIndex += inputCount;
            resampler.outputIndex += count;
            return count;
        }
        let produced = 0;
        const taps = resampler.tapsPerPhase;
        for (let input = 0; input < inputCount; input++) {
            for (let channel = 0; channel < resampler.channels; channel++) {
                resampler.rings[channel][resampler.ringPosition] = inputs[channel][input];
            }
            while (Math.floor(resampler.outputIndex * resampler.decimation /
                resampler.interpolation) === resampler.inputIndex) {
                if (produced >= outputCapacity) return produced;
                const phase = (resampler.outputIndex * resampler.decimation) %
                    resampler.interpolation;
                const base = phase * taps;
                for (let channel = 0; channel < resampler.channels; channel++) {
                    const ring = resampler.rings[channel];
                    let sum = 0;
                    let readPosition = resampler.ringPosition;
                    for (let tap = 0; tap < taps; tap++) {
                        sum = F(sum + F(ring[readPosition] * resampler.coefficients[base + tap]));
                        readPosition = readPosition === 0 ? taps - 1 : readPosition - 1;
                    }
                    outputs[channel][produced] = sum;
                }
                produced++;
                resampler.outputIndex++;
            }
            resampler.ringPosition =
                resampler.ringPosition + 1 === taps ? 0 : resampler.ringPosition + 1;
            resampler.inputIndex++;
        }
        return produced;
    }

    function makeOscillator() { return { sine: 0, cosine: 1, stepSine: 0, stepCosine: 1, counter: 0 }; }

    function configureOscillator(oscillator, frequency, sampleRate) {
        const step = TWO_PI * frequency / sampleRate;
        oscillator.stepSine = Math.sin(step);
        oscillator.stepCosine = Math.cos(step);
    }

    function advanceOscillator(oscillator) {
        const nextSine = oscillator.sine * oscillator.stepCosine +
            oscillator.cosine * oscillator.stepSine;
        const nextCosine = oscillator.cosine * oscillator.stepCosine -
            oscillator.sine * oscillator.stepSine;
        oscillator.sine = nextSine;
        oscillator.cosine = nextCosine;
        oscillator.counter = (oscillator.counter + 1) >>> 0;
        if ((oscillator.counter & 0xffff) === 0) {
            const normSquared = oscillator.sine * oscillator.sine +
                oscillator.cosine * oscillator.cosine;
            const correction = 1.5 - 0.5 * normSquared;
            oscillator.sine *= correction;
            oscillator.cosine *= correction;
        }
    }

    function nextXorShift(value) {
        value ^= (value << 13n) & MASK_64;
        value ^= value >> 7n;
        value ^= (value << 17n) & MASK_64;
        return value & MASK_64;
    }

    function deriveNoiseSeed() {
        if (context.__fmRadioNoiseSeed !== undefined) return context.__fmRadioNoiseSeed;
        // Two derived 32-bit words; the WASM kernel mirrors this derivation from its own
        // master XorShiftRng so both engines share one deterministic noise stream.
        const low = BigInt(Math.floor(context.__seededRandom() * FLOAT32_SCALE));
        const high = BigInt(Math.floor(context.__seededRandom() * FLOAT32_SCALE));
        let seed = ((high << 32n) | low) & MASK_64;
        if (seed === 0n) seed = FALLBACK_SEED;
        context.__fmRadioNoiseSeed = seed;
        return seed;
    }

    function noiseNext(noise) {
        if (noise.hasSpare) {
            noise.hasSpare = false;
            return noise.spare;
        }
        let first, second, radiusSquared;
        do {
            noise.state = nextXorShift(noise.state);
            first = F(Number(noise.state >> 11n) / FLOAT53 * 2 - 1);
            noise.state = nextXorShift(noise.state);
            second = F(Number(noise.state >> 11n) / FLOAT53 * 2 - 1);
            radiusSquared = F(F(first * first) + F(second * second));
        } while (radiusSquared >= 1 || radiusSquared < RS_FLOOR);
        const magnitudeSquared = F(-2 * fastLog(radiusSquared));
        const magnitude = F(magnitudeSquared * fastInverseSqrt(magnitudeSquared));
        const multiplier = F(magnitude * fastInverseSqrt(radiusSquared));
        noise.spare = F(second * multiplier);
        noise.hasSpare = true;
        return F(first * multiplier);
    }

    function makePeak(mpxRate) {
        return {
            delay: new Float32Array(PEAK_LOOKAHEAD), position: 0, gain: 1,
            release: F(Math.exp(-1 / (0.050 * mpxRate)))
        };
    }

    function processPeak(peak, input) {
        peak.delay[peak.position] = input;
        let highest = 0;
        for (let index = 0; index < PEAK_LOOKAHEAD; index++) {
            const sample = peak.delay[index];
            const absolute = sample < 0 ? -sample : sample;
            if (absolute > highest) highest = absolute;
        }
        const target = highest > C098 ? F(C098 / highest) : 1;
        peak.gain = target < peak.gain ? target :
            F(F(peak.release * peak.gain) + F(F(1 - peak.release) * target));
        peak.position = peak.position + 1 === PEAK_LOOKAHEAD ? 0 : peak.position + 1;
        return F(peak.delay[peak.position] * peak.gain);
    }

    function processLimiter(state, input, limiter, drive, amount) {
        const driven = F(input * drive);
        const absolute = driven < 0 ? -driven : driven;
        limiter.envelope = absolute > limiter.envelope ? absolute :
            F(state.limiterRelease * limiter.envelope);
        const target = limiter.envelope > C098 ? F(C098 / limiter.envelope) : 1;
        limiter.gain = target < limiter.gain ? target :
            F(F(state.limiterRelease * limiter.gain) + F(F(1 - state.limiterRelease) * target));
        const limited = F(driven * limiter.gain);
        const cubic = F(F(limited * limited) * limited);
        return F(limited - F(F(C002 * amount) * cubic));
    }

    function processPreEmphasis(state, input, filter) {
        const output = F(F(input - F(state.deCoefficient * filter.previousInput)) *
            state.preInverse);
        filter.previousInput = input;
        return output;
    }

    function processDeEmphasis(state, input, filter) {
        const output = F(F(F(1 - state.deCoefficient) * input) +
            F(state.deCoefficient * filter.previousOutput));
        filter.previousOutput = output;
        return output;
    }

    function processDcCut(state, input, filter) {
        const output = F(F(input - filter.previousInput) +
            F(state.dcCoefficient * filter.previousOutput));
        filter.previousInput = input;
        filter.previousOutput = output;
        return output;
    }

    function createState(sampleRate) {
        const plan = RATE_PLANS[Math.floor(sampleRate + 0.5)];
        if (!plan) return null;
        const host = Math.floor(sampleRate + 0.5);
        const mpx = plan[0];
        const core = plan[1];
        const hostMpxTaps = plan[2];
        const mpxCoreTaps = plan[3];
        const mpxCapacity = Math.floor(MAX_FRAMES * mpx / host) + 8;
        const coreCapacity = MAX_FRAMES * 10 + 32;
        const state = {
            sampleRate, hostRate: host, mpxRate: mpx, coreRate: core,
            hostInputLeft: makeCascade(host), hostInputRight: makeCascade(host),
            txFinalLeft: makeCascade(mpx), txFinalRight: makeCascade(mpx),
            rxSum: makeCascade(mpx), rxDifference: makeCascade(mpx),
            ifReal: [makeBiquad(), makeBiquad(), makeBiquad(), makeBiquad()],
            ifImag: [makeBiquad(), makeBiquad(), makeBiquad(), makeBiquad()],
            preLeft: { previousInput: 0 }, preRight: { previousInput: 0 },
            deLeft: { previousOutput: 0 }, deRight: { previousOutput: 0 },
            dcLeft: { previousInput: 0, previousOutput: 0 },
            dcRight: { previousInput: 0, previousOutput: 0 },
            limiterLeft: { envelope: 0, gain: 1 }, limiterRight: { envelope: 0, gain: 1 },
            peakLeft: makePeak(mpx), peakRight: makePeak(mpx),
            hostToMpx: makeResampler(2), mpxToHost: makeResampler(2),
            mpxToCore: makeResampler(1), coreToMpx: makeResampler(1),
            pilotTx: makeOscillator(), pilotRx: makeOscillator(),
            tuning: makeOscillator(), fadingFirst: makeOscillator(), fadingSecond: makeOscillator(),
            noise: { state: deriveNoiseSeed(), hasSpare: false, spare: 0 },
            hostLeft: new Float32Array(MAX_FRAMES), hostRight: new Float32Array(MAX_FRAMES),
            dryBlockLeft: new Float32Array(MAX_FRAMES), dryBlockRight: new Float32Array(MAX_FRAMES),
            wetLeft: new Float32Array(MAX_FRAMES + 8), wetRight: new Float32Array(MAX_FRAMES + 8),
            txLeft: new Float32Array(mpxCapacity), txRight: new Float32Array(mpxCapacity),
            rxLeft: new Float32Array(mpxCapacity), rxRight: new Float32Array(mpxCapacity),
            txMpx: new Float32Array(mpxCapacity), rxMpx: new Float32Array(mpxCapacity),
            coreInput: new Float32Array(coreCapacity), coreOutput: new Float32Array(coreCapacity),
            multipathReal: null, multipathImag: null, multipathSize: 0, multipathPosition: 0,
            previousLimitedReal: 1, previousLimitedImag: 0,
            fmPhase: 0, pllIntegrator: 0, pllLock: 0,
            pllKp: 0, pllKi: 0, pilotBaseSine: 0, pilotBaseCosine: 1,
            dryLeft: null, dryRight: null, drySize: 0, dryPosition: 0, latencySamples: 0,
            controlsConfigured: false, lastParams: null,
            emphasisTau: TAU50, deCoefficient: 0, preInverse: 1,
            dcCoefficient: F(Math.exp(-TWO_PI * DC_CUT_HZ / host)),
            processingAmountTarget: 0, processingDriveTarget: 1, limiterRelease: F(0.999),
            signalAmplitudeTarget: 1, tuningKhz: 0, ifBandKhz: F(230),
            multipathTarget: 0, pathDelayTargetUs: F(5), fadingHz: 0, stereoMode: 0,
            outputGainTarget: 1, mixTarget: 1, cnrBlend: 1, demodScale: 1,
            // Control ramps (20 ms), mirroring kernel.cpp bit for bit:
            // f64 current values with f32-rounded one-pole coefficients, plus the
            // tuning NCO step-phasor ramp state.
            controlAlphaHost: F(1 - Math.exp(-1 / (0.020 * host))),
            controlAlphaMpx: F(1 - Math.exp(-1 / (0.020 * mpx))),
            controlAlphaCore: F(1 - Math.exp(-1 / (0.020 * core))),
            processingAmountCurrent: 0, processingDriveCurrent: 1,
            signalAmplitudeCurrent: 1,
            multipathCurrent: 0, pathDelayCurrentUs: 5,
            outputGainCurrent: 1, mixCurrent: 1,
            tuningCurrentKhz: 0, tuningRampStepKhz: 0,
            tuningStepDeltaSine: 0, tuningStepDeltaCosine: 1,
            tuningTargetStepSine: 0, tuningTargetStepCosine: 1,
            tuningRampSamples: Math.floor(0.020 * core + 0.5),
            tuningRampRemaining: 0
        };
        configureResampler(state.hostToMpx, host, mpx, 15000, hostMpxTaps);
        configureResampler(state.mpxToHost, mpx, host, 15000, hostMpxTaps);
        configureResampler(state.mpxToCore, mpx, core, 53000, mpxCoreTaps);
        configureResampler(state.coreToMpx, core, mpx, 53000, mpxCoreTaps);
        state.multipathSize = Math.ceil(50.0e-6 * 2.7 * 768000) + 8;
        state.multipathReal = new Float32Array(state.multipathSize);
        state.multipathImag = new Float32Array(state.multipathSize);
        // The 16-slot peak controller ring delays by PEAK_LOOKAHEAD - 1 samples
        // (write, advance, read), matching kernel.cpp's latency report.
        const latencySeconds =
            (0.5 * (state.hostToMpx.tapsPerPhase - 1)) / host +
            (PEAK_LOOKAHEAD - 1 + 0.5 * (state.mpxToCore.tapsPerPhase - 1)) / mpx +
            (0.5 * (state.coreToMpx.tapsPerPhase - 1)) / core +
            (0.5 * (state.mpxToHost.tapsPerPhase - 1)) / mpx;
        state.latencySamples = Math.ceil(latencySeconds * host);
        state.drySize = state.latencySamples + 1;
        state.dryLeft = new Float32Array(state.drySize);
        state.dryRight = new Float32Array(state.drySize);
        return state;
    }

    function configureControls(state, p) {
        state.emphasisTau = p.em >= 0.5 ? TAU75 : TAU50;
        state.deCoefficient = F(Math.exp(-1 / (state.hostRate * state.emphasisTau)));
        state.preInverse = F(1 / F(1 - state.deCoefficient));
        state.processingAmountTarget = F(p.pr / 18);
        state.processingDriveTarget = F(Math.pow(10, F(p.pr / 20)));
        state.limiterRelease = F(Math.exp(-1 / (0.050 * state.mpxRate)));
        // Radio off models the transmitter going dark: the RF carrier amplitude is
        // zeroed, so the receiver only picks up its own thermal noise and the
        // limiter/discriminator chain turns it into full-scale FM hiss.
        state.signalAmplitudeTarget = p.rd ? F(Math.pow(10, F(F(p.st - 60) / 20))) : 0;
        const ifBandChanged = !state.controlsConfigured || state.ifBandKhz !== p.bw;
        state.ifBandKhz = p.bw;
        state.multipathTarget = F(p.mp * C001);
        state.pathDelayTargetUs = p.dl;
        state.fadingHz = p.fd;
        state.stereoMode = p.sm;
        state.outputGainTarget = F(Math.pow(10, F(p.og / 20)));
        state.mixTarget = F(p.mx * C001);
        // Control-ramp contract: the first configuration after state creation snaps
        // the ramped controls; later changes only move the targets (kernel.cpp).
        if (!state.controlsConfigured) {
            state.processingAmountCurrent = state.processingAmountTarget;
            state.processingDriveCurrent = state.processingDriveTarget;
            state.signalAmplitudeCurrent = state.signalAmplitudeTarget;
            state.multipathCurrent = state.multipathTarget;
            state.pathDelayCurrentUs = state.pathDelayTargetUs;
            state.outputGainCurrent = state.outputGainTarget;
            state.mixCurrent = state.mixTarget;
        }
        // Coefficient update only: IF filter state is never cleared by parameter
        // changes; a bw change keeps the TDF2 states (kernel.cpp contract).
        if (ifBandChanged) {
            const q8 = [0.5097955791, 0.6013448869, 0.8999762231, 2.5629154477];
            const cutoff = 500 * state.ifBandKhz;
            for (let index = 0; index < 4; index++) {
                configureLowPass(state.ifReal[index], cutoff, q8[index], state.coreRate);
                configureLowPass(state.ifImag[index], cutoff, q8[index], state.coreRate);
            }
        }
        configureOscillator(state.pilotTx, 19000, state.mpxRate);
        configureOscillator(state.pilotRx, 19000, state.mpxRate);
        state.pilotBaseSine = state.pilotRx.stepSine;
        state.pilotBaseCosine = state.pilotRx.stepCosine;
        // Tuning ramp (kernel.cpp): a tn change never touches oscillator phase,
        // IF state, or the PLL; the NCO step phasor rotates by a constant
        // per-sample delta over a 20 ms linear ramp, then snaps to the target.
        if (!state.controlsConfigured) {
            state.tuningKhz = p.tn;
            state.tuningCurrentKhz = p.tn;
            state.tuningRampRemaining = 0;
            configureOscillator(state.tuning, -1000 * p.tn, state.coreRate);
        } else if (p.tn !== state.tuningKhz) {
            state.tuningKhz = p.tn;
            const samples = state.tuningRampSamples > 0 ? state.tuningRampSamples : 1;
            state.tuningRampStepKhz = (p.tn - state.tuningCurrentKhz) / samples;
            const deltaStep = TWO_PI * (-1000 * state.tuningRampStepKhz) / state.coreRate;
            state.tuningStepDeltaSine = Math.sin(deltaStep);
            state.tuningStepDeltaCosine = Math.cos(deltaStep);
            const targetStep = TWO_PI * (-1000 * p.tn) / state.coreRate;
            state.tuningTargetStepSine = Math.sin(targetStep);
            state.tuningTargetStepCosine = Math.cos(targetStep);
            state.tuningRampRemaining = samples;
        }
        configureOscillator(state.fadingFirst, state.fadingHz, state.coreRate);
        configureOscillator(state.fadingSecond, -1.61803398875 * state.fadingHz, state.coreRate);
        const natural = TWO_PI * 35 / state.mpxRate;
        state.pllKp = 1.4 * natural;
        state.pllKi = natural * natural;
        // Auto stereo blend CNR term: fixed physical noise floor
        // gives CNR ~= st + 5.6 dB at IF 230 kHz; smoothstep 18 dB (mono) .. 36 dB (stereo).
        // Off the air there is no carrier and no pilot, so the CNR term collapses
        // and Auto lands on mono the way a receiver does on a dead channel.
        const cnrDb = p.st + 5.6 + 10 * Math.log10(230 / state.ifBandKhz);
        let position = p.rd ? (cnrDb - 18) / (36 - 18) : 0;
        if (position < 0) position = 0; else if (position > 1) position = 1;
        state.cnrBlend = F(position * position * (3 - 2 * position));
        state.demodScale = F(state.coreRate * INV_TWO_PI / 75000);
        state.controlsConfigured = true;
    }

    function readMultipath(state, delaySamples) {
        const size = state.multipathSize;
        let read = state.multipathPosition - delaySamples;
        while (read < 0) read += size;
        const first = Math.trunc(read) % size;
        const second = first + 1 === size ? 0 : first + 1;
        const fraction = F(read - first);
        COMPLEX.real = F(state.multipathReal[first] +
            F(fraction * F(state.multipathReal[second] - state.multipathReal[first])));
        COMPLEX.imag = F(state.multipathImag[first] +
            F(fraction * F(state.multipathImag[second] - state.multipathImag[first])));
    }

    function processCore(state, mpx) {
        // Smooth control tracking (kernel.cpp): mp/dl 20 ms one-pole at the
        // core rate, and the pending tuning NCO step-phasor ramp.
        state.multipathCurrent += state.controlAlphaCore *
            (state.multipathTarget - state.multipathCurrent);
        state.pathDelayCurrentUs += state.controlAlphaCore *
            (state.pathDelayTargetUs - state.pathDelayCurrentUs);
        state.signalAmplitudeCurrent += state.controlAlphaCore *
            (state.signalAmplitudeTarget - state.signalAmplitudeCurrent);
        const multipathAmount = F(state.multipathCurrent);
        if (state.tuningRampRemaining > 0) {
            state.tuningRampRemaining--;
            if (state.tuningRampRemaining === 0) {
                state.tuning.stepSine = state.tuningTargetStepSine;
                state.tuning.stepCosine = state.tuningTargetStepCosine;
                state.tuningCurrentKhz = state.tuningKhz;
            } else {
                const nextStepSine = state.tuning.stepSine * state.tuningStepDeltaCosine +
                    state.tuning.stepCosine * state.tuningStepDeltaSine;
                const nextStepCosine = state.tuning.stepCosine * state.tuningStepDeltaCosine -
                    state.tuning.stepSine * state.tuningStepDeltaSine;
                state.tuning.stepSine = nextStepSine;
                state.tuning.stepCosine = nextStepCosine;
                state.tuningCurrentKhz += state.tuningRampStepKhz;
            }
        }
        state.fmPhase += TWO_PI * 75000 * mpx / state.coreRate;
        if (state.fmPhase > PI) state.fmPhase -= TWO_PI;
        else if (state.fmPhase < -PI) state.fmPhase += TWO_PI;
        fastSinCos(state.fmPhase);
        let real = SINCOS.cos;
        let imag = SINCOS.sin;
        state.multipathReal[state.multipathPosition] = real;
        state.multipathImag[state.multipathPosition] = imag;
        const firstDelay = state.pathDelayCurrentUs * 1.0e-6 * state.coreRate;
        readMultipath(state, firstDelay);
        const firstReal = COMPLEX.real, firstImag = COMPLEX.imag;
        readMultipath(state, 2.7 * firstDelay);
        const secondReal = COMPLEX.real, secondImag = COMPLEX.imag;
        const fadeFirstSine = F(state.fadingFirst.sine);
        const fadeFirstCosine = F(state.fadingFirst.cosine);
        real = F(real + F(multipathAmount *
            F(F(firstReal * fadeFirstCosine) - F(firstImag * fadeFirstSine))));
        imag = F(imag + F(multipathAmount *
            F(F(firstReal * fadeFirstSine) + F(firstImag * fadeFirstCosine))));
        const fadeSecondSine = F(state.fadingSecond.sine);
        const fadeSecondCosine = F(state.fadingSecond.cosine);
        const secondAmount = F(C06 * multipathAmount);
        real = F(real + F(secondAmount *
            F(F(secondReal * fadeSecondCosine) - F(secondImag * fadeSecondSine))));
        imag = F(imag + F(secondAmount *
            F(F(secondReal * fadeSecondSine) + F(secondImag * fadeSecondCosine))));
        advanceOscillator(state.fadingFirst);
        advanceOscillator(state.fadingSecond);
        state.multipathPosition = state.multipathPosition + 1 === state.multipathSize ?
            0 : state.multipathPosition + 1;

        const signalAmplitude = F(state.signalAmplitudeCurrent);
        real = F(real * signalAmplitude);
        imag = F(imag * signalAmplitude);
        real = F(real + F(NOISE_SIGMA * noiseNext(state.noise)));
        imag = F(imag + F(NOISE_SIGMA * noiseNext(state.noise)));
        const tuneSine = F(state.tuning.sine);
        const tuneCosine = F(state.tuning.cosine);
        const tunedReal = F(F(real * tuneCosine) - F(imag * tuneSine));
        const tunedImag = F(F(real * tuneSine) + F(imag * tuneCosine));
        advanceOscillator(state.tuning);
        real = tunedReal;
        imag = tunedImag;
        for (let index = 0; index < 4; index++) {
            real = processBiquad(state.ifReal[index], real);
            imag = processBiquad(state.ifImag[index], imag);
        }
        let magnitudeSquared = F(F(real * real) + F(imag * imag));
        if (magnitudeSquared < MAG_FLOOR) magnitudeSquared = MAG_FLOOR;
        const inverseMagnitude = fastInverseSqrt(magnitudeSquared);
        real = F(real * inverseMagnitude);
        imag = F(imag * inverseMagnitude);
        const cross = F(F(imag * state.previousLimitedReal) -
            F(real * state.previousLimitedImag));
        const dot = F(F(real * state.previousLimitedReal) +
            F(imag * state.previousLimitedImag));
        state.previousLimitedReal = real;
        state.previousLimitedImag = imag;
        return F(fastAtan2(cross, dot) * state.demodScale);
    }

    let state = context.fmRadioSimulator;
    if (!state || state.sampleRate !== parameters.sampleRate) {
        state = createState(parameters.sampleRate);
        context.fmRadioSimulator = state;
    }
    const frameCount = parameters.blockSize;
    if (!state || frameCount > MAX_FRAMES) {
        data.measurements = { bypass: true };
        return data;
    }
    const pairChannels = parameters.channelCount >= 2 ? 2 : 1;
    // The kernel receives this bool packed as a float and tests it against 0.5,
    // so mirror that threshold here instead of a plain truthiness check. Number()
    // maps true/false to 1/0, keeping the two engines on the same branch.
    const radioEnabled = parameters.rd === undefined ? 1 : (Number(parameters.rd) >= 0.5 ? 1 : 0);
    const p = {
        rd: radioEnabled,
        em: parameters.em === '75' ? 1 : 0,
        pr: F(parameters.pr), st: F(parameters.st), tn: F(parameters.tn),
        bw: F(parameters.bw), mp: F(parameters.mp), dl: F(parameters.dl),
        fd: F(parameters.fd),
        sm: parameters.sm === 'Stereo' ? 1 : (parameters.sm === 'Mono' ? 2 : 0),
        og: F(parameters.og), mx: F(parameters.mx)
    };
    const last = state.lastParams;
    if (!state.controlsConfigured || !last || last.rd !== p.rd ||
        last.em !== p.em || last.pr !== p.pr || last.st !== p.st || last.tn !== p.tn ||
        last.bw !== p.bw || last.mp !== p.mp || last.dl !== p.dl || last.fd !== p.fd ||
        last.sm !== p.sm || last.og !== p.og || last.mx !== p.mx) {
        configureControls(state, p);
        state.lastParams = p;
    }

    for (let frame = 0; frame < frameCount; frame++) {
        const inputLeft = data[frame];
        const inputRight = pairChannels === 2 ? data[frameCount + frame] : data[frame];
        state.dryBlockLeft[frame] = inputLeft;
        state.dryBlockRight[frame] = inputRight;
        state.hostLeft[frame] = processPreEmphasis(state,
            processCascade(state.hostInputLeft, inputLeft), state.preLeft);
        state.hostRight[frame] = processPreEmphasis(state,
            processCascade(state.hostInputRight, inputRight), state.preRight);
    }

    const mpxCount = processResampler(state.hostToMpx,
        [state.hostLeft, state.hostRight], frameCount,
        [state.txLeft, state.txRight], state.txLeft.length);
    for (let index = 0; index < mpxCount; index++) {
        // Smooth control tracking (kernel.cpp): pr drive/amount 20 ms
        // one-pole at the MPX rate (f32-rounded coefficient, f64 ramp state).
        state.processingDriveCurrent += state.controlAlphaMpx *
            (state.processingDriveTarget - state.processingDriveCurrent);
        state.processingAmountCurrent += state.controlAlphaMpx *
            (state.processingAmountTarget - state.processingAmountCurrent);
        const processingDrive = F(state.processingDriveCurrent);
        const processingAmount = F(state.processingAmountCurrent);
        let left = processLimiter(state, state.txLeft[index], state.limiterLeft,
            processingDrive, processingAmount);
        let right = processLimiter(state, state.txRight[index], state.limiterRight,
            processingDrive, processingAmount);
        left = processPeak(state.peakLeft, processCascade(state.txFinalLeft, left));
        right = processPeak(state.peakRight, processCascade(state.txFinalRight, right));
        const sum = F(left + right);
        const difference = F(left - right);
        const subcarrier = F(2 * state.pilotTx.sine * state.pilotTx.cosine);
        state.txMpx[index] = F(F(F(C045 * sum) + F(F(C045 * difference) * subcarrier)) +
            F(C009 * F(state.pilotTx.sine)));
        advanceOscillator(state.pilotTx);
    }

    const coreCount = processResampler(state.mpxToCore, [state.txMpx], mpxCount,
        [state.coreInput], state.coreInput.length);
    for (let index = 0; index < coreCount; index++) {
        state.coreOutput[index] = processCore(state, state.coreInput[index]);
    }
    const recoveredCount = processResampler(state.coreToMpx, [state.coreOutput], coreCount,
        [state.rxMpx], state.rxMpx.length);

    for (let index = 0; index < recoveredCount; index++) {
        const mpx = state.rxMpx[index];
        const pilot = state.pilotRx;
        const phaseError = mpx * pilot.cosine;
        state.pllIntegrator += state.pllKi * phaseError;
        let correction = state.pllIntegrator + state.pllKp * phaseError;
        if (correction > 0.002) correction = 0.002;
        else if (correction < -0.002) correction = -0.002;
        pilot.stepSine = state.pilotBaseSine + correction * state.pilotBaseCosine;
        pilot.stepCosine = state.pilotBaseCosine - correction * state.pilotBaseSine;
        const inPhase = F(mpx * pilot.sine);
        state.pllLock = F(F(LOCK_KEEP * state.pllLock) +
            F(LOCK_GAIN * (inPhase < 0 ? -inPhase : inPhase)));
        const sum = processCascade(state.rxSum, mpx);
        const carrier = F(2 * pilot.sine * pilot.cosine);
        let difference = processCascade(state.rxDifference, F(F(2 * mpx) * carrier));
        if (state.stereoMode === 2) {
            difference = 0;
        } else if (state.stereoMode === 0) {
            let blend = F(state.pllLock * 24);
            if (blend > 1) blend = 1;
            difference = F(difference * F(blend * state.cnrBlend));
        }
        state.rxLeft[index] = F(F(sum + difference) * INV09);
        state.rxRight[index] = F(F(sum - difference) * INV09);
        advanceOscillator(pilot);
    }

    const hostCount = processResampler(state.mpxToHost,
        [state.rxLeft, state.rxRight], recoveredCount,
        [state.wetLeft, state.wetRight], state.wetLeft.length);

    for (let frame = 0; frame < frameCount; frame++) {
        // Smooth control tracking (kernel.cpp): og/mx 20 ms one-pole at the
        // host rate.
        state.outputGainCurrent += state.controlAlphaHost *
            (state.outputGainTarget - state.outputGainCurrent);
        state.mixCurrent += state.controlAlphaHost *
            (state.mixTarget - state.mixCurrent);
        const outputGain = F(state.outputGainCurrent);
        const mix = F(state.mixCurrent);
        state.dryLeft[state.dryPosition] = state.dryBlockLeft[frame];
        state.dryRight[state.dryPosition] = state.dryBlockRight[frame];
        const dryRead = state.dryPosition + 1 === state.drySize ? 0 : state.dryPosition + 1;
        const delayedLeft = state.dryLeft[dryRead];
        const delayedRight = state.dryRight[dryRead];
        let left = frame < hostCount ? state.wetLeft[frame] : 0;
        let right = frame < hostCount ? state.wetRight[frame] : left;
        left = F(processDcCut(state, processDeEmphasis(state, left, state.deLeft),
            state.dcLeft) * outputGain);
        right = F(processDcCut(state, processDeEmphasis(state, right, state.deRight),
            state.dcRight) * outputGain);
        left = F(delayedLeft + F(mix * F(left - delayedLeft)));
        right = F(delayedRight + F(mix * F(right - delayedRight)));
        data[frame] = left;
        if (pairChannels === 2) data[frameCount + frame] = right;
        state.dryPosition = state.dryPosition + 1 === state.drySize ? 0 : state.dryPosition + 1;
    }
    return data;
`;

// Telemetry contract (dsp/README.md registry + js/audio/telemetry-hub.js):
// frame type 16, format version 1, 216-byte payload = five float32 scalars
// (RF level dBuV, estimated CNR dB, pilot lock 0-1, stereo blend 0-1,
// multipath depth dB), one cumulative u32 click counter, then 48 float32
// recovered-MPX spectrum magnitudes in dBFS on a fixed log grid 300 Hz-60 kHz.
const FM_RADIO_SIMULATOR_TAP_STATUS = 16;
const FM_RADIO_SIMULATOR_TELEMETRY_VERSION = 1;
const FM_RADIO_SIMULATOR_TELEMETRY_BYTES = 216;
const FM_RADIO_SIMULATOR_SPECTRUM_BINS = 48;
const FM_RADIO_SIMULATOR_SPECTRUM_MIN_HZ = 300;
const FM_RADIO_SIMULATOR_SPECTRUM_MAX_HZ = 60000;
const FM_RADIO_SIMULATOR_SPECTRUM_FLOOR_DB = -100;

class FMRadioSimulatorPlugin extends PluginBase {
    constructor() {
        super('FM Radio Simulator', 'Physical FM broadcast transmission and reception simulation');

        // Radio on/off models the station transmitting or going off the air.
        this.rd = true;
        this.em = '50';
        // Processing defaults to 0 dB so that enabling the effect with default
        // parameters is loudness-neutral (only the reception character changes).
        this.pr = 0;
        this.st = 35;
        this.tn = 0;
        this.bw = 230;
        this.mp = 0;
        this.dl = 5;
        this.fd = 0;
        this.sm = 'Auto';
        this.og = 0;
        this.mx = 100;
        this.fr = false;

        this.temporalCapability = 'must-process';

        this.animationFrameId = null;
        this.hudCanvas = null;
        this.hudStatusElement = null;
        this.lastHudStatusMode = null;
        this.hudGraphDispose = null;
        this.hudObserver = null;
        this.hudVisible = true;
        this.hudCreatedAt = performance.now();
        this.lastTelemetryAt = 0;
        this.lastBypassAt = 0;
        this.bypassSince = 0;
        this.lastScalarAt = 0;
        this.lastCounterAt = 0;
        this.lastClickCount = null;
        this.hudValues = {
            rfLevelDb: 0, cnrDb: 0, pilotLock: 0, blendRatio: 0,
            multipathDb: -120, clickRate: 0,
            spectrumDb: new Float32Array(FM_RADIO_SIMULATOR_SPECTRUM_BINS)
                .fill(FM_RADIO_SIMULATOR_SPECTRUM_FLOOR_DB - 40)
        };

        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspFmTelemetry = frame => this.handleDspFmTelemetry(frame);

        this.registerProcessor(FM_RADIO_SIMULATOR_REFERENCE_PROCESSOR);
    }

    _setupMessageHandler() {
        super._setupMessageHandler();
        this.ensureDspTelemetrySubscription?.();
    }

    ensureDspTelemetrySubscription() {
        const hub = window.dspTelemetryHub;
        const tapId = this.id;
        const validTapId = Number.isInteger(tapId) && tapId >= 0 && tapId <= 0xffffffff;
        const validHub = hub && typeof hub.subscribe === 'function';
        if (!validTapId || !validHub) {
            if (this._dspTelemetryUnsubscribe &&
                (hub !== this._dspTelemetryHub || tapId !== this._dspTelemetryTapId)) {
                this.disposeDspTelemetrySubscription();
            }
            return false;
        }
        if (this._dspTelemetryUnsubscribe &&
            hub === this._dspTelemetryHub && tapId === this._dspTelemetryTapId) {
            return true;
        }

        this.disposeDspTelemetrySubscription();
        try {
            const unsubscribe = hub.subscribe(
                tapId,
                FM_RADIO_SIMULATOR_TAP_STATUS,
                this._boundDspFmTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, FM_RADIO_SIMULATOR_TAP_STATUS, this._boundDspFmTelemetry);
                return false;
            }
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
        if (frame?.frameType !== FM_RADIO_SIMULATOR_TAP_STATUS ||
            frame.formatVersion !== FM_RADIO_SIMULATOR_TELEMETRY_VERSION) {
            return null;
        }
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            typeof payload.getUint32 !== 'function' ||
            payload.byteLength !== FM_RADIO_SIMULATOR_TELEMETRY_BYTES) {
            return null;
        }
        const measurements = {
            rfLevelDb: payload.getFloat32(0, true),
            cnrDb: payload.getFloat32(4, true),
            pilotLock: payload.getFloat32(8, true),
            blendRatio: payload.getFloat32(12, true),
            multipathDb: payload.getFloat32(16, true),
            clickCount: payload.getUint32(20, true)
        };
        const scalarKeys = ['rfLevelDb', 'cnrDb', 'pilotLock', 'blendRatio', 'multipathDb'];
        if (scalarKeys.some(key => !Number.isFinite(measurements[key]))) return null;
        if (measurements.pilotLock < 0 || measurements.pilotLock > 1.0001 ||
            measurements.blendRatio < 0 || measurements.blendRatio > 1.0001) {
            return null;
        }
        const spectrumDb = new Float32Array(FM_RADIO_SIMULATOR_SPECTRUM_BINS);
        for (let bin = 0; bin < FM_RADIO_SIMULATOR_SPECTRUM_BINS; bin++) {
            const value = payload.getFloat32(24 + 4 * bin, true);
            if (!Number.isFinite(value)) return null;
            spectrumDb[bin] = value;
        }
        measurements.spectrumDb = spectrumDb;
        return measurements;
    }

    handleDspFmTelemetry(frame) {
        const measurements = this.parseDspTelemetryFrame(frame);
        if (measurements) this._applyTelemetryMeasurements(measurements);
    }

    _applyTelemetryMeasurements(measurements) {
        const now = performance.now();
        const values = this.hudValues;
        const scalarDt = this.lastScalarAt ? Math.min(1, (now - this.lastScalarAt) / 1000) : 1;
        const scalarAlpha = 1 - Math.exp(-scalarDt / 0.1);
        for (const key of ['rfLevelDb', 'cnrDb', 'pilotLock', 'blendRatio', 'multipathDb']) {
            values[key] += scalarAlpha * (measurements[key] - values[key]);
        }
        const spectrumAlpha = 1 - Math.exp(-scalarDt / 0.12);
        const spectrum = values.spectrumDb;
        const incoming = measurements.spectrumDb;
        for (let bin = 0; bin < FM_RADIO_SIMULATOR_SPECTRUM_BINS; bin++) {
            spectrum[bin] += spectrumAlpha * (incoming[bin] - spectrum[bin]);
        }
        this.lastScalarAt = now;

        const clickCount = measurements.clickCount >>> 0;
        if (this.lastClickCount !== null && this.lastCounterAt) {
            const dt = (now - this.lastCounterAt) / 1000;
            if (dt > 0 && dt < 10) {
                let difference = (clickCount - this.lastClickCount) >>> 0;
                if (difference > 0x80000000) difference = 0;
                const rateAlpha = 1 - Math.exp(-dt / 3);
                values.clickRate += rateAlpha * (difference / dt - values.clickRate);
            }
        }
        this.lastClickCount = clickCount;
        this.lastCounterAt = now;
        this.lastTelemetryAt = now;
        this.bypassSince = 0;
    }

    getTemporalCapability() {
        return this.enabled !== false && this.mx > 0 ? 'must-process' : 'reset-on-resume';
    }

    setEnabled(enabled) {
        this._applyHudGateChange(() => super.setEnabled(enabled));
    }

    _setSectionEnabled(sectionEnabled) {
        this._applyHudGateChange(() => super._setSectionEnabled(sectionEnabled));
    }

    setPowerUiEnabled(enabled) {
        this._applyHudGateChange(() => super.setPowerUiEnabled(enabled));
    }

    _hudGateMode() {
        if (this.enabled === false) return 'disabled';
        return this.canRunAnimation() ? 'ready' : 'paused';
    }

    _applyHudGateChange(changeGate) {
        const previousMode = this._hudGateMode();
        changeGate();
        const nextMode = this._hudGateMode();
        if (nextMode === previousMode) return;
        this._updateHudStatus(nextMode === 'ready' ? this._hudMode(performance.now()) : nextMode);
        this.drawHud();
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            rd: this.rd,
            em: this.em, pr: this.pr, st: this.st, tn: this.tn, bw: this.bw,
            mp: this.mp, dl: this.dl, fd: this.fd, sm: this.sm,
            og: this.og, mx: this.mx, fr: this.fr,
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

    setParameters(p) {
        if (p === null || typeof p !== 'object') return;
        // Strict numeric validation through the base-class parser: NaN,
        // Infinity, arrays, objects, and partially numeric strings keep the
        // previous value instead of being coerced.
        const setNumber = (key, min, max) => {
            if (p[key] === undefined) return;
            this[key] = this.parseFiniteNumber(p[key], min, max, this[key]);
        };
        setNumber('pr', 0, 18);
        setNumber('st', 0, 70);
        setNumber('tn', -200, 200);
        setNumber('bw', 80, 240);
        setNumber('mp', 0, 100);
        setNumber('dl', 0.5, 50);
        setNumber('fd', 0, 20);
        setNumber('og', -24, 24);
        setNumber('mx', 0, 100);

        if (p.em !== undefined) this.em = String(p.em) === '75' ? '75' : '50';
        if (p.sm !== undefined) {
            this.sm = ['Stereo', 'Mono'].includes(p.sm) ? p.sm : 'Auto';
        }
        if (p.rd !== undefined) this.rd = p.rd === true || p.rd === 1 || p.rd === 'true';
        if (p.fr !== undefined) this.fr = p.fr === true || p.fr === 1 || p.fr === 'true';
        // The enabled flag only ever updates from an actual boolean.
        if (typeof p.enabled === 'boolean') this.enabled = p.enabled;

        this.updateParameters();
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        if (message.type !== 'processBuffer' || message.pluginId !== this.id ||
            !message.measurements) return;
        if (message.measurements.bypass === true) {
            const now = performance.now();
            if (!this.bypassSince || this.lastTelemetryAt >= this.bypassSince) {
                this.bypassSince = now;
            }
            this.lastBypassAt = now;
        }
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        this.stopAnimation();
        this.hudCreatedAt = performance.now();
        this.hudVisible = true;
        this.hudStatusElement = null;
        this.lastHudStatusMode = null;
        this.hudObserver?.disconnect();
        this.hudGraphDispose?.();
        this.hudGraphDispose = null;

        const container = document.createElement('div');
        container.className = 'fm-radio-simulator-container';

        const controls = document.createElement('div');
        controls.className = 'plugin-parameter-ui';
        controls.appendChild(this.createCheckboxControl('Radio', this.rd,
            v => this.setParameters({ rd: v }), 'rd'));
        controls.appendChild(this.createRadioGroup('Emphasis',
            [{ value: '50', label: '50 µs' }, { value: '75', label: '75 µs' }],
            this.em, v => this.setParameters({ em: v }), 'em'));
        controls.appendChild(this.createParameterControl('Processing', 0, 18, 0.1, this.pr,
            v => this.setParameters({ pr: v }), 'dB', 'pr'));
        controls.appendChild(this.createParameterControl('Signal', 0, 70, 0.1, this.st,
            v => this.setParameters({ st: v }), 'dBµV', 'st'));
        controls.appendChild(this.createParameterControl('Tuning', -200, 200, 0.1, this.tn,
            v => this.setParameters({ tn: v }), 'kHz', 'tn'));
        controls.appendChild(this.createParameterControl('IF Band', 80, 240, 1, this.bw,
            v => this.setParameters({ bw: v }), 'kHz', 'bw'));
        controls.appendChild(this.createParameterControl('Multipath', 0, 100, 1, this.mp,
            v => this.setParameters({ mp: v }), '%', 'mp'));
        controls.appendChild(this.createLogarithmicParameterControl('Path Delay', 0.5, 50, 0.01,
            this.dl, v => this.setParameters({ dl: v }), 'µs', 'dl'));
        controls.appendChild(this.createParameterControl('Fading', 0, 20, 0.1, this.fd,
            v => this.setParameters({ fd: v }), 'Hz', 'fd'));
        controls.appendChild(this.createRadioGroup('Stereo', ['Auto', 'Stereo', 'Mono'],
            this.sm, v => this.setParameters({ sm: v }), 'sm'));
        controls.appendChild(this.createParameterControl('Output', -24, 24, 0.1, this.og,
            v => this.setParameters({ og: v }), 'dB', 'og'));
        controls.appendChild(this.createParameterControl('Mix', 0, 100, 1, this.mx,
            v => this.setParameters({ mx: v }), '%', 'mx'));
        container.appendChild(controls);

        const graph = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '5 / 1',
            mobileAspectRatio: '2.5 / 1',
            className: 'fm-radio-simulator-hud',
            onResize: () => this.drawHud()
        });
        this.hudGraphDispose = graph.dispose;
        this.hudCanvas = graph.canvas;
        this.hudCanvas.setAttribute('aria-label', 'FM receiver status');
        container.appendChild(graph.container);
        graph.resize();

        const note = document.createElement('div');
        note.className = 'fm-radio-simulator-status-note';
        note.setAttribute('role', 'status');
        note.setAttribute('aria-live', 'polite');
        note.setAttribute('aria-atomic', 'true');
        this.hudStatusElement = note;
        this._updateHudStatus(this._hudMode(performance.now()));
        container.appendChild(note);

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
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    _hudMode(now) {
        const gateMode = this._hudGateMode();
        if (gateMode !== 'ready') return gateMode;
        if (this.lastTelemetryAt > 0 && now - this.lastTelemetryAt < 1200) return 'active';
        if (now - this.hudCreatedAt < 1500) return 'loading';
        if (now - this.lastBypassAt < 700 && this.bypassSince &&
            now - this.bypassSince >= 350) return 'bypass';
        return 'idle';
    }

    _updateHudStatus(mode) {
        if (!this.hudStatusElement || mode === this.lastHudStatusMode) return;
        // No standing text while the simulation runs normally; the
        // plain-text notice for the bypassed (WASM unavailable) state remains.
        const messages = {
            disabled: '',
            paused: 'The receiver display is paused while its section or visual display is inactive.',
            loading: 'Initializing the FM broadcast simulation. Audio remains unchanged until the WASM engine is ready.',
            idle: 'Waiting for audio. Start playback to view the receiver status.',
            bypass: 'WASM is required. The effect is bypassed because its simulation engine is unavailable.',
            active: ''
        };
        this.hudStatusElement.textContent = messages[mode];
        this.lastHudStatusMode = mode;
    }

    drawHud() {
        const canvas = this.hudCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const width = canvas.width;
        const height = canvas.height;
        const rect = canvas.getBoundingClientRect?.();
        const cssWidth = canvas.clientWidth || rect?.width || width || 1;
        const dpr = width / cssWidth;
        const now = performance.now();
        const mode = this._hudMode(now);
        this._updateHudStatus(mode);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        if (mode !== 'active') {
            const messages = {
                disabled: ['Effect is off', 'Turn it on to resume the broadcast simulation.'],
                paused: ['Receiver display paused', 'Turn the Section and visual display back on to resume.'],
                loading: ['Initializing the FM broadcast simulation…', 'Audio remains unchanged until the WASM engine is ready.'],
                idle: ['Waiting for audio', 'Start playback to view the MPX spectrum and receiver status.'],
                bypass: ['WASM is required', 'This effect is bypassed because its simulation engine is unavailable.']
            };
            const [title, detail] = messages[mode];
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = mode === 'bypass' ? '#ffbf69' : '#ddd';
            ctx.font = `600 ${Math.round(14 * dpr)}px Arial`;
            ctx.fillText(title, width / 2, height * 0.42);
            ctx.fillStyle = '#999';
            ctx.font = `${Math.round(11 * dpr)}px Arial`;
            ctx.fillText(detail, width / 2, height * 0.65);
            return;
        }

        // Layout, fonts, and colors follow the shared plugin graph conventions
        // (spectrum_analyzer / auto_leveler): #1a1a1a background, #333 grid,
        // #666 tick labels at 11-12 px Arial, #00ff00 curve.
        const values = this.hudValues;
        const narrow = cssWidth < 560;
        const tickFont = Math.round((narrow ? 11 : 12) * dpr);
        const statusHeight = (narrow ? 32 : 20) * dpr;
        const plotLeft = 40 * dpr;
        const plotTop = 6 * dpr;
        const plotRight = width - 8 * dpr;
        const plotBottom = height - statusHeight - 16 * dpr;
        const plotWidth = plotRight - plotLeft;
        const plotHeight = plotBottom - plotTop;
        if (plotWidth <= 0 || plotHeight <= 0) return;

        const floorDb = FM_RADIO_SIMULATOR_SPECTRUM_FLOOR_DB;
        const logSpan = Math.log(FM_RADIO_SIMULATOR_SPECTRUM_MAX_HZ /
            FM_RADIO_SIMULATOR_SPECTRUM_MIN_HZ);
        const frequencyToX = frequency => plotLeft + plotWidth *
            Math.log(frequency / FM_RADIO_SIMULATOR_SPECTRUM_MIN_HZ) / logSpan;
        const dbToY = db => {
            const clamped = db > 0 ? 0 : (db < floorDb ? floorDb : db);
            return plotTop + plotHeight * (-clamped / -floorDb);
        };

        ctx.strokeStyle = '#333';
        ctx.lineWidth = dpr;
        ctx.font = `${tickFont}px Arial`;
        ctx.textBaseline = 'middle';
        for (let db = 0; db >= floorDb; db -= 20) {
            const y = dbToY(db);
            ctx.beginPath();
            ctx.moveTo(plotLeft, y);
            ctx.lineTo(plotRight, y);
            ctx.stroke();
            if (db % 40 === 0) {
                ctx.fillStyle = '#666';
                ctx.textAlign = 'right';
                ctx.fillText(`${db}`, plotLeft - 4 * dpr, y);
            }
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const narrowLabels = ['1k', '10k', '19k', '53k'];
        for (const [frequency, label] of [[1000, '1k'], [10000, '10k'],
            [15000, '15k'], [19000, '19k'], [38000, '38k'], [53000, '53k']]) {
            const x = frequencyToX(frequency);
            ctx.strokeStyle = frequency === 19000 ? '#555' : '#333';
            ctx.beginPath();
            ctx.moveTo(x, plotTop);
            ctx.lineTo(x, plotBottom);
            ctx.stroke();
            if (!narrow || narrowLabels.includes(label)) {
                ctx.fillStyle = '#666';
                ctx.fillText(label, x, plotBottom + 2 * dpr);
            }
        }

        const spectrum = values.spectrumDb;
        const bins = FM_RADIO_SIMULATOR_SPECTRUM_BINS;
        ctx.beginPath();
        ctx.moveTo(plotLeft, plotBottom);
        for (let bin = 0; bin < bins; bin++) {
            const x = plotLeft + plotWidth * (bins === 1 ? 0 : bin / (bins - 1));
            ctx.lineTo(x, dbToY(spectrum[bin]));
        }
        ctx.lineTo(plotRight, plotBottom);
        ctx.fillStyle = 'rgba(0, 255, 0, 0.15)';
        ctx.fill();
        ctx.beginPath();
        for (let bin = 0; bin < bins; bin++) {
            const x = plotLeft + plotWidth * (bins === 1 ? 0 : bin / (bins - 1));
            const y = dbToY(spectrum[bin]);
            if (bin === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        // Status area: signal meter, CNR, stereo lamp + blend, multipath,
        // clicks. Narrow layouts split the six items into two rows so every
        // string stays inside the canvas down to 320 px.
        const statusY = narrow ? height - statusHeight + 6 * dpr
            : height - statusHeight / 2 - 2 * dpr;
        const statusY2 = statusY + 14 * dpr;
        const meterX = 8 * dpr;
        const meterSteps = 4;
        const meterLevel = Math.max(0, Math.min(1, values.rfLevelDb / 70));
        for (let step = 0; step < meterSteps; step++) {
            const barHeight = (3 + step * 2.5) * dpr;
            ctx.fillStyle = meterLevel * meterSteps > step ? '#00ff00' : '#363636';
            ctx.fillRect(meterX + step * 5 * dpr, statusY + 4 * dpr - barHeight,
                4 * dpr, barHeight);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(11 * dpr)}px Arial`;
        const stereoOn = values.blendRatio >= 0.5;
        const multipathText = values.multipathDb <= -119 ? '-∞' :
            values.multipathDb.toFixed(1);
        const segments = [
            [`${values.rfLevelDb.toFixed(1)} dBµV`, '#f0f0f0', 24 * dpr],
            [`CNR ${values.cnrDb.toFixed(1)} dB`, '#f0f0f0', 12 * dpr],
            ['●', stereoOn ? '#69c8ff' : '#4a4a4a', 12 * dpr],
            [`ST ${Math.round(values.blendRatio * 100)}%`, '#f0f0f0', 4 * dpr],
            [`MPath ${multipathText} dB`, '#f0f0f0', 12 * dpr],
            [`Clicks ${values.clickRate.toFixed(1)}/s`,
                values.clickRate >= 0.5 ? '#ffb347' : '#f0f0f0', 12 * dpr]
        ];
        const rows = narrow ? [segments.slice(0, 2), segments.slice(2)] : [segments];
        rows.forEach((rowSegments, rowIndex) => {
            let textX = meterX;
            const rowY = rowIndex === 0 ? statusY : statusY2;
            for (const [text, color, gap] of rowSegments) {
                textX += gap;
                ctx.fillStyle = color;
                ctx.fillText(text, textX, rowY);
                textX += ctx.measureText?.(text)?.width ?? text.length * 6 * dpr;
            }
        });
    }

    cleanup() {
        this.disposeDspTelemetrySubscription();
        this.stopAnimation();
        this.hudObserver?.disconnect();
        this.hudObserver = null;
        this.hudGraphDispose?.();
        this.hudGraphDispose = null;
        this.hudStatusElement = null;
        this.lastHudStatusMode = null;
        this.hudCanvas = null;
        super.cleanup();
    }
}

window.FMRadioSimulatorPlugin = FMRadioSimulatorPlugin;
