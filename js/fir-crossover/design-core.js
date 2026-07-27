import FFT from '../utils/measurement-dsp/fft.js';

const MIN_MAGNITUDE = 1e-8;
const OCTAVE_DECIBELS = 20 * Math.log10(2);
const ALLOWED_TAPS = new Set([8192, 16384, 32768, 65536, 131072]);
const ALLOWED_SLOPES = new Set([24, 48, 72, 96, 144, 192, 288, 384]);
const designCache = new Map();
let fftBackend = null;

export function setFIRCrossoverFftBackend(backend = null) {
    if (backend !== null &&
        (typeof backend.realTransform !== 'function' ||
            typeof backend.inverseRealTransform !== 'function')) {
        throw new TypeError('FIR Crossover FFT backend is invalid');
    }
    fftBackend = backend;
}

function realTransform(input) {
    return fftBackend?.realTransform(input) || new FFT(input.length).realTransform(input);
}

function inverseRealTransform(real, imaginary, size) {
    return fftBackend?.inverseRealTransform(real, imaginary, size) ||
        new FFT(size).inverseRealTransform(real, imaginary);
}

function normalizeConfig(candidate = {}) {
    const taps = Number(candidate.taps);
    const phase = candidate.phase === 'lin' ? 'lin' : 'min';
    const sampleRate = Math.round(Number(candidate.sampleRate) || 48000);
    const bandCount = Math.max(2, Math.min(4, Math.round(Number(candidate.bandCount) || 2)));
    const maximumFrequency = sampleRate * 0.48;
    const frequencies = [2000, 4000, 8000].map((fallback, index) => {
        const value = Number(candidate.frequencies?.[index]);
        return Math.max(10, Math.min(maximumFrequency, Number.isFinite(value) ? value : fallback));
    });
    const activeCrossovers = bandCount - 1;
    for (let index = 0; index < activeCrossovers; index += 1) {
        const minimum = index === 0 ? 10 : frequencies[index - 1] + 1;
        const maximum = maximumFrequency - (activeCrossovers - index - 1);
        frequencies[index] = Math.max(minimum, Math.min(maximum, frequencies[index]));
    }
    const slopes = [24, 24, 24].map((fallback, index) => {
        const value = Math.abs(Math.round(Number(candidate.slopes?.[index])));
        return ALLOWED_SLOPES.has(value) ? value : fallback;
    });
    return {
        sampleRate: Math.max(8000, Math.min(768000, sampleRate)),
        taps: ALLOWED_TAPS.has(taps) ? taps : 32768,
        phase,
        bandCount,
        frequencies,
        slopes
    };
}

export function crossoverLowWeight(frequency, cutoff, slope) {
    if (!(frequency > 0)) return 1;
    const exponent = slope / OCTAVE_DECIBELS * Math.log(frequency / cutoff);
    if (exponent <= -36) return 1;
    if (exponent >= 36) return 0;
    return 1 / (1 + Math.exp(exponent));
}

export function crossoverBandMagnitudes(config, frequency) {
    const bands = new Float64Array(config.bandCount);
    let remainder = 1;
    for (let crossover = 0; crossover < config.bandCount - 1; crossover += 1) {
        const low = crossoverLowWeight(
            frequency,
            config.frequencies[crossover],
            config.slopes[crossover]
        );
        bands[crossover] = remainder * low;
        remainder *= 1 - low;
    }
    bands[config.bandCount - 1] = remainder;
    return bands;
}

function minimumPhaseForMagnitude(magnitudes, fftSize) {
    const logMagnitude = new Float64Array(magnitudes.length);
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
        logMagnitude[bin] = Math.log(Math.max(MIN_MAGNITUDE, magnitudes[bin]));
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
            const fraction = (index - fadeStart) / Math.max(1, taps - fadeStart - 1);
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

function synthesizeSpectrum(real, imaginary, config, window) {
    const fftSize = config.taps * 2;
    imaginary[0] = 0;
    imaginary[imaginary.length - 1] = 0;
    const time = inverseRealTransform(real, imaginary, fftSize);
    return Float32Array.from(
        { length: config.taps },
        (_, index) => time[index] * window[index]
    );
}

function cloneResult(result) {
    return {
        channels: result.channels.map(channel => Float32Array.from(channel)),
        config: {
            ...result.config,
            frequencies: [...result.config.frequencies],
            slopes: [...result.config.slopes]
        },
        latencyInfo: { ...result.latencyInfo }
    };
}

export function designFIRCrossover(candidate = {}) {
    const config = normalizeConfig(candidate);
    const cacheKey = JSON.stringify(config);
    const cached = designCache.get(cacheKey);
    if (cached) return cloneResult(cached);

    const fftSize = config.taps * 2;
    const targetMagnitudes = Array.from(
        { length: config.bandCount },
        () => new Float64Array(fftSize / 2 + 1)
    );
    for (let bin = 0; bin <= fftSize / 2; bin += 1) {
        const frequency = bin * config.sampleRate / fftSize;
        const weights = crossoverBandMagnitudes(config, frequency);
        for (let band = 0; band < config.bandCount; band += 1) {
            targetMagnitudes[band][bin] = weights[band];
        }
    }

    const window = createWindow(config.taps, config.phase);
    const realBands = Array.from(
        { length: config.bandCount },
        () => new Float64Array(fftSize / 2 + 1)
    );
    const imaginaryBands = Array.from(
        { length: config.bandCount },
        () => new Float64Array(fftSize / 2 + 1)
    );
    if (config.phase === 'lin') {
        for (let band = 0; band < config.bandCount; band += 1) {
            for (let bin = 0; bin <= fftSize / 2; bin += 1) {
                const magnitude = targetMagnitudes[band][bin];
                if ((bin & 3) === 0) realBands[band][bin] = magnitude;
                else if ((bin & 3) === 1) imaginaryBands[band][bin] = -magnitude;
                else if ((bin & 3) === 2) realBands[band][bin] = -magnitude;
                else imaginaryBands[band][bin] = magnitude;
            }
        }
    } else {
        const bandPhases = targetMagnitudes.map(magnitude =>
            minimumPhaseForMagnitude(magnitude, fftSize));
        for (let band = 0; band < config.bandCount; band += 1) {
            for (let bin = 0; bin <= fftSize / 2; bin += 1) {
                const magnitude = targetMagnitudes[band][bin];
                const phase = bandPhases[band][bin];
                realBands[band][bin] = magnitude * Math.cos(phase);
                imaginaryBands[band][bin] = magnitude * Math.sin(phase);
            }
        }
    }
    const channels = realBands.map((real, band) =>
        synthesizeSpectrum(real, imaginaryBands[band], config, window));
    const reconstructionDelay = config.phase === 'min' ? 0 : config.taps / 2;
    if (config.phase === 'lin') {
        const last = channels[channels.length - 1];
        for (let index = 0; index < config.taps; index += 1) {
            let value = index === reconstructionDelay ? 1 : 0;
            for (let band = 0; band < channels.length - 1; band += 1) {
                value -= channels[band][index];
            }
            last[index] = value;
        }
    }

    const result = {
        channels,
        config,
        latencyInfo: {
            filterDelaySamples: config.phase === 'min' ? 0 : config.taps / 2,
            resolutionHz: config.sampleRate / config.taps
        }
    };
    designCache.set(cacheKey, cloneResult(result));
    if (designCache.size > 2) designCache.delete(designCache.keys().next().value);
    return result;
}
