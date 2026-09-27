const TV_AUDIO_SIMULATOR_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
]);

const TV_AUDIO_SIMULATOR_STANDARDS = Object.freeze([
    'M/EIA-J', 'M/BTSC', 'M/A2', 'B/G A2',
    'B/G NICAM', 'I NICAM', 'D/K Mono', 'L AM'
]);
const TV_AUDIO_SIMULATOR_TX_MODES = Object.freeze(['Stereo', 'Mono', 'Dual']);
const TV_AUDIO_SIMULATOR_RECEIVE_MODES = Object.freeze(['Auto', 'Stereo', 'Main', 'Sub']);

const TV_AUDIO_SIMULATOR_STANDARD_INFO = Object.freeze({
    'M/EIA-J': Object.freeze({
        detail: 'FM, ±25 kHz deviation, 75 µs emphasis, EIA-J stereo/dual sound',
        spectrum: 'RECOVERED MPX', stereo: true, dual: true, nicam: false, am: false
    }),
    'M/BTSC': Object.freeze({
        detail: 'FM, ±25 kHz deviation, 75 µs emphasis, BTSC stereo',
        spectrum: 'RECOVERED MPX', stereo: true, dual: false, nicam: false, am: false
    }),
    'M/A2': Object.freeze({
        detail: 'FM, ±25 kHz deviation, 75 µs emphasis, A2 stereo/dual sound',
        spectrum: 'RECOVERED MPX', stereo: true, dual: true, nicam: false, am: false
    }),
    'B/G A2': Object.freeze({
        detail: 'FM, ±50 kHz deviation, 50 µs emphasis, A2 stereo/dual sound',
        spectrum: 'RECOVERED MPX', stereo: true, dual: true, nicam: false, am: false
    }),
    'B/G NICAM': Object.freeze({
        detail: 'Digital audio / analogue B/G FM mono fallback',
        spectrum: 'SELECTED AUDIO', stereo: true, dual: true, nicam: true, am: false
    }),
    'I NICAM': Object.freeze({
        detail: 'Digital audio / analogue I FM mono fallback',
        spectrum: 'SELECTED AUDIO', stereo: true, dual: true, nicam: true, am: false
    }),
    'D/K Mono': Object.freeze({
        detail: 'FM mono, ±50 kHz deviation, 50 µs emphasis',
        spectrum: 'RECOVERED MPX', stereo: false, dual: false, nicam: false, am: false
    }),
    'L AM': Object.freeze({
        detail: 'AM mono, positive modulation, 10 kHz receiver bandwidth',
        spectrum: 'DETECTED AUDIO', stereo: false, dual: false, nicam: false, am: true
    })
});

const TV_AUDIO_SIMULATOR_SYSTEM_PRESETS = Object.freeze([
    Object.freeze({
        id: 'tv-japan-eiaj', label: 'Japan TV (M / EIA-J)',
        params: Object.freeze({
            rd: true, ss: 'M/EIA-J', tx: 'Stereo', pr: 3, st: 48, tn: 0, bw: 230,
            mp: 4, dl: 5, fd: 0, sm: 'Auto', bz: -68, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'tv-north-america-btsc', label: 'North America TV (M / BTSC)',
        params: Object.freeze({
            rd: true, ss: 'M/BTSC', tx: 'Stereo', pr: 6, st: 50, tn: 0, bw: 230,
            mp: 6, dl: 5, fd: 0, sm: 'Auto', bz: -66, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'tv-korea-a2', label: 'Korea TV (M / A2)',
        params: Object.freeze({
            rd: true, ss: 'M/A2', tx: 'Stereo', pr: 3, st: 45, tn: 0, bw: 230,
            mp: 8, dl: 6, fd: 0, sm: 'Auto', bz: -67, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'tv-europe-a2', label: 'Europe TV (B/G / A2)',
        params: Object.freeze({
            rd: true, ss: 'B/G A2', tx: 'Stereo', pr: 3, st: 44, tn: 0, bw: 230,
            mp: 8, dl: 7, fd: 0, sm: 'Auto', bz: -64, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'tv-australia-a2', label: 'Australia TV (B/G / A2)',
        params: Object.freeze({
            rd: true, ss: 'B/G A2', tx: 'Stereo', pr: 3, st: 40, tn: 0, bw: 220,
            mp: 18, dl: 12, fd: 1.5, sm: 'Auto', bz: -62, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'tv-uk-nicam', label: 'UK TV (I / NICAM)',
        params: Object.freeze({
            rd: true, ss: 'I NICAM', tx: 'Stereo', pr: 0, st: 42, tn: 0, bw: 230,
            mp: 5, dl: 5, fd: 0, sm: 'Auto', bz: -70, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'tv-nordic-nicam', label: 'Nordic TV (B/G / NICAM)',
        params: Object.freeze({
            rd: true, ss: 'B/G NICAM', tx: 'Stereo', pr: 0, st: 38, tn: 0, bw: 230,
            mp: 10, dl: 8, fd: 0.5, sm: 'Auto', bz: -68, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'tv-eastern-europe-mono', label: 'Eastern Europe TV (D/K mono)',
        params: Object.freeze({
            rd: true, ss: 'D/K Mono', tx: 'Mono', pr: 3, st: 42, tn: 0, bw: 220,
            mp: 7, dl: 7, fd: 0, sm: 'Main', bz: -61, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'tv-france-l', label: 'France TV (L / AM sound)',
        params: Object.freeze({
            rd: true, ss: 'L AM', tx: 'Mono', pr: 2, st: 40, tn: 1.5, bw: 160,
            mp: 8, dl: 8, fd: 0.5, sm: 'Main', bz: -59, og: 0, mx: 100
        })
    })
]);

// Runtime processing is WASM-only. The hidden `fr` flag enables the deterministic
// JavaScript reference path for parity and golden generation.
const TV_AUDIO_SIMULATOR_REFERENCE_PROCESSOR = `
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

    // [deviation Hz, emphasis seconds, horizontal Hz, field Hz]. Enum order
    // is the params.json order and matches kStandardTable in kernel.cpp.
    const STANDARD_TABLE = [
        [25000, F(75.0e-6), 15734, 60],
        [25000, F(75.0e-6), 15734, 60],
        [25000, F(75.0e-6), 15734, 60],
        [50000, F(50.0e-6), 15625, 50],
        [50000, F(50.0e-6), 15625, 50],
        [50000, F(50.0e-6), 15625, 50],
        [50000, F(50.0e-6), 15625, 50],
        [50000, 0, 15625, 50]
    ];

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

    function makeBiquad() {
        return {
            b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, s1: 0, s2: 0,
            denormalPositive: true
        };
    }

    function processBiquad(filter, input) {
        const denormalNoise = filter.denormalPositive ? F(1.0e-19) : F(-1.0e-19);
        filter.denormalPositive = !filter.denormalPositive;
        const output = F(F(F(filter.b0 * input) + filter.s1) + denormalNoise);
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
        for (let index = 0; index < filters.length; index++) {
            output = processBiquad(filters[index], output);
        }
        return output;
    }

    function makeBiquadCascade(count) {
        const filters = [];
        for (let index = 0; index < count; index++) filters.push(makeBiquad());
        return filters;
    }

    function configureElliptic(filters, rate) {
        const table = ELLIPTIC_15K[rate];
        for (let index = 0; index < 5; index++) {
            const filter = filters[index];
            filter.b0 = F(table[index][0]); filter.b1 = F(table[index][1]);
            filter.b2 = F(table[index][2]); filter.a1 = F(table[index][3]);
            filter.a2 = F(table[index][4]);
        }
    }

    function configureHighPass(filter, frequency, q, sampleRate) {
        configureLowPass(filter, frequency, q, sampleRate);
        const gain = F(F(F(1 - filter.a1) + filter.a2) * F(0.25));
        filter.b0 = gain;
        filter.b1 = F(-2 * gain);
        filter.b2 = gain;
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
        if (context.__tvAudioNoiseSeed !== undefined) return context.__tvAudioNoiseSeed;
        // Two derived 32-bit words; the WASM kernel mirrors this derivation from its own
        // master XorShiftRng so both engines share one deterministic noise stream.
        const low = BigInt(Math.floor(context.__seededRandom() * FLOAT32_SCALE));
        const high = BigInt(Math.floor(context.__seededRandom() * FLOAT32_SCALE));
        let seed = ((high << 32n) | low) & MASK_64;
        if (seed === 0n) seed = FALLBACK_SEED;
        context.__tvAudioNoiseSeed = seed;
        return seed;
    }

    function deriveNicamSeed(noiseSeed) {
        const low = Number(noiseSeed & 0xffffffffn) ^ 0x4e494341;
        const high = Number((noiseSeed >> 32n) & 0xffffffffn) ^ 0x4d728001;
        let seed = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
        seed &= MASK_64;
        return seed === 0n ? FALLBACK_SEED : seed;
    }

    function random01(random) {
        random.state = nextXorShift(random.state);
        return Number(random.state >> 11n) / FLOAT53;
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

    function resolveEffectiveMode(standard, tx, receive) {
        if (standard >= 6 || tx === 1 || (standard === 1 && tx === 2)) return 0;
        if (tx === 2) return receive === 3 ? 2 : 0;
        return receive >= 2 ? 0 : 1;
    }

    function makeProgrammeDelay(rate) {
        const delay = 30.0e-6 * rate;
        return {
            ring: new Float32Array(32),
            position: 0,
            samples: Math.trunc(delay),
            fraction: F(delay - Math.trunc(delay))
        };
    }

    function processProgrammeDelay(delay, input) {
        delay.ring[delay.position] = input;
        const recent = (delay.position + 32 - delay.samples) & 31;
        const older = (recent + 31) & 31;
        const output = F(delay.ring[recent] +
            F(delay.fraction * F(delay.ring[older] - delay.ring[recent])));
        delay.position = (delay.position + 1) & 31;
        return output;
    }

    function makeFmSubDemod(rate) {
        return {
            oscillator: makeOscillator(),
            highPass: makeBiquadCascade(2),
            lowI: makeBiquadCascade(2),
            lowQ: makeBiquadCascade(2),
            audio: makeCascade(rate),
            previousReal: 1,
            previousImag: 0,
            rate,
            health: 0
        };
    }

    function configureFmSubDemod(demod, frequency, rate) {
        demod.rate = rate;
        configureOscillator(demod.oscillator, frequency, rate);
        const q = [0.5411961001, 1.306562965];
        for (let index = 0; index < 2; index++) {
            configureHighPass(demod.highPass[index], 18000, q[index], rate);
            configureLowPass(demod.lowI[index], 22000, q[index], rate);
            configureLowPass(demod.lowQ[index], 22000, q[index], rate);
        }
        configureElliptic(demod.audio, rate);
    }

    function processFmSubDemod(demod, input) {
        input = processCascade(demod.highPass, input);
        const real = processCascade(demod.lowI,
            F(input * F(demod.oscillator.cosine)));
        const imag = processCascade(demod.lowQ,
            F(-input * F(demod.oscillator.sine)));
        advanceOscillator(demod.oscillator);
        const power = F(F(real * real) + F(imag * imag));
        demod.health = F(F(LOCK_KEEP * demod.health) + F(LOCK_GAIN * power));
        const cross = F(F(imag * demod.previousReal) - F(real * demod.previousImag));
        const dot = F(F(real * demod.previousReal) + F(imag * demod.previousImag));
        demod.previousReal = real;
        demod.previousImag = imag;
        return processCascade(demod.audio,
            F(fastAtan2(cross, dot) * F(demod.rate * INV_TWO_PI / 10000)));
    }

    function makeJ17() {
        return { b0: 1, b1: 0, a1: 0, previousInput: 0, previousOutput: 0 };
    }

    function configureJ17(filter, rate, inverse) {
        const k = 2 * rate / 3000;
        const root75 = 8.660254037844386;
        const numerator = inverse ? root75 : 1;
        const denominator = inverse ? 1 : root75;
        filter.b0 = F((numerator + k) / (denominator + k));
        filter.b1 = F((numerator - k) / (denominator + k));
        filter.a1 = F((denominator - k) / (denominator + k));
    }

    function processJ17(filter, input) {
        const output = F(F(F(filter.b0 * input) + F(filter.b1 * filter.previousInput)) -
            F(filter.a1 * filter.previousOutput));
        filter.previousInput = input;
        filter.previousOutput = output;
        return output;
    }

    function makeNicamChannel(rate) {
        const channel = {
            lowPass: makeCascade(rate),
            pre: makeJ17(), de: makeJ17(),
            shift: 4, peak: 0, previous: 0, older: 0
        };
        configureJ17(channel.pre, rate, false);
        configureJ17(channel.de, rate, true);
        return channel;
    }

    function endNicamBlock(channel) {
        channel.shift = 0;
        while (channel.shift < 4 && channel.peak > (511 << channel.shift)) channel.shift++;
        channel.peak = 0;
    }

    function processNicamChannel(channel, input, error) {
        const emphasized = processJ17(channel.pre, processCascade(channel.lowPass, input));
        const scaled = F(emphasized * F(8192));
        let sample = Math.trunc(scaled >= 0 ? scaled + 0.5 : scaled - 0.5);
        sample = sample < -8192 ? -8192 : (sample > 8191 ? 8191 : sample);
        const absolute = sample < 0 ? -sample : sample;
        if (absolute > channel.peak) channel.peak = absolute;
        const divisor = 1 << channel.shift;
        let compressed = Math.trunc(sample / divisor);
        compressed = compressed < -512 ? -512 : (compressed > 511 ? 511 : compressed);
        let decoded = F(F(compressed * divisor) / F(8192));
        if (error) decoded = F(F(0.5) * F(channel.previous + channel.older));
        channel.older = channel.previous;
        channel.previous = decoded;
        return processJ17(channel.de, decoded);
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
        const noiseSeed = deriveNoiseSeed();
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
            noise: { state: noiseSeed, hasSpare: false, spare: 0 },
            nicamNoise: { state: deriveNicamSeed(noiseSeed) },
            subDemod: makeFmSubDemod(mpx),
            mainDelay: makeProgrammeDelay(mpx),
            differenceDelay: makeProgrammeDelay(mpx),
            buzzOscillator: makeOscillator(),
            amInput: makeBiquadCascade(2), amOutput: makeBiquadCascade(2),
            nicamLeft: makeNicamChannel(host), nicamRight: makeNicamChannel(host),
            hostLeft: new Float32Array(MAX_FRAMES), hostRight: new Float32Array(MAX_FRAMES),
            dryBlockLeft: new Float32Array(MAX_FRAMES), dryBlockRight: new Float32Array(MAX_FRAMES),
            wetLeft: new Float32Array(MAX_FRAMES + 8), wetRight: new Float32Array(MAX_FRAMES + 8),
            digitalBlockLeft: new Float32Array(MAX_FRAMES),
            digitalBlockRight: new Float32Array(MAX_FRAMES),
            digitalBlend: new Float32Array(MAX_FRAMES),
            txLeft: new Float32Array(mpxCapacity), txRight: new Float32Array(mpxCapacity),
            rxLeft: new Float32Array(mpxCapacity), rxRight: new Float32Array(mpxCapacity),
            txMpx: new Float32Array(mpxCapacity), rxMpx: new Float32Array(mpxCapacity),
            coreInput: new Float32Array(coreCapacity), coreOutput: new Float32Array(coreCapacity),
            multipathReal: null, multipathImag: null, multipathSize: 0, multipathPosition: 0,
            previousLimitedReal: 1, previousLimitedImag: 0,
            fmPhase: 0, pllIntegrator: 0, pllLock: 0,
            pllKp: 0, pllKi: 0, pilotBaseSine: 0, pilotBaseCosine: 1,
            standard: 0, txMode: 0, effectiveMode: 1, deviation: 25000,
            subPhase: 0, subInjection: F(0.8),
            compressorEnvelope: 0, expanderEnvelope: 0,
            compandAttack: 0, compandRelease: 0,
            buzzTarget: 0, buzzCurrent: 0,
            nicamClock: 0, nicamErrorProbability: 0, nicamErrorEma: 0,
            nicamBlend: 1, nicamMute: 1, nicamState: 0, selectedBlend: 0,
            transitionRemaining: 0, transitionLeft: 0, transitionRight: 0,
            previousOutputLeft: 0, previousOutputRight: 0,
            dryLeft: null, dryRight: null, drySize: 0, dryPosition: 0, latencySamples: 0,
            nicamDelayLeft: null, nicamDelayRight: null,
            controlsConfigured: false, lastParams: null,
            emphasisTau: TAU50, deCoefficient: 0, preInverse: 1,
            dcCoefficient: F(Math.exp(-TWO_PI * DC_CUT_HZ / host)),
            processingAmountTarget: 0, processingDriveTarget: 1, limiterRelease: F(0.999),
            signalAmplitudeTarget: 1, tuningKhz: 0, ifBandKhz: F(230),
            multipathTarget: 0, pathDelayTargetUs: F(5), fadingHz: 0,
            automaticStereo: false,
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
            (0.5 * (state.mpxToHost.tapsPerPhase - 1)) / mpx + 30.0e-6;
        state.latencySamples = Math.ceil(latencySeconds * host);
        state.drySize = state.latencySamples + 1;
        state.dryLeft = new Float32Array(state.drySize);
        state.dryRight = new Float32Array(state.drySize);
        state.nicamDelayLeft = new Float32Array(state.drySize);
        state.nicamDelayRight = new Float32Array(state.drySize);
        const amQ = [0.5411961001, 1.306562965];
        for (let index = 0; index < 2; index++) {
            configureLowPass(state.amInput[index], 10000, amQ[index], host);
            configureLowPass(state.amOutput[index], 10000, amQ[index], mpx);
        }
        return state;
    }

    function configureControls(state, p) {
        const effectiveMode = resolveEffectiveMode(p.ss, p.tx, p.sm);
        const automaticStereo = p.ss < 4 && effectiveMode === 1 && p.sm === 0;
        const standardChanged = !state.controlsConfigured || p.ss !== state.standard;
        const txChanged = !state.controlsConfigured || p.tx !== state.txMode;
        const effectiveModeChanged = !state.controlsConfigured ||
            effectiveMode !== state.effectiveMode;
        const automaticStereoChanged = !state.controlsConfigured ||
            automaticStereo !== state.automaticStereo;
        if (state.controlsConfigured && (standardChanged || txChanged ||
            effectiveModeChanged || automaticStereoChanged)) {
            state.transitionRemaining = Math.trunc(0.020 * state.hostRate);
            state.transitionLeft = state.previousOutputLeft;
            state.transitionRight = state.previousOutputRight;
        }
        state.standard = p.ss;
        state.txMode = p.tx;
        state.effectiveMode = effectiveMode;
        state.automaticStereo = automaticStereo;
        state.deviation = STANDARD_TABLE[p.ss][0];
        state.emphasisTau = STANDARD_TABLE[p.ss][1];
        state.deCoefficient = state.emphasisTau > 0 ?
            F(Math.exp(-1 / (state.hostRate * state.emphasisTau))) : 0;
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
        state.subInjection = p.ss === 0 ? (p.tx === 2 ? F(0.6) : F(0.8)) : F(0.4);
        state.compandAttack = F(1 - Math.exp(-1 / (0.005 * state.mpxRate)));
        state.compandRelease = F(1 - Math.exp(-1 / (0.050 * state.mpxRate)));
        state.buzzTarget = p.bz <= -80 ? 0 : F(Math.pow(10, p.bz / 20));
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
            state.buzzCurrent = state.buzzTarget;
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
        const standardInfo = STANDARD_TABLE[state.standard];
        configureOscillator(state.pilotTx, standardInfo[2], state.mpxRate);
        configureOscillator(state.pilotRx, standardInfo[2], state.mpxRate);
        configureFmSubDemod(state.subDemod, 2 * standardInfo[2], state.mpxRate);
        configureOscillator(state.buzzOscillator, standardInfo[3], state.mpxRate);
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
        let errorPosition = (28 - cnrDb) / 24;
        errorPosition = errorPosition < 0 ? 0 : (errorPosition > 0.7 ? 0.7 : errorPosition);
        state.nicamErrorProbability = errorPosition * errorPosition;
        if (!state.controlsConfigured) {
            state.nicamErrorEma = state.nicamErrorProbability;
            state.nicamState = state.nicamErrorEma > 0.18 ? 3 :
                (state.nicamErrorEma > 0.06 ? 2 : (state.nicamErrorEma > 0.005 ? 1 : 0));
            state.nicamBlend = state.nicamState === 3 || !p.rd ? 0 : 1;
            state.nicamMute = state.nicamState === 2 ? 0 : 1;
        }
        if (position < 0) position = 0; else if (position > 1) position = 1;
        state.cnrBlend = F(position * position * (3 - 2 * position));
        state.demodScale = F(state.coreRate * INV_TWO_PI / state.deviation);
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

    function isNicam(state) { return state.standard === 4 || state.standard === 5; }

    function hasFmSub(state) {
        return state.standard === 0 || state.standard === 2 || state.standard === 3;
    }

    function compressDifference(state, input) {
        const absolute = input < 0 ? -input : input;
        const alpha = absolute > state.compressorEnvelope ?
            state.compandAttack : state.compandRelease;
        state.compressorEnvelope = F(state.compressorEnvelope +
            F(alpha * F(absolute - state.compressorEnvelope)));
        const envelope = state.compressorEnvelope > 0.001 ?
            state.compressorEnvelope : F(0.001);
        return F(input * fastInverseSqrt(envelope));
    }

    function expandDifference(state, input) {
        const absolute = input < 0 ? -input : input;
        const alpha = absolute > state.expanderEnvelope ?
            state.compandAttack : state.compandRelease;
        state.expanderEnvelope = F(state.expanderEnvelope +
            F(alpha * F(absolute - state.expanderEnvelope)));
        return F(input * state.expanderEnvelope);
    }

    function updateNicamState(state, broadcast) {
        const rising = [0.005, 0.06, 0.18];
        const falling = [0.002, 0.03, 0.12];
        if (!broadcast) state.nicamState = 3;
        else {
            while (state.nicamState < 3 &&
                state.nicamErrorEma > rising[state.nicamState]) state.nicamState++;
            while (state.nicamState > 0 &&
                state.nicamErrorEma < falling[state.nicamState - 1]) state.nicamState--;
        }
        const target = state.nicamState === 3 ? 0 : 1;
        state.nicamBlend += state.controlAlphaHost * (target - state.nicamBlend);
        const muteTarget = state.nicamState === 2 ? 0 : 1;
        state.nicamMute += state.controlAlphaHost * (muteTarget - state.nicamMute);
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
        state.fmPhase += TWO_PI * state.deviation * mpx / state.coreRate;
        if (state.fmPhase > PI) state.fmPhase -= TWO_PI;
        else if (state.fmPhase < -PI) state.fmPhase += TWO_PI;
        fastSinCos(state.fmPhase);
        let real = SINCOS.cos;
        let imag = SINCOS.sin;
        if (state.standard === 7) {
            real = F(1 + mpx);
            imag = 0;
        }
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
        if (state.standard === 7) {
            const denominator = signalAmplitude > 0.001 ? signalAmplitude : F(0.001);
            return F(F(F(magnitudeSquared * inverseMagnitude) / denominator) - 1);
        }
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

    let state = context.tvAudioSimulator;
    if (!state || state.sampleRate !== parameters.sampleRate) {
        state = createState(parameters.sampleRate);
        context.tvAudioSimulator = state;
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
    const broadcastEnabled = parameters.rd === undefined ? 1 :
        (Number(parameters.rd) >= 0.5 ? 1 : 0);
    const standards = ['M/EIA-J', 'M/BTSC', 'M/A2', 'B/G A2',
        'B/G NICAM', 'I NICAM', 'D/K Mono', 'L AM'];
    const txModes = ['Stereo', 'Mono', 'Dual'];
    const receiveModes = ['Auto', 'Stereo', 'Main', 'Sub'];
    let standard = standards.indexOf(parameters.ss);
    let txMode = txModes.indexOf(parameters.tx);
    let receiveMode = receiveModes.indexOf(parameters.sm);
    if (standard < 0) standard = 0;
    if (txMode < 0) txMode = 0;
    if (receiveMode < 0) receiveMode = 0;
    const p = {
        rd: broadcastEnabled, ss: standard, tx: txMode,
        pr: F(parameters.pr), st: F(parameters.st), tn: F(parameters.tn),
        bw: F(parameters.bw), mp: F(parameters.mp), dl: F(parameters.dl),
        fd: F(parameters.fd), sm: receiveMode, bz: F(parameters.bz),
        og: F(parameters.og), mx: F(parameters.mx)
    };
    const last = state.lastParams;
    if (!state.controlsConfigured || !last || last.rd !== p.rd ||
        last.ss !== p.ss || last.tx !== p.tx || last.pr !== p.pr ||
        last.st !== p.st || last.tn !== p.tn ||
        last.bw !== p.bw || last.mp !== p.mp || last.dl !== p.dl || last.fd !== p.fd ||
        last.sm !== p.sm || last.bz !== p.bz || last.og !== p.og || last.mx !== p.mx) {
        configureControls(state, p);
        state.lastParams = p;
    }

    for (let frame = 0; frame < frameCount; frame++) {
        const inputLeft = data[frame];
        const inputRight = pairChannels === 2 ? data[frameCount + frame] : data[frame];
        state.dryBlockLeft[frame] = inputLeft;
        state.dryBlockRight[frame] = inputRight;
        if (isNicam(state)) {
            const error = random01(state.nicamNoise) < state.nicamErrorProbability;
            state.nicamErrorEma += state.controlAlphaHost *
                ((error ? 1 : 0) - state.nicamErrorEma);
            updateNicamState(state, p.rd);
            state.digitalBlockLeft[frame] = F(processNicamChannel(
                state.nicamLeft, inputLeft, error) * F(state.nicamMute));
            state.digitalBlockRight[frame] = F(processNicamChannel(
                state.nicamRight, inputRight, error) * F(state.nicamMute));
            state.digitalBlend[frame] = F(state.nicamBlend);
            state.nicamClock += 1000;
            if (state.nicamClock >= state.hostRate) {
                state.nicamClock -= state.hostRate;
                endNicamBlock(state.nicamLeft);
                endNicamBlock(state.nicamRight);
            }
        }
        if (state.standard === 7) {
            const main = state.txMode === 2 ? inputLeft : F(F(0.5) * F(inputLeft + inputRight));
            const filtered = processCascade(state.amInput, main);
            state.hostLeft[frame] = filtered;
            state.hostRight[frame] = filtered;
        } else {
            state.hostLeft[frame] = processPreEmphasis(state,
                processCascade(state.hostInputLeft, inputLeft), state.preLeft);
            state.hostRight[frame] = processPreEmphasis(state,
                processCascade(state.hostInputRight, inputRight), state.preRight);
        }
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
        const main = state.txMode === 2 ? left : F(F(0.5) * F(left + right));
        let multiplex = F(F(0.9) * main);
        if (state.standard === 1 && state.txMode === 0) {
            const difference = compressDifference(state, F(left - right));
            const subcarrier = F(2 * state.pilotTx.sine * state.pilotTx.cosine);
            const differenceTerm = F(F(C045 * difference) * subcarrier);
            const pilotTerm = F(C009 * F(state.pilotTx.sine));
            multiplex = F(multiplex + F(differenceTerm + pilotTerm));
        } else if (hasFmSub(state) && state.txMode !== 1) {
            const secondary = state.txMode === 2 || state.standard >= 2 ?
                right : F(F(0.5) * F(left - right));
            state.subPhase += TWO_PI *
                (2 * STANDARD_TABLE[state.standard][2] + 10000 * secondary) / state.mpxRate;
            while (state.subPhase > PI) state.subPhase -= TWO_PI;
            while (state.subPhase < -PI) state.subPhase += TWO_PI;
            fastSinCos(state.subPhase);
            multiplex = F(multiplex + F(state.subInjection * SINCOS.cos));
        }
        state.txMpx[index] = multiplex;
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
        let mpx = state.rxMpx[index];
        state.buzzCurrent += state.controlAlphaMpx *
            (state.buzzTarget - state.buzzCurrent);
        if (state.buzzCurrent > 1.0e-10) {
            const sine = F(state.buzzOscillator.sine);
            const second = F(2 * state.buzzOscillator.sine * state.buzzOscillator.cosine);
            const sineCubed = F(F(F(4 * sine) * sine) * sine);
            const third = F(F(3 * sine) - sineCubed);
            const harmonics = F(F(sine + F(F(0.5) * second)) + F(F(0.25) * third));
            mpx = F(mpx + F(F(state.buzzCurrent) * harmonics));
        }
        advanceOscillator(state.buzzOscillator);
        if (state.standard === 7) mpx = processCascade(state.amOutput, mpx);
        const main = processProgrammeDelay(
            state.mainDelay, F(processCascade(state.rxSum, mpx) * INV09));
        let left = main;
        let right = main;
        const pilot = state.pilotRx;
        if (state.standard === 1) {
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
            const carrier = F(2 * pilot.sine * pilot.cosine);
            const decoded = processCascade(state.rxDifference, F(F(2 * mpx) * carrier));
            const difference = processProgrammeDelay(state.differenceDelay,
                expandDifference(state, F(decoded * F(1 / F(0.45)))));
            let lock = F(state.pllLock * 24);
            if (lock > 1) lock = 1;
            state.selectedBlend = state.effectiveMode === 1 ?
                (state.automaticStereo ? F(lock * state.cnrBlend) : 1) : 0;
            const stereoDifference = F(F(F(0.5) * state.selectedBlend) * difference);
            left = F(left + stereoDifference);
            right = F(right - stereoDifference);
        } else if (hasFmSub(state)) {
            const secondary = processFmSubDemod(state.subDemod, mpx);
            let lock = F(F(state.subDemod.health * 8) /
                F(state.subInjection * state.subInjection));
            if (lock > 1) lock = 1;
            state.pllLock = F(lock / 24);
            const blend = state.automaticStereo ? F(lock * state.cnrBlend) : 1;
            state.selectedBlend = state.effectiveMode === 0 ? 0 : blend;
            if (state.effectiveMode === 2) {
                left = F(main + F(blend * F(secondary - main)));
                right = left;
            } else if (state.effectiveMode === 1) {
                const difference = state.standard === 0 ? secondary : F(main - secondary);
                left = F(main + F(blend * difference));
                right = F(main - F(blend * difference));
            }
        } else {
            state.selectedBlend = 0;
        }
        state.rxLeft[index] = left;
        state.rxRight[index] = right;
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
        left = processDcCut(state, processDeEmphasis(state, left, state.deLeft), state.dcLeft);
        right = processDcCut(state, processDeEmphasis(state, right, state.deRight), state.dcRight);
        if (isNicam(state)) {
            let digitalLeft = state.digitalBlockLeft[frame];
            let digitalRight = state.digitalBlockRight[frame];
            if (state.effectiveMode === 2) {
                digitalLeft = digitalRight;
            } else if (state.effectiveMode === 0) {
                digitalLeft = state.txMode === 2 ? digitalLeft :
                    F(F(0.5) * F(digitalLeft + digitalRight));
                digitalRight = digitalLeft;
            }
            state.nicamDelayLeft[state.dryPosition] = digitalLeft;
            state.nicamDelayRight[state.dryPosition] = digitalRight;
            const blend = state.digitalBlend[frame];
            left = F(left + F(blend * F(state.nicamDelayLeft[dryRead] - left)));
            right = F(right + F(blend * F(state.nicamDelayRight[dryRead] - right)));
            state.selectedBlend = blend;
        }
        if (state.transitionRemaining > 0) {
            const remaining = F(state.transitionRemaining /
                Math.trunc(0.020 * state.hostRate));
            left = F(left + F(remaining * F(state.transitionLeft - left)));
            right = F(right + F(remaining * F(state.transitionRight - right)));
            state.transitionRemaining--;
        }
        state.previousOutputLeft = left;
        state.previousOutputRight = right;
        left = F(left * outputGain);
        right = F(right * outputGain);
        left = F(delayedLeft + F(mix * F(left - delayedLeft)));
        right = F(delayedRight + F(mix * F(right - delayedRight)));
        data[frame] = left;
        if (pairChannels === 2) data[frameCount + frame] = right;
        state.dryPosition = state.dryPosition + 1 === state.drySize ? 0 : state.dryPosition + 1;
    }
    return data;
`;

// TV telemetry v1: five float32 scalars (carrier level, estimated CNR,
// scheme health, selected-path blend, multipath depth), one cumulative u32
// click/error counter, then 48 float32 spectrum bins.
const TV_AUDIO_SIMULATOR_TAP_STATUS = 25;
const TV_AUDIO_SIMULATOR_TELEMETRY_VERSION = 1;
const TV_AUDIO_SIMULATOR_TELEMETRY_BYTES = 216;
const TV_AUDIO_SIMULATOR_SPECTRUM_BINS = 48;
const TV_AUDIO_SIMULATOR_SPECTRUM_MIN_HZ = 300;
const TV_AUDIO_SIMULATOR_SPECTRUM_FLOOR_DB = -100;

let tvAudioSimulatorInstanceSerial = 0;

class TVAudioSimulatorPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: TV_AUDIO_SIMULATOR_SAMPLE_RATES,
        supportedChannelModes: Object.freeze(['mono', 'stereo-pair'])
    });

    static getSystemPresetGroups() {
        return [{
            label: '',
            presets: TV_AUDIO_SIMULATOR_SYSTEM_PRESETS.map(preset => ({ ...preset }))
        }];
    }

    static resolveEffectiveMode(standard, txMode, receiveMode, fallback = false) {
        const info = TV_AUDIO_SIMULATOR_STANDARD_INFO[standard] ||
            TV_AUDIO_SIMULATOR_STANDARD_INFO['M/EIA-J'];
        if (fallback || info.am || !info.stereo || txMode === 'Mono') return 'MAIN';
        if (txMode === 'Dual') {
            return info.dual && receiveMode === 'Sub' ? 'SUB' : 'MAIN';
        }
        if (receiveMode === 'Main' || receiveMode === 'Sub') return 'MAIN';
        return 'STEREO';
    }

    constructor() {
        super('TV Audio Simulator',
            'Simulates analogue and NICAM television sound transmission and reception');
        this.rd = true;
        this.ss = 'M/EIA-J';
        this.tx = 'Stereo';
        this.pr = 0;
        this.st = 35;
        this.tn = 0;
        this.bw = 230;
        this.mp = 0;
        this.dl = 5;
        this.fd = 0;
        this.sm = 'Auto';
        this.bz = -80;
        this.og = 0;
        this.mx = 100;
        this.fr = false;

        this.temporalCapability = 'must-process';
        this.executionState = { state: 'pending', reason: null };
        this.executionStateReceived = false;
        this.selectedTab = 'standard';
        this.animationFrameId = null;
        this.hudCanvas = null;
        this.hudStatusElement = null;
        this.standardDetailElement = null;
        this.hudGraphDispose = null;
        this.hudObserver = null;
        this.hudVisible = true;
        this.hudCreatedAt = performance.now();
        this.lastTelemetryAt = 0;
        this.lastBypassAt = 0;
        this.bypassSince = 0;
        this.lastScalarAt = 0;
        this.lastCounterAt = 0;
        this.lastErrorCount = null;
        this.hudValues = {
            carrierLevelDb: 0,
            cnrDb: 0,
            schemeHealth: 0,
            selectedBlend: 0,
            multipathDb: -120,
            errorRate: 0,
            spectrumDb: new Float32Array(TV_AUDIO_SIMULATOR_SPECTRUM_BINS)
                .fill(TV_AUDIO_SIMULATOR_SPECTRUM_FLOOR_DB - 40)
        };
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspTvTelemetry = frame => this.handleDspTelemetry(frame);
        this.registerProcessor(TV_AUDIO_SIMULATOR_REFERENCE_PROCESSOR);
    }

    _setupMessageHandler() {
        super._setupMessageHandler();
        this.ensureDspTelemetrySubscription();
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
        if (this._dspTelemetryUnsubscribe && hub === this._dspTelemetryHub &&
            tapId === this._dspTelemetryTapId) return true;

        this.disposeDspTelemetrySubscription();
        try {
            const unsubscribe = hub.subscribe(
                tapId, TV_AUDIO_SIMULATOR_TAP_STATUS, this._boundDspTvTelemetry);
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(
                    tapId, TV_AUDIO_SIMULATOR_TAP_STATUS, this._boundDspTvTelemetry);
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
        if (frame?.frameType !== TV_AUDIO_SIMULATOR_TAP_STATUS ||
            frame.formatVersion !== TV_AUDIO_SIMULATOR_TELEMETRY_VERSION) return null;
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            typeof payload.getUint32 !== 'function' ||
            payload.byteLength !== TV_AUDIO_SIMULATOR_TELEMETRY_BYTES) return null;
        const measurements = {
            carrierLevelDb: payload.getFloat32(0, true),
            cnrDb: payload.getFloat32(4, true),
            schemeHealth: payload.getFloat32(8, true),
            selectedBlend: payload.getFloat32(12, true),
            multipathDb: payload.getFloat32(16, true),
            errorCount: payload.getUint32(20, true)
        };
        for (const key of ['carrierLevelDb', 'cnrDb', 'schemeHealth',
            'selectedBlend', 'multipathDb']) {
            if (!Number.isFinite(measurements[key])) return null;
        }
        if (measurements.schemeHealth < 0 || measurements.schemeHealth > 1.0001 ||
            measurements.selectedBlend < 0 || measurements.selectedBlend > 1.0001) return null;
        const spectrumDb = new Float32Array(TV_AUDIO_SIMULATOR_SPECTRUM_BINS);
        for (let bin = 0; bin < TV_AUDIO_SIMULATOR_SPECTRUM_BINS; bin++) {
            const value = payload.getFloat32(24 + 4 * bin, true);
            if (!Number.isFinite(value)) return null;
            spectrumDb[bin] = value;
        }
        measurements.spectrumDb = spectrumDb;
        return measurements;
    }

    handleDspTelemetry(frame) {
        const measurements = this.parseDspTelemetryFrame(frame);
        if (measurements) this._applyTelemetryMeasurements(measurements);
    }

    _applyTelemetryMeasurements(measurements) {
        const now = performance.now();
        const values = this.hudValues;
        const scalarDt = this.lastScalarAt ? Math.min(1, (now - this.lastScalarAt) / 1000) : 1;
        const scalarAlpha = 1 - Math.exp(-scalarDt / 0.1);
        for (const key of ['carrierLevelDb', 'cnrDb', 'schemeHealth',
            'selectedBlend', 'multipathDb']) {
            values[key] += scalarAlpha * (measurements[key] - values[key]);
        }
        const spectrumAlpha = 1 - Math.exp(-scalarDt / 0.12);
        for (let bin = 0; bin < TV_AUDIO_SIMULATOR_SPECTRUM_BINS; bin++) {
            values.spectrumDb[bin] += spectrumAlpha *
                (measurements.spectrumDb[bin] - values.spectrumDb[bin]);
        }
        this.lastScalarAt = now;

        const errorCount = measurements.errorCount >>> 0;
        if (this.lastErrorCount !== null && this.lastCounterAt) {
            const dt = (now - this.lastCounterAt) / 1000;
            if (dt > 0 && dt < 10) {
                let difference = (errorCount - this.lastErrorCount) >>> 0;
                if (difference > 0x80000000) difference = 0;
                const rateAlpha = 1 - Math.exp(-dt / 3);
                values.errorRate += rateAlpha * (difference / dt - values.errorRate);
            }
        }
        this.lastErrorCount = errorCount;
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
        if (nextMode !== previousMode) this.drawHud();
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            rd: this.rd, ss: this.ss, tx: this.tx, pr: this.pr,
            st: this.st, tn: this.tn, bw: this.bw, mp: this.mp,
            dl: this.dl, fd: this.fd, sm: this.sm, bz: this.bz,
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

    setParameters(params) {
        if (params === null || typeof params !== 'object') return;
        const setNumber = (key, minimum, maximum) => {
            if (params[key] === undefined) return;
            this[key] = this.parseFiniteNumber(params[key], minimum, maximum, this[key]);
        };
        setNumber('pr', 0, 18);
        setNumber('st', 0, 70);
        setNumber('tn', -200, 200);
        setNumber('bw', 80, 240);
        setNumber('mp', 0, 100);
        setNumber('dl', 0.5, 50);
        setNumber('fd', 0, 20);
        setNumber('bz', -80, -20);
        setNumber('og', -24, 24);
        setNumber('mx', 0, 100);
        if (params.ss !== undefined && TV_AUDIO_SIMULATOR_STANDARDS.includes(params.ss)) {
            this.ss = params.ss;
        }
        if (params.tx !== undefined && TV_AUDIO_SIMULATOR_TX_MODES.includes(params.tx)) {
            this.tx = params.tx;
        }
        if (params.sm !== undefined && TV_AUDIO_SIMULATOR_RECEIVE_MODES.includes(params.sm)) {
            this.sm = params.sm;
        }
        if (params.rd !== undefined) {
            this.rd = params.rd === true || params.rd === 1 || params.rd === 'true';
        }
        if (params.fr !== undefined) {
            this.fr = params.fr === true || params.fr === 1 || params.fr === 'true';
        }
        if (typeof params.enabled === 'boolean') this.enabled = params.enabled;
        this._refreshStandardDetail();
        this.updateParameters();
    }

    onMessage(message) {
        super.onMessage(message);
        this.ensureDspTelemetrySubscription();
        if (message?.type === 'dspExecutionState' && message.pluginId === this.id &&
            message.validated === true) {
            this.executionState = { state: message.state, reason: message.reason ?? null };
            this.executionStateReceived = true;
            return;
        }
        if (message?.type !== 'processBuffer' || message.pluginId !== this.id ||
            !message.measurements) return;
        if (message.measurements.bypass === true) {
            const now = performance.now();
            if (!this.bypassSince || this.lastTelemetryAt >= this.bypassSince) {
                this.bypassSince = now;
            }
            this.lastBypassAt = now;
        }
    }

    _refreshStandardDetail() {
        if (!this.standardDetailElement) return;
        this.standardDetailElement.textContent = TV_AUDIO_SIMULATOR_STANDARD_INFO[this.ss].detail;
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        this.stopAnimation();
        this.hudCreatedAt = performance.now();
        this.hudVisible = true;
        this.hudStatusElement = null;
        this.standardDetailElement = null;
        this.hudObserver?.disconnect();
        this.hudGraphDispose?.();
        this.hudGraphDispose = null;

        const container = document.createElement('div');
        const instanceId = `tv-audio-simulator-${Date.now()}-${++tvAudioSimulatorInstanceSerial}`;
        container.className = 'tv-audio-simulator-container';
        container.setAttribute('data-instance-id', instanceId);
        const panel = document.createElement('div');
        panel.className = 'tv-audio-simulator-panel';
        const tabs = document.createElement('div');
        tabs.className = 'tv-audio-simulator-tabs';
        tabs.setAttribute('role', 'tablist');
        const contents = document.createElement('div');
        contents.className = 'tv-audio-simulator-tab-contents';
        const definitions = [
            { id: 'standard', label: 'Standard', create: content => {
                content.appendChild(this.createRadioGroup('Standard', TV_AUDIO_SIMULATOR_STANDARDS,
                    this.ss, value => this.setParameters({ ss: value }), 'ss'));
                const standardDetail = document.createElement('p');
                standardDetail.className = 'tv-audio-simulator-standard-detail';
                standardDetail.setAttribute('role', 'status');
                standardDetail.setAttribute('aria-live', 'polite');
                this.standardDetailElement = standardDetail;
                this._refreshStandardDetail();
                content.appendChild(standardDetail);
            } },
            { id: 'programme', label: 'Programme', create: content => {
                content.appendChild(this.createCheckboxControl('Broadcast', this.rd,
                    value => this.setParameters({ rd: value }), 'rd'));
                content.appendChild(this.createRadioGroup('Tx Mode', TV_AUDIO_SIMULATOR_TX_MODES,
                    this.tx, value => this.setParameters({ tx: value }), 'tx'));
                content.appendChild(this.createRadioGroup('Receive Mode',
                    TV_AUDIO_SIMULATOR_RECEIVE_MODES, this.sm,
                    value => this.setParameters({ sm: value }), 'sm'));
                content.appendChild(this.createParameterControl('Processing', 0, 18, 0.1, this.pr,
                    value => this.setParameters({ pr: value }), 'dB', 'pr'));
            } },
            { id: 'reception', label: 'Reception', create: content => {
                content.appendChild(this.createParameterControl('Signal', 0, 70, 0.1, this.st,
                    value => this.setParameters({ st: value }), 'dBµV', 'st'));
                content.appendChild(this.createParameterControl('Tuning', -200, 200, 0.1, this.tn,
                    value => this.setParameters({ tn: value }), 'kHz', 'tn'));
                content.appendChild(this.createParameterControl('IF Band', 80, 240, 1, this.bw,
                    value => this.setParameters({ bw: value }), 'kHz', 'bw'));
                content.appendChild(this.createParameterControl('Multipath', 0, 100, 1, this.mp,
                    value => this.setParameters({ mp: value }), '%', 'mp'));
                content.appendChild(this.createLogarithmicParameterControl(
                    'Path Delay', 0.5, 50, 0.01, this.dl,
                    value => this.setParameters({ dl: value }), 'µs', 'dl'));
                content.appendChild(this.createParameterControl('Fading', 0, 20, 0.1, this.fd,
                    value => this.setParameters({ fd: value }), 'Hz', 'fd'));
            } },
            { id: 'video-buzz', label: 'Video Buzz', create: content => {
                content.appendChild(this.createParameterControl('Buzz', -80, -20, 1, this.bz,
                    value => this.setParameters({ bz: value }), 'dB', 'bz'));
            } },
            { id: 'output', label: 'Output', create: content => {
                content.appendChild(this.createParameterControl('Output Gain', -24, 24, 0.1, this.og,
                    value => this.setParameters({ og: value }), 'dB', 'og'));
                content.appendChild(this.createParameterControl('Mix', 0, 100, 1, this.mx,
                    value => this.setParameters({ mx: value }), '%', 'mx'));
            } }
        ];
        for (const definition of definitions) {
            const active = definition.id === this.selectedTab;
            const tab = document.createElement('button');
            const content = document.createElement('div');
            tab.type = 'button';
            tab.id = `${instanceId}-${definition.id}-tab`;
            tab.className = `tv-audio-simulator-tab ${active ? 'active' : ''}`;
            tab.textContent = definition.label;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.setAttribute('aria-controls', `${instanceId}-${definition.id}-panel`);
            content.id = `${instanceId}-${definition.id}-panel`;
            content.className = `tv-audio-simulator-tab-content plugin-parameter-ui ${active ? 'active' : ''}`;
            content.setAttribute('role', 'tabpanel');
            content.setAttribute('aria-labelledby', tab.id);
            content.hidden = !active;
            definition.create(content);
            tab.addEventListener('click', () => {
                tabs.querySelectorAll('.tv-audio-simulator-tab').forEach(item => {
                    const selected = item === tab;
                    item.classList.toggle('active', selected);
                    item.setAttribute('aria-selected', selected ? 'true' : 'false');
                });
                contents.querySelectorAll('.tv-audio-simulator-tab-content').forEach(item => {
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
            aspectRatio: '5 / 1',
            mobileAspectRatio: '2.2 / 1',
            className: 'tv-audio-simulator-hud',
            onResize: () => this.drawHud()
        });
        this.hudGraphDispose = graph.dispose;
        this.hudCanvas = graph.canvas;
        this.hudCanvas.setAttribute('aria-label', 'Television sound receiver status');
        container.appendChild(graph.container);
        graph.resize();

        const status = document.createElement('div');
        status.className = 'tv-audio-simulator-status-note';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
        this.hudStatusElement = status;
        container.appendChild(status);

        if (typeof IntersectionObserver === 'function') {
            this.hudObserver = new IntersectionObserver(entries => {
                this.hudVisible = entries.some(entry => entry.isIntersecting);
                if (this.hudVisible) this.startAnimation();
                else this.stopAnimation();
            });
            this.hudObserver.observe(this.hudCanvas);
        }
        this.startAnimation();
        this._graphReadout = window.GraphReadout?.attach({
            mount: graph.container,
            surface: this.hudCanvas,
            plot: () => {
                const frame = this._readoutFrame;
                return frame?.valid ? {
                    left: frame.plotLeft,
                    top: frame.plotTop,
                    width: frame.plotWidth,
                    height: frame.plotHeight
                } : null;
            },
            read: x => this._readHud(x)
        });
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
        const gateMode = this._hudGateMode();
        if (gateMode !== 'ready') return gateMode;
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

    _hudSignalLabel() {
        const info = TV_AUDIO_SIMULATOR_STANDARD_INFO[this.ss];
        if (info.am) return 'AM';
        if (info.nicam) {
            return this.hudValues.selectedBlend >= 0.5 ? 'NICAM' : 'FALLBACK';
        }
        return TVAudioSimulatorPlugin.resolveEffectiveMode(this.ss, this.tx, this.sm);
    }

    _spectrumMaximumHz() {
        const info = TV_AUDIO_SIMULATOR_STANDARD_INFO[this.ss];
        return info.am ? 10000 : (info.nicam ? 15000 : 60000);
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
        const mode = this._hudMode(performance.now());
        const idleMessages = {
            disabled: 'Effect is off',
            paused: 'Receiver display paused',
            loading: 'Initializing television sound processing…',
            idle: 'Waiting for audio',
            bypass: 'WASM is required; audio remains unchanged'
        };
        if (this.hudStatusElement) {
            this.hudStatusElement.textContent = mode === 'bypass' ?
                'The simulation engine is unavailable. The effect is bypassed and audio remains unchanged.' : '';
        }
        context.clearRect(0, 0, width, height);
        context.fillStyle = window.ThemePalette?.get('graph-bg-deep') ?? '';
        context.fillRect(0, 0, width, height);
        const frame = (this._readoutFrame ??= {});
        frame.valid = false;
        if (mode !== 'active') {
            context.fillStyle = mode === 'bypass' ?
                (window.ThemePalette?.get('warning') ?? '') :
                (window.ThemePalette?.get('graph-tone-89') ?? '');
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.font = `600 ${Math.round(13 * scale)}px Arial`;
            context.fillText(idleMessages[mode], width / 2, height / 2);
            this._graphReadout?.refresh();
            return;
        }

        const values = this.hudValues;
        const narrow = cssWidth < 560;
        const statusHeight = (narrow ? 42 : 25) * scale;
        const plotLeft = 40 * scale;
        const plotTop = 7 * scale;
        const plotRight = width - 8 * scale;
        const plotBottom = height - statusHeight - 15 * scale;
        const plotWidth = plotRight - plotLeft;
        const plotHeight = plotBottom - plotTop;
        if (plotWidth <= 0 || plotHeight <= 0) {
            this._graphReadout?.refresh();
            return;
        }

        const maximumHz = this._spectrumMaximumHz();
        const logSpan = Math.log(maximumHz / TV_AUDIO_SIMULATOR_SPECTRUM_MIN_HZ);
        const frequencyToX = frequency => plotLeft + plotWidth *
            Math.log(frequency / TV_AUDIO_SIMULATOR_SPECTRUM_MIN_HZ) / logSpan;
        const dbToY = db => {
            const clamped = db > 0 ? 0 :
                (db < TV_AUDIO_SIMULATOR_SPECTRUM_FLOOR_DB ?
                    TV_AUDIO_SIMULATOR_SPECTRUM_FLOOR_DB : db);
            return plotTop + plotHeight * (-clamped / -TV_AUDIO_SIMULATOR_SPECTRUM_FLOOR_DB);
        };
        context.lineWidth = scale;
        context.font = `${Math.round(10 * scale)}px Arial`;
        for (let db = 0; db >= TV_AUDIO_SIMULATOR_SPECTRUM_FLOOR_DB; db -= 20) {
            const y = dbToY(db);
            context.strokeStyle = window.ThemePalette?.get('graph-grid-subtle') ?? '';
            context.beginPath();
            context.moveTo(plotLeft, y);
            context.lineTo(plotRight, y);
            context.stroke();
            if (db % 40 === 0) {
                context.fillStyle = window.ThemePalette?.get('graph-label') ?? '';
                context.textAlign = 'right';
                context.textBaseline = 'middle';
                context.fillText(String(db), plotLeft - 4 * scale, y);
            }
        }
        const horizontal = this.ss.startsWith('M/') ? 15734 : 15625;
        const ticks = maximumHz === 60000 ?
            [[1000, '1k'], [10000, '10k'], [horizontal, 'fH'],
                [2 * horizontal, '2fH'], [53000, '53k']] :
            [[1000, '1k'], [5000, '5k'], [10000, '10k'], [maximumHz, `${maximumHz / 1000}k`]];
        for (const [frequency, label] of ticks) {
            if (frequency > maximumHz) continue;
            const x = frequencyToX(frequency);
            context.strokeStyle = window.ThemePalette?.get('graph-grid-subtle') ?? '';
            context.beginPath();
            context.moveTo(x, plotTop);
            context.lineTo(x, plotBottom);
            context.stroke();
            context.fillStyle = window.ThemePalette?.get('graph-label') ?? '';
            context.textAlign = 'center';
            context.textBaseline = 'top';
            context.fillText(label, x, plotBottom + 2 * scale);
        }

        const spectrum = values.spectrumDb;
        const bins = TV_AUDIO_SIMULATOR_SPECTRUM_BINS;
        context.beginPath();
        context.moveTo(plotLeft, plotBottom);
        for (let bin = 0; bin < bins; bin++) {
            const x = plotLeft + plotWidth * bin / (bins - 1);
            context.lineTo(x, dbToY(spectrum[bin]));
        }
        context.lineTo(plotRight, plotBottom);
        context.fillStyle = window.ThemePalette?.get('graph-trace-soft') ?? '';
        context.fill();
        context.beginPath();
        for (let bin = 0; bin < bins; bin++) {
            const x = plotLeft + plotWidth * bin / (bins - 1);
            const y = dbToY(spectrum[bin]);
            if (bin === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.strokeStyle = window.ThemePalette?.get('graph-trace') ?? '';
        context.lineWidth = 2 * scale;
        context.stroke();

        const info = TV_AUDIO_SIMULATOR_STANDARD_INFO[this.ss];
        Object.assign(frame, {
            valid: true, plotLeft, plotTop, plotWidth, plotHeight, maximumHz, spectrum, dbToY,
            label: info.spectrum
        });
        const label = this._hudSignalLabel();
        const multipath = values.multipathDb <= -119 ? '-∞' : values.multipathDb.toFixed(1);
        const status = `${this.ss}  ${label}  ${info.spectrum}  ` +
            `${values.carrierLevelDb.toFixed(1)} dBµV  CNR ${values.cnrDb.toFixed(1)} dB  ` +
            `Health ${Math.round(values.schemeHealth * 100)}%  ` +
            `MPath ${multipath} dB  Errors ${values.errorRate.toFixed(1)}/s`;
        const statusLines = narrow ? [
            `${this.ss}  ${label}  ${info.spectrum}`,
            `${values.carrierLevelDb.toFixed(1)} dBµV  CNR ${values.cnrDb.toFixed(1)} dB`,
            `Health ${Math.round(values.schemeHealth * 100)}%  ` +
                `MPath ${multipath} dB  Errors ${values.errorRate.toFixed(1)}/s`
        ] : [status];
        context.fillStyle = window.ThemePalette?.get('graph-tone-97') ?? '';
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.font = `${Math.round((narrow ? 9 : 11) * scale)}px Arial`;
        statusLines.forEach((line, index) => {
            const y = height - statusHeight +
                statusHeight * (index + 0.5) / statusLines.length;
            context.fillText(line, 8 * scale, y, width - 16 * scale);
        });
        this._graphReadout?.refresh();
    }

    // Reads the spectrum at canvas pixel x, interpolating between the drawn bins.
    _readHud(x) {
        const frame = this._readoutFrame;
        if (!frame?.valid) return null;
        const { format, columnValueAt } = window.GraphReadout;
        const db = columnValueAt(frame.spectrum,
            (x - frame.plotLeft) / frame.plotWidth * (frame.spectrum.length - 1)) ?? NaN;
        return {
            cursor: format.frequency(window.FrequencyAxis.positionToFrequency(x - frame.plotLeft,
                frame.plotWidth, TV_AUDIO_SIMULATOR_SPECTRUM_MIN_HZ, frame.maximumHz)),
            rows: [{ label: frame.label, color: 'var(--et-graph-trace)', value: format.db(db), y: frame.dbToY(db) }]
        };
    }

    cleanup() {
        this.disposeDspTelemetrySubscription();
        this.stopAnimation();
        this.hudObserver?.disconnect();
        this.hudObserver = null;
        this.hudGraphDispose?.();
        this.hudGraphDispose = null;
        this.hudCanvas = null;
        this.hudStatusElement = null;
        this.standardDetailElement = null;
        super.cleanup();
    }
}

window.TVAudioSimulatorPlugin = TVAudioSimulatorPlugin;
