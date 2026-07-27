import FFT from '../utils/measurement-dsp/fft.js';

const MIN_MAGNITUDE = 1e-8;
const VERIFICATION_FLOOR = 1e-4;
const ALLOWED_TAPS = new Set([8192, 16384, 32768, 65536, 131072]);
const ALLOWED_TYPES = new Set(['pk', 'lp', 'hp', 'ls', 'hs', 'bp', 'no']);
const SLOPE_TYPES = new Set(['lp', 'hp']);
const DEFAULT_FREQUENCIES = [100, 316, 1000, 3160, 10000];
const RESPONSE_LOW_FREQUENCY = 10;
const RESPONSE_HIGH_FREQUENCY = 40000;
const RESPONSE_POINTS = 512;
const designCache = new Map();
let fftBackend = null;

export function setFiveBandFirPeqFftBackend(backend = null) {
    if (backend !== null &&
        (typeof backend.realTransform !== 'function' ||
            typeof backend.inverseRealTransform !== 'function')) {
        throw new TypeError('5Band FIR PEQ FFT backend is invalid');
    }
    fftBackend = backend;
    designCache.clear();
}

function realTransform(input) {
    return fftBackend?.realTransform(input) || new FFT(input.length).realTransform(input);
}

function inverseRealTransform(real, imaginary, size) {
    return fftBackend?.inverseRealTransform(real, imaginary, size) ||
        new FFT(size).inverseRealTransform(real, imaginary);
}

function finiteNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    if (number < minimum) return minimum;
    return number > maximum ? maximum : number;
}

function normalizeConfig(candidate = {}) {
    const requestedSampleRate = Math.round(Number(candidate.sampleRate) || 48000);
    const sampleRate = requestedSampleRate < 8000
        ? 8000
        : requestedSampleRate > 768000
            ? 768000
            : requestedSampleRate;
    const nyquistLimit = sampleRate * 0.49;
    const maximumFrequency = nyquistLimit < 20000 ? nyquistLimit : 20000;
    const bands = DEFAULT_FREQUENCIES.map((frequency, index) => {
        const band = candidate.eqBands?.[index] || {};
        return {
            enabled: band.enabled !== false,
            type: ALLOWED_TYPES.has(band.type) ? band.type : 'pk',
            frequency: finiteNumber(
                band.frequency,
                20,
                maximumFrequency,
                frequency < maximumFrequency ? frequency : maximumFrequency
            ),
            gain: finiteNumber(band.gain, -20, 20, 0),
            q: finiteNumber(band.q, 0.1, 100, 0.7),
            slope: finiteNumber(band.slope, 0.1, 384, 12)
        };
    });
    const taps = Number(candidate.taps);
    return {
        sampleRate,
        taps: ALLOWED_TAPS.has(taps) ? taps : 32768,
        phase: candidate.phase === 'lin' ? 'lin' : 'min',
        eqBands: bands
    };
}

function rbjCoefficients(band, sampleRate) {
    const maximumCenter = sampleRate * 0.49;
    const center = band.frequency < maximumCenter ? band.frequency : maximumCenter;
    const omega = 2 * Math.PI * center / sampleRate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    const amplitude = 10 ** (band.gain / 40);
    const alpha = sine / (2 * band.q);
    const root = Math.sqrt(amplitude);
    let b0;
    let b1;
    let b2;
    let a0;
    let a1;
    let a2;
    if (band.type === 'lp') {
        b0 = (1 - cosine) / 2;
        b1 = 1 - cosine;
        b2 = (1 - cosine) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosine;
        a2 = 1 - alpha;
    } else if (band.type === 'hp') {
        b0 = (1 + cosine) / 2;
        b1 = -(1 + cosine);
        b2 = (1 + cosine) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosine;
        a2 = 1 - alpha;
    } else if (band.type === 'ls') {
        b0 = amplitude *
            ((amplitude + 1) - (amplitude - 1) * cosine + 2 * root * alpha);
        b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine);
        b2 = amplitude *
            ((amplitude + 1) - (amplitude - 1) * cosine - 2 * root * alpha);
        a0 = (amplitude + 1) + (amplitude - 1) * cosine + 2 * root * alpha;
        a1 = -2 * ((amplitude - 1) + (amplitude + 1) * cosine);
        a2 = (amplitude + 1) + (amplitude - 1) * cosine - 2 * root * alpha;
    } else if (band.type === 'hs') {
        b0 = amplitude *
            ((amplitude + 1) + (amplitude - 1) * cosine + 2 * root * alpha);
        b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine);
        b2 = amplitude *
            ((amplitude + 1) + (amplitude - 1) * cosine - 2 * root * alpha);
        a0 = (amplitude + 1) - (amplitude - 1) * cosine + 2 * root * alpha;
        a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cosine);
        a2 = (amplitude + 1) - (amplitude - 1) * cosine - 2 * root * alpha;
    } else if (band.type === 'bp') {
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cosine;
        a2 = 1 - alpha;
    } else if (band.type === 'no') {
        b0 = 1;
        b1 = -2 * cosine;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cosine;
        a2 = 1 - alpha;
    } else {
        b0 = 1 + alpha * amplitude;
        b1 = -2 * cosine;
        b2 = 1 - alpha * amplitude;
        a0 = 1 + alpha / amplitude;
        a1 = -2 * cosine;
        a2 = 1 - alpha / amplitude;
    }
    const inverseA0 = 1 / a0;
    return {
        b0: b0 * inverseA0,
        b1: b1 * inverseA0,
        b2: b2 * inverseA0,
        a1: a1 * inverseA0,
        a2: a2 * inverseA0
    };
}

function coefficientMagnitude(coefficients, frequency, sampleRate) {
    const omega = 2 * Math.PI * frequency / sampleRate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    const doubleCosine = Math.cos(2 * omega);
    const doubleSine = Math.sin(2 * omega);
    const numeratorReal = coefficients.b0 +
        coefficients.b1 * cosine + coefficients.b2 * doubleCosine;
    const numeratorImaginary =
        -coefficients.b1 * sine - coefficients.b2 * doubleSine;
    const denominatorReal = 1 +
        coefficients.a1 * cosine + coefficients.a2 * doubleCosine;
    const denominatorImaginary =
        -coefficients.a1 * sine - coefficients.a2 * doubleSine;
    const numerator = Math.hypot(numeratorReal, numeratorImaginary);
    const denominator = Math.hypot(denominatorReal, denominatorImaginary);
    return (numerator > MIN_MAGNITUDE ? numerator : MIN_MAGNITUDE) /
        (denominator > MIN_MAGNITUDE ? denominator : MIN_MAGNITUDE);
}

export function fiveBandFirPeqMagnitude(type, frequency, {
    sampleRate = 48000,
    center = 1000,
    gain = 0,
    q = 0.7,
    slope = 12
} = {}) {
    const band = {
        type: ALLOWED_TYPES.has(type) ? type : 'pk',
        frequency: center,
        gain,
        q,
        slope
    };
    const magnitude = coefficientMagnitude(
        rbjCoefficients(band, sampleRate),
        frequency,
        sampleRate
    );
    return SLOPE_TYPES.has(band.type) && magnitude < 1
        ? magnitude ** (finiteNumber(band.slope, 0.1, 384, 12) / 12)
        : magnitude;
}

function minimumPhaseForMagnitude(magnitudes, fftSize) {
    const logMagnitude = new Float64Array(magnitudes.length);
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
        const magnitude = magnitudes[bin];
        logMagnitude[bin] = Math.log(
            magnitude > MIN_MAGNITUDE ? magnitude : MIN_MAGNITUDE
        );
    }
    const cepstrum = inverseRealTransform(
        logMagnitude,
        new Float64Array(logMagnitude.length),
        fftSize
    );
    for (let index = 1; index < fftSize / 2; index += 1) cepstrum[index] *= 2;
    for (let index = fftSize / 2 + 1; index < fftSize; index += 1) cepstrum[index] = 0;
    return realTransform(cepstrum).imag;
}

function createWindow(taps, phase) {
    const window = new Float64Array(taps).fill(1);
    if (phase === 'min') {
        const fadeStart = Math.floor(taps * 0.9);
        for (let index = fadeStart; index < taps; index += 1) {
            const fadeLength = taps - fadeStart - 1;
            const fraction = (index - fadeStart) / (fadeLength > 1 ? fadeLength : 1);
            window[index] = 0.5 + 0.5 * Math.cos(Math.PI * fraction);
        }
        return window;
    }
    const edge = taps * 0.05;
    for (let index = 0; index < taps; index += 1) {
        if (index < edge) window[index] = 0.5 - 0.5 * Math.cos(Math.PI * index / edge);
        else if (index > taps - edge) {
            window[index] = 0.5 - 0.5 * Math.cos(Math.PI * (taps - index) / edge);
        }
    }
    return window;
}

function responseFrequencies(sampleRate) {
    const highest = sampleRate * 0.5 < RESPONSE_HIGH_FREQUENCY
        ? sampleRate * 0.5
        : RESPONSE_HIGH_FREQUENCY;
    const frequencies = new Float64Array(RESPONSE_POINTS);
    const step = Math.log10(highest / RESPONSE_LOW_FREQUENCY) / (RESPONSE_POINTS - 1);
    for (let point = 0; point < RESPONSE_POINTS; point += 1) {
        frequencies[point] = RESPONSE_LOW_FREQUENCY * 10 ** (step * point);
    }
    return frequencies;
}

function sampleAtFrequency(values, frequency, fftSize, sampleRate) {
    const position = frequency * fftSize / sampleRate;
    const lower = Math.floor(position);
    const upper = lower + 1;
    if (upper >= values.length) return values[values.length - 1];
    return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

function measureMagnitudeResponse(taps, intended, config) {
    const input = new Float64Array(config.taps * 2);
    input.set(taps);
    const spectrum = realTransform(input);
    const realizedMagnitudes = new Float64Array(spectrum.real.length);
    const maximumVerificationFrequency = config.sampleRate * 0.45;
    const highFrequency = maximumVerificationFrequency < 20000
        ? maximumVerificationFrequency
        : 20000;
    let maximumErrorDb = 0;
    for (let bin = 0; bin < spectrum.real.length; bin += 1) {
        const measured = Math.hypot(spectrum.real[bin], spectrum.imag[bin]);
        realizedMagnitudes[bin] = measured;
        if (bin === 0) continue;
        const frequency = bin * config.sampleRate / input.length;
        if (frequency < 20 || frequency > highFrequency) continue;
        const actual = measured > VERIFICATION_FLOOR ? measured : VERIFICATION_FLOOR;
        const intendedMagnitude = intended[bin];
        const target = intendedMagnitude > VERIFICATION_FLOOR
            ? intendedMagnitude
            : VERIFICATION_FLOOR;
        const error = Math.abs(20 * Math.log10(actual / target));
        if (error > maximumErrorDb) maximumErrorDb = error;
    }

    const frequencies = responseFrequencies(config.sampleRate);
    const targetDb = new Float64Array(frequencies.length);
    const realizedDb = new Float64Array(frequencies.length);
    for (let point = 0; point < frequencies.length; point += 1) {
        const frequency = frequencies[point];
        const target = sampleAtFrequency(
            intended,
            frequency,
            input.length,
            config.sampleRate
        );
        const realized = sampleAtFrequency(
            realizedMagnitudes,
            frequency,
            input.length,
            config.sampleRate
        );
        targetDb[point] = 20 * Math.log10(target > MIN_MAGNITUDE ? target : MIN_MAGNITUDE);
        realizedDb[point] = 20 * Math.log10(
            realized > MIN_MAGNITUDE ? realized : MIN_MAGNITUDE
        );
    }
    return {
        maximumErrorDb,
        response: { frequencies, targetDb, realizedDb }
    };
}

function cloneResult(result) {
    return {
        channels: result.channels.map(channel => Float32Array.from(channel)),
        qualityWarnings: [...result.qualityWarnings],
        latencyInfo: { ...result.latencyInfo },
        response: {
            frequencies: Float64Array.from(result.response.frequencies),
            targetDb: Float64Array.from(result.response.targetDb),
            realizedDb: Float64Array.from(result.response.realizedDb)
        },
        config: {
            ...result.config,
            eqBands: result.config.eqBands.map(band => ({ ...band }))
        }
    };
}

export function designFiveBandFirPeq(candidate = {}) {
    const config = normalizeConfig(candidate);
    const cacheKey = JSON.stringify(config);
    const cached = designCache.get(cacheKey);
    if (cached) return cloneResult(cached);

    const fftSize = config.taps * 2;
    const magnitudes = new Float64Array(fftSize / 2 + 1).fill(1);
    const activeBands = config.eqBands
        .filter(band => band.enabled)
        .filter(band => ['lp', 'hp', 'bp', 'no'].includes(band.type) || band.gain !== 0)
        .map(band => ({
            coefficients: rbjCoefficients(band, config.sampleRate),
            exponent: SLOPE_TYPES.has(band.type) ? band.slope / 12 : 1
        }));
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
        const frequency = bin * config.sampleRate / fftSize;
        let magnitude = 1;
        for (const band of activeBands) {
            const bandMagnitude = coefficientMagnitude(
                band.coefficients,
                frequency,
                config.sampleRate
            );
            magnitude *= band.exponent !== 1 && bandMagnitude < 1
                ? bandMagnitude ** band.exponent
                : bandMagnitude;
        }
        magnitudes[bin] = magnitude > MIN_MAGNITUDE ? magnitude : MIN_MAGNITUDE;
    }

    const real = new Float64Array(magnitudes.length);
    const imaginary = new Float64Array(magnitudes.length);
    if (config.phase === 'lin') {
        for (let bin = 0; bin < magnitudes.length; bin += 1) {
            const magnitude = magnitudes[bin];
            if ((bin & 3) === 0) real[bin] = magnitude;
            else if ((bin & 3) === 1) imaginary[bin] = -magnitude;
            else if ((bin & 3) === 2) real[bin] = -magnitude;
            else imaginary[bin] = magnitude;
        }
    } else {
        const phase = minimumPhaseForMagnitude(magnitudes, fftSize);
        for (let bin = 0; bin < magnitudes.length; bin += 1) {
            real[bin] = magnitudes[bin] * Math.cos(phase[bin]);
            imaginary[bin] = magnitudes[bin] * Math.sin(phase[bin]);
        }
    }
    imaginary[0] = 0;
    imaginary[imaginary.length - 1] = 0;
    const time = inverseRealTransform(real, imaginary, fftSize);
    const window = createWindow(config.taps, config.phase);
    const taps = Float32Array.from(
        { length: config.taps },
        (_, index) => time[index] * window[index]
    );
    const { maximumErrorDb, response } = measureMagnitudeResponse(taps, magnitudes, config);
    const result = {
        channels: [taps],
        qualityWarnings: maximumErrorDb > 0.5 ? ['filterAccuracy'] : [],
        latencyInfo: {
            filterDelaySamples: config.phase === 'min' ? 0 : config.taps / 2,
            resolutionHz: config.sampleRate / config.taps
        },
        response,
        config
    };
    designCache.set(cacheKey, cloneResult(result));
    if (designCache.size > 2) designCache.delete(designCache.keys().next().value);
    return result;
}
