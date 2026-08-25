import FFT from '../utils/measurement-dsp/fft.js';
import { smoothFrequencyResponse } from '../utils/measurement-dsp/smoothing.js';

const MAGNITUDE_FLOOR_AMPLITUDE = 1e-6;
const REFERENCE_FREQUENCY_HZ = 1000;
const CEPSTRAL_FFT_PADDING_FACTOR = 4;

function nextPowerOfTwo(value) {
    let result = 1;
    while (result < value) result *= 2;
    return result;
}

function interpolateLinear(values, sourceRate, fftSize, frequencies, valid = null) {
    const result = new Float64Array(frequencies.length);
    const resultValid = new Uint8Array(frequencies.length);
    for (let index = 0; index < frequencies.length; index += 1) {
        const position = frequencies[index] * fftSize / sourceRate;
        let lower = Math.floor(position);
        if (lower < 0) lower = 0;
        if (lower >= values.length - 1) lower = values.length - 1;
        const upper = lower < values.length - 1 ? lower + 1 : lower;
        const fraction = upper === lower ? 0 : position - lower;
        const lowerValid = valid === null || valid[lower] !== 0;
        const upperValid = valid === null || valid[upper] !== 0;
        const exactLower = Math.abs(fraction) < 1e-10;
        const exactUpper = Math.abs(1 - fraction) < 1e-10;
        if (exactUpper) {
            if (!upperValid || !Number.isFinite(values[upper])) {
                result[index] = Number.NaN;
                continue;
            }
            result[index] = values[upper];
            resultValid[index] = 1;
            continue;
        }
        if (!lowerValid || !Number.isFinite(values[lower]) ||
            (!exactLower && (!upperValid || !Number.isFinite(values[upper])))) {
            result[index] = Number.NaN;
            continue;
        }
        result[index] = exactLower
            ? values[lower]
            : values[lower] + fraction * (values[upper] - values[lower]);
        resultValid[index] = 1;
    }
    return { values: result, valid: resultValid };
}

function minimumPhaseGroupDelaySamples(magnitudes, fftSize, magnitudeFloor) {
    const logMagnitude = new Float64Array(magnitudes.length);
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
        const magnitude = magnitudes[bin] > magnitudeFloor
            ? magnitudes[bin]
            : magnitudeFloor;
        logMagnitude[bin] = Math.log(magnitude);
    }
    const fft = new FFT(fftSize);
    const cepstrum = fft.inverseRealTransform(logMagnitude);
    for (let index = 1; index < fftSize / 2; index += 1) cepstrum[index] *= 2;
    for (let index = fftSize / 2 + 1; index < fftSize; index += 1) cepstrum[index] = 0;
    const derivative = new Float64Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
        derivative[index] = cepstrum[index] * index;
    }
    return fft.realTransform(derivative).real;
}

export function minimumPhaseGroupDelaySecondsFromMagnitudes(
    magnitudes,
    sampleRate,
    sourceFftSize
) {
    if (magnitudes.length !== sourceFftSize / 2 + 1) {
        throw new RangeError('Magnitude spectrum length does not match its FFT size');
    }
    const fftSize = sourceFftSize * CEPSTRAL_FFT_PADDING_FACTOR;
    const factor = fftSize / sourceFftSize;
    const paddedMagnitudes = new Float64Array(fftSize / 2 + 1);
    let peak = 0;
    for (const magnitude of magnitudes) {
        if (Number.isFinite(magnitude) && magnitude > peak) peak = magnitude;
    }
    const magnitudeFloor = Math.max(Number.MIN_VALUE, peak * MAGNITUDE_FLOOR_AMPLITUDE);
    for (let bin = 0; bin < paddedMagnitudes.length; bin += 1) {
        const position = bin / factor;
        const lower = Math.min(magnitudes.length - 1, Math.floor(position));
        const upper = Math.min(magnitudes.length - 1, lower + 1);
        const fraction = upper === lower ? 0 : position - lower;
        const lowerMagnitude = magnitudes[lower] > magnitudeFloor
            ? magnitudes[lower]
            : magnitudeFloor;
        const upperMagnitude = magnitudes[upper] > magnitudeFloor
            ? magnitudes[upper]
            : magnitudeFloor;
        paddedMagnitudes[bin] = Math.exp(
            Math.log(lowerMagnitude) * (1 - fraction) +
            Math.log(upperMagnitude) * fraction
        );
    }
    const paddedDelays = minimumPhaseGroupDelaySamples(
        paddedMagnitudes,
        fftSize,
        magnitudeFloor
    );
    return Float64Array.from(magnitudes, (_, bin) =>
        paddedDelays[bin * factor] / sampleRate);
}

export function smoothRoomEqGroupDelayRuns(frequencies, values, valid, smoothing) {
    const output = Float64Array.from(values);
    let first = 0;
    while (first < output.length) {
        while (first < output.length && !(valid[first] && Number.isFinite(output[first]))) {
            output[first] = Number.NaN;
            first += 1;
        }
        let last = first;
        while (last < output.length && valid[last] && Number.isFinite(output[last])) last += 1;
        if (last > first) {
            const run = [];
            for (let index = first; index < last; index += 1) {
                run.push([frequencies[index], output[index]]);
            }
            const smoothed = smoothFrequencyResponse(run, smoothing);
            for (let index = first; index < last; index += 1) {
                output[index] = smoothed[index - first][1];
            }
        }
        first = last;
    }
    return output;
}

function interpolateAtFrequency(values, frequencies, valid, frequency) {
    let upper = 0;
    while (upper < frequencies.length && frequencies[upper] < frequency) upper += 1;
    if (upper === 0) return valid[0] ? values[0] : 0;
    if (upper >= frequencies.length) {
        const last = frequencies.length - 1;
        return valid[last] ? values[last] : 0;
    }
    const lower = upper - 1;
    if (!valid[lower] || !valid[upper]) return 0;
    const fraction = (frequency - frequencies[lower]) /
        (frequencies[upper] - frequencies[lower]);
    return values[lower] + fraction * (values[upper] - values[lower]);
}

/**
 * Room EQ's independent group-delay analysis. The total delay is evaluated from
 * H and the transform of n*h[n], so it never has to select a phase-unwrapping branch.
 * Four-times zero padding also keeps the real-cepstrum minimum-phase factorization
 * from wrapping its long tail back into the measured group delay.
 */
export function analyzeRoomEqGroupDelay(
    samples,
    alignmentSamples,
    sampleRate,
    frequencies,
    options = {}
) {
    const fftSize = nextPowerOfTwo(Math.max(
        samples.length * CEPSTRAL_FFT_PADDING_FACTOR,
        Number.isSafeInteger(options.minimumFftSize) ? options.minimumFftSize : 0,
        4
    ));
    const input = new Float64Array(fftSize);
    input.set(samples);
    const spectrum = options.spectrum?.real?.length === fftSize / 2 + 1 &&
        options.spectrum?.imag?.length === fftSize / 2 + 1
        ? options.spectrum
        : new FFT(fftSize).realTransform(input);
    const ramped = new Float64Array(fftSize);
    for (let index = 0; index < samples.length; index += 1) {
        ramped[index] = samples[index] * index;
    }
    const rampedSpectrum = new FFT(fftSize).realTransform(ramped);
    const magnitudes = new Float64Array(spectrum.real.length);
    let peak = 0;
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
        const magnitude = Math.hypot(spectrum.real[bin], spectrum.imag[bin]);
        magnitudes[bin] = magnitude;
        if (magnitude > peak) peak = magnitude;
    }
    const magnitudeFloor = Math.max(Number.MIN_VALUE, peak * MAGNITUDE_FLOOR_AMPLITUDE);
    const spectrumValid = new Uint8Array(magnitudes.length);
    const totalSamples = new Float64Array(magnitudes.length);
    totalSamples.fill(Number.NaN);
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
        if (!(magnitudes[bin] > magnitudeFloor)) continue;
        const power = spectrum.real[bin] * spectrum.real[bin] +
            spectrum.imag[bin] * spectrum.imag[bin];
        if (!(power > 0)) continue;
        spectrumValid[bin] = 1;
        totalSamples[bin] = (
            rampedSpectrum.real[bin] * spectrum.real[bin] +
            rampedSpectrum.imag[bin] * spectrum.imag[bin]
        ) / power - alignmentSamples;
    }
    const minimumSamples = minimumPhaseGroupDelaySamples(
        magnitudes,
        fftSize,
        magnitudeFloor
    );
    const totalGrid = interpolateLinear(
        totalSamples,
        sampleRate,
        fftSize,
        frequencies,
        spectrumValid
    );
    const minimumGrid = interpolateLinear(
        minimumSamples,
        sampleRate,
        fftSize,
        frequencies,
        spectrumValid
    );
    const valid = new Uint8Array(frequencies.length);
    const totalMs = new Float64Array(frequencies.length);
    const minimumMs = new Float64Array(frequencies.length);
    const excessMs = new Float64Array(frequencies.length);
    const scale = 1000 / sampleRate;
    for (let index = 0; index < frequencies.length; index += 1) {
        if (!totalGrid.valid[index] || !minimumGrid.valid[index]) {
            totalMs[index] = Number.NaN;
            minimumMs[index] = Number.NaN;
            excessMs[index] = Number.NaN;
            continue;
        }
        valid[index] = 1;
        totalMs[index] = totalGrid.values[index] * scale;
        minimumMs[index] = minimumGrid.values[index] * scale;
        excessMs[index] = totalMs[index] - minimumMs[index];
    }
    return {
        fftSize,
        spectrum,
        magnitudeFloor,
        valid,
        totalMs,
        minimumMs,
        excessMs
    };
}

export function smoothAndReferenceRoomEqGroupDelay(analysis, frequencies, smoothing) {
    const smoothed = smoothRoomEqGroupDelay(analysis, frequencies, smoothing);
    const totalReference = interpolateAtFrequency(
        smoothed.total,
        frequencies,
        smoothed.valid,
        REFERENCE_FREQUENCY_HZ
    );
    const minimumReference = interpolateAtFrequency(
        smoothed.minimum,
        frequencies,
        smoothed.valid,
        REFERENCE_FREQUENCY_HZ
    );
    const excessReference = totalReference - minimumReference;
    return {
        valid: smoothed.valid,
        total: Float32Array.from(smoothed.total, value => value - totalReference),
        minimum: Float32Array.from(smoothed.minimum, value => value - minimumReference),
        excess: Float32Array.from(smoothed.excess, value => value - excessReference)
    };
}

export function smoothRoomEqGroupDelay(analysis, frequencies, smoothing) {
    const total = smoothRoomEqGroupDelayRuns(
        frequencies,
        analysis.totalMs,
        analysis.valid,
        smoothing
    );
    const minimum = smoothRoomEqGroupDelayRuns(
        frequencies,
        analysis.minimumMs,
        analysis.valid,
        smoothing
    );
    const excess = new Float64Array(frequencies.length);
    for (let index = 0; index < excess.length; index += 1) {
        excess[index] = analysis.valid[index] ? total[index] - minimum[index] : Number.NaN;
    }
    return {
        valid: Uint8Array.from(analysis.valid),
        total: Float32Array.from(total),
        minimum: Float32Array.from(minimum),
        excess: Float32Array.from(excess)
    };
}

export function combineRoomEqGroupDelay(first, second) {
    if (first.valid.length !== second.valid.length) {
        throw new RangeError('Group-delay analyses must use the same frequency grid');
    }
    const valid = new Uint8Array(first.valid.length);
    const totalMs = new Float64Array(valid.length);
    const minimumMs = new Float64Array(valid.length);
    const excessMs = new Float64Array(valid.length);
    for (let index = 0; index < valid.length; index += 1) {
        if (!first.valid[index] || !second.valid[index]) {
            totalMs[index] = Number.NaN;
            minimumMs[index] = Number.NaN;
            excessMs[index] = Number.NaN;
            continue;
        }
        valid[index] = 1;
        totalMs[index] = first.totalMs[index] + second.totalMs[index];
        minimumMs[index] = first.minimumMs[index] + second.minimumMs[index];
        excessMs[index] = totalMs[index] - minimumMs[index];
    }
    return { valid, totalMs, minimumMs, excessMs };
}

export function averageRoomEqGroupDelay(analyses) {
    if (!Array.isArray(analyses) || analyses.length === 0) {
        throw new RangeError('At least one group-delay analysis is required');
    }
    const length = analyses[0].valid.length;
    if (analyses.some(analysis => analysis.valid.length !== length)) {
        throw new RangeError('Group-delay analyses must use the same frequency grid');
    }
    const valid = new Uint8Array(length);
    const totalMs = new Float64Array(length);
    const minimumMs = new Float64Array(length);
    const excessMs = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
        let total = 0;
        let minimum = 0;
        let count = 0;
        for (const analysis of analyses) {
            if (!analysis.valid[index]) continue;
            total += analysis.totalMs[index];
            minimum += analysis.minimumMs[index];
            count += 1;
        }
        if (count === 0) {
            totalMs[index] = Number.NaN;
            minimumMs[index] = Number.NaN;
            excessMs[index] = Number.NaN;
            continue;
        }
        valid[index] = 1;
        totalMs[index] = total / count;
        minimumMs[index] = minimum / count;
        excessMs[index] = totalMs[index] - minimumMs[index];
    }
    return { valid, totalMs, minimumMs, excessMs };
}

export function integrateRoomEqGroupDelayPhase(
    frequencies,
    delaysSeconds,
    valid,
    wrappedPhase,
    referenceFrequency = REFERENCE_FREQUENCY_HZ
) {
    const phase = Float64Array.from(wrappedPhase);
    let first = 0;
    while (first < phase.length) {
        while (first < phase.length && !valid[first]) first += 1;
        let last = first;
        while (last + 1 < phase.length && valid[last + 1]) last += 1;
        if (first >= phase.length) break;
        let anchor = first;
        for (let index = first + 1; index <= last; index += 1) {
            if (Math.abs(frequencies[index] - referenceFrequency) <
                Math.abs(frequencies[anchor] - referenceFrequency)) anchor = index;
        }
        for (let index = anchor + 1; index <= last; index += 1) {
            const deltaOmega = 2 * Math.PI * (frequencies[index] - frequencies[index - 1]);
            phase[index] = phase[index - 1] - 0.5 * (
                delaysSeconds[index - 1] + delaysSeconds[index]
            ) * deltaOmega;
        }
        for (let index = anchor - 1; index >= first; index -= 1) {
            const deltaOmega = 2 * Math.PI * (frequencies[index + 1] - frequencies[index]);
            phase[index] = phase[index + 1] + 0.5 * (
                delaysSeconds[index] + delaysSeconds[index + 1]
            ) * deltaOmega;
        }
        first = last + 1;
    }
    return phase;
}
