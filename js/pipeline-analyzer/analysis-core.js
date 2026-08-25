import FFT from '../utils/measurement-dsp/fft.js';
import { resampleWindowedSinc } from '../utils/measurement-dsp/resample.js';
import { createLogFrequencyGrid } from '../utils/measurement-dsp/smoothing.js';

export const ANALYSIS_QUANTUM_SIZE = 128;
export const ANALYSIS_TAIL_WINDOW_SAMPLES = 16384;
export const ANALYSIS_TAIL_RELATIVE_DB = -140;
export const ANALYSIS_MAGNITUDE_FLOOR_DB = -120;

const TAIL_RELATIVE_AMPLITUDE = 10 ** (ANALYSIS_TAIL_RELATIVE_DB / 20);
const MAGNITUDE_FLOOR_AMPLITUDE = 10 ** (ANALYSIS_MAGNITUDE_FLOOR_DB / 20);
const DIRECT_CONVOLUTION_LIMIT = 262144;
const PERIODIC_RESIDUAL_WARNING_DB = -60;
const DISPLAY_SMOOTHING_GRID_SPACING_OCTAVES = 0.01;

function assertFloatArray(value, label) {
    if (!(value instanceof Float32Array) && !(value instanceof Float64Array)) {
        throw new TypeError(`${label} must be a floating-point array`);
    }
}

function nextPowerOfTwo(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError('FFT length must be a positive safe integer');
    }
    let result = 1;
    while (result < value) result *= 2;
    if (!Number.isSafeInteger(result)) throw new RangeError('FFT length is too large');
    return result;
}

function circularCrossCorrelation(output, excitation) {
    assertFloatArray(output, 'MLS output period');
    assertFloatArray(excitation, 'MLS excitation period');
    if (output.length === 0 || output.length !== excitation.length) {
        throw new TypeError('MLS periods must have matching non-zero lengths');
    }
    const period = output.length;
    const fftSize = nextPowerOfTwo(period * 2 - 1);
    const outputInput = new Float64Array(fftSize);
    const reversedInput = new Float64Array(fftSize);
    outputInput.set(output);
    reversedInput[0] = excitation[0];
    for (let index = 1; index < period; index += 1) {
        reversedInput[index] = excitation[period - index];
    }
    const fft = new FFT(fftSize);
    const outputSpectrum = fft.realTransform(outputInput);
    const inputSpectrum = fft.realTransform(reversedInput);
    const productReal = new Float64Array(outputSpectrum.real.length);
    const productImag = new Float64Array(outputSpectrum.imag.length);
    for (let index = 0; index < productReal.length; index += 1) {
        productReal[index] = outputSpectrum.real[index] * inputSpectrum.real[index] -
            outputSpectrum.imag[index] * inputSpectrum.imag[index];
        productImag[index] = outputSpectrum.real[index] * inputSpectrum.imag[index] +
            outputSpectrum.imag[index] * inputSpectrum.real[index];
    }
    const linear = fft.inverseRealTransform(productReal, productImag);
    const circular = new Float64Array(period);
    for (let index = 0; index < period; index += 1) {
        circular[index] = linear[index] +
            (index + period < period * 2 - 1 ? linear[index + period] : 0);
    }
    return circular;
}

function centerPeriodicOutput(outputPeriod, label) {
    assertFloatArray(outputPeriod, `${label} output period`);
    if (outputPeriod.length === 0) throw new TypeError(`${label} period must not be empty`);
    const centered = Float64Array.from(outputPeriod);
    let mean = 0;
    for (let index = 0; index < centered.length; index += 1) mean += centered[index];
    mean /= centered.length;
    for (let index = 0; index < centered.length; index += 1) centered[index] -= mean;
    return centered;
}

function finishPeriodicRecovery(periodic, knownSpanSamples) {
    const windowLength = periodic.length < ANALYSIS_TAIL_WINDOW_SAMPLES
        ? periodic.length
        : ANALYSIS_TAIL_WINDOW_SAMPLES;
    const windowStart = periodic.length - windowLength;
    let baseline = 0;
    for (let index = windowStart; index < periodic.length; index += 1) {
        baseline += periodic[index];
    }
    baseline /= windowLength;
    const impulse = new Float64Array(periodic.length);
    let peak = 0;
    for (let index = 0; index < periodic.length; index += 1) {
        const corrected = periodic[index] - baseline;
        impulse[index] = corrected;
        const magnitude = corrected < 0 ? -corrected : corrected;
        if (magnitude > peak) peak = magnitude;
    }
    const threshold = peak * TAIL_RELATIVE_AMPLITUDE;
    let boundarySettled = true;
    for (let index = windowStart; index < impulse.length; index += 1) {
        const value = impulse[index];
        if ((value < 0 ? -value : value) > threshold) {
            boundarySettled = false;
            break;
        }
    }
    const supportOverlapsWindow = knownSpanSamples > windowStart;
    return {
        impulse,
        diagnostics: Object.freeze({
            baseline,
            baselineWindowStart: windowStart,
            baselineWindowLength: windowLength,
            baselineTrusted: !supportOverlapsWindow && boundarySettled,
            supportOverlapsWindow,
            boundarySettled
        })
    };
}

export function recoverMlsImpulseResponse(outputPeriod, excitation, options = {}) {
    assertFloatArray(outputPeriod, 'MLS output period');
    assertFloatArray(excitation, 'MLS excitation period');
    if (outputPeriod.length === 0 || outputPeriod.length !== excitation.length) {
        throw new TypeError('MLS periods must have matching non-zero lengths');
    }
    const amplitude = options.amplitude;
    if (!(Number.isFinite(amplitude) && amplitude > 0)) {
        throw new TypeError('MLS amplitude must be positive and finite');
    }
    const knownSpanSamples = Number.isSafeInteger(options.knownSpanSamples) &&
        options.knownSpanSamples >= 1
        ? options.knownSpanSamples
        : 1;
    const centered = centerPeriodicOutput(outputPeriod, 'MLS');

    const correlation = circularCrossCorrelation(centered, excitation);
    const normalization = amplitude * amplitude * (centered.length + 1);
    const periodic = new Float64Array(centered.length);
    for (let index = 0; index < periodic.length; index += 1) {
        periodic[index] = correlation[index] / normalization;
    }

    return finishPeriodicRecovery(periodic, knownSpanSamples);
}

export function recoverTspImpulseResponse(outputPeriod, inverse, options = {}) {
    assertFloatArray(outputPeriod, 'TSP output period');
    assertFloatArray(inverse, 'TSP inverse period');
    if (outputPeriod.length === 0 || outputPeriod.length !== inverse.length ||
        (outputPeriod.length & (outputPeriod.length - 1)) !== 0) {
        throw new TypeError('TSP periods must have matching power-of-two lengths');
    }
    const signalGain = options.signalGain;
    if (!(Number.isFinite(signalGain) && signalGain > 0)) {
        throw new TypeError('TSP signal gain must be positive and finite');
    }
    const knownSpanSamples = Number.isSafeInteger(options.knownSpanSamples) &&
        options.knownSpanSamples >= 1
        ? options.knownSpanSamples
        : 1;
    const centered = centerPeriodicOutput(outputPeriod, 'TSP');
    const fft = new FFT(centered.length);
    const outputSpectrum = fft.realTransform(centered);
    const inverseSpectrum = fft.realTransform(inverse);
    const productReal = new Float64Array(outputSpectrum.real.length);
    const productImag = new Float64Array(outputSpectrum.imag.length);
    for (let bin = 0; bin < productReal.length; bin += 1) {
        productReal[bin] = outputSpectrum.real[bin] * inverseSpectrum.real[bin] -
            outputSpectrum.imag[bin] * inverseSpectrum.imag[bin];
        productImag[bin] = outputSpectrum.real[bin] * inverseSpectrum.imag[bin] +
            outputSpectrum.imag[bin] * inverseSpectrum.real[bin];
    }
    const convolved = fft.inverseRealTransform(productReal, productImag);
    const periodic = new Float64Array(convolved.length);
    for (let index = 0; index < periodic.length; index += 1) {
        periodic[index] = convolved[index] / signalGain;
    }
    return finishPeriodicRecovery(periodic, knownSpanSamples);
}

export function calculatePeriodResidualDb(meanPeriod, squaredDeviations, periodCount) {
    assertFloatArray(meanPeriod, 'Mean periodic output');
    assertFloatArray(squaredDeviations, 'Periodic output deviations');
    if (meanPeriod.length !== squaredDeviations.length ||
        !Number.isInteger(periodCount) || periodCount < 2) return null;
    let mean = 0;
    for (let index = 0; index < meanPeriod.length; index += 1) mean += meanPeriod[index];
    mean /= meanPeriod.length;
    let signalEnergy = 0;
    let residualEnergy = 0;
    for (let index = 0; index < meanPeriod.length; index += 1) {
        const centered = meanPeriod[index] - mean;
        signalEnergy += centered * centered;
        residualEnergy += squaredDeviations[index];
    }
    if (!(signalEnergy > 0)) return null;
    if (residualEnergy === 0) return Number.NEGATIVE_INFINITY;
    const ratio = Math.sqrt(residualEnergy / periodCount / signalEnergy);
    return 20 * Math.log10(ratio);
}

export function periodicResidualNeedsWarning(residualDb) {
    return Number.isFinite(residualDb) && residualDb > PERIODIC_RESIDUAL_WARNING_DB;
}

export const mlsResidualNeedsWarning = periodicResidualNeedsWarning;

export function alignToQuantum(samples) {
    if (!Number.isSafeInteger(samples) || samples < 0) {
        throw new TypeError('Sample count must be a non-negative safe integer');
    }
    return Math.ceil(samples / ANALYSIS_QUANTUM_SIZE) * ANALYSIS_QUANTUM_SIZE;
}

export function isRouteTailSettled(
    samples,
    windowSamples = ANALYSIS_TAIL_WINDOW_SAMPLES,
    absoluteNoiseFloor = 0
) {
    assertFloatArray(samples, 'Route impulse response');
    if (!Number.isSafeInteger(windowSamples) || windowSamples < 1) {
        throw new TypeError('Tail window must be a positive safe integer');
    }
    if (!Number.isFinite(absoluteNoiseFloor) || absoluteNoiseFloor < 0) {
        throw new TypeError('Absolute noise floor must be finite and non-negative');
    }
    let peak = 0;
    for (let index = 0; index < samples.length; index += 1) {
        const value = samples[index];
        if (!Number.isFinite(value)) return false;
        const magnitude = value < 0 ? -value : value;
        if (magnitude > peak) peak = magnitude;
    }
    if (peak === 0) return true;
    const relativeThreshold = peak * TAIL_RELATIVE_AMPLITUDE;
    const threshold = relativeThreshold > absoluteNoiseFloor
        ? relativeThreshold
        : absoluteNoiseFloor;
    const first = samples.length > windowSamples ? samples.length - windowSamples : 0;
    for (let index = first; index < samples.length; index += 1) {
        const value = samples[index];
        if ((value < 0 ? -value : value) > threshold) return false;
    }
    return true;
}

export function areRouteTailsSettled(
    routes,
    windowSamples = ANALYSIS_TAIL_WINDOW_SAMPLES,
    absoluteNoiseFloor = 0
) {
    if (!Array.isArray(routes) || routes.length === 0) {
        throw new TypeError('At least one route is required');
    }
    return routes.every(route =>
        isRouteTailSettled(route, windowSamples, absoluteNoiseFloor));
}

function validateSpeakerResponse(response, targetSampleRate) {
    if (response === null || response === undefined) return null;
    const samples = response.samples ?? response.data;
    assertFloatArray(samples, 'Speaker response');
    if (samples.length === 0) throw new TypeError('Speaker response must not be empty');
    const sampleRate = Number(response.sampleRate);
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
        throw new TypeError('Speaker response sample rate must be a positive integer');
    }
    const onsetIndex = Number(response.onsetIndex);
    if (!Number.isFinite(onsetIndex)) throw new TypeError('Speaker response onset is invalid');
    const refScale = Number(response.refScale);
    if (!Number.isFinite(refScale) || refScale === 0) {
        throw new TypeError('Speaker response calibration scale is invalid');
    }
    const resampled = resampleWindowedSinc(samples, sampleRate, targetSampleRate);
    const normalized = new Float32Array(resampled.length);
    for (let index = 0; index < resampled.length; index += 1) {
        normalized[index] = resampled[index] / refScale;
    }
    return {
        samples: normalized,
        onsetIndex: Math.round(onsetIndex * targetSampleRate / sampleRate)
    };
}

export function placeSpeakerResponses(responses, targetSampleRate) {
    if (!Array.isArray(responses) || responses.length === 0 || responses.length > 4) {
        throw new TypeError('Between one and four speaker responses are required');
    }
    if (!Number.isSafeInteger(targetSampleRate) || targetSampleRate <= 0) {
        throw new TypeError('Target sample rate must be a positive integer');
    }
    const normalized = responses.map(response => validateSpeakerResponse(response, targetSampleRate));
    const candidates = normalized.map(response => response?.onsetIndex ?? 0);
    const commonOnset = Math.max(0, ...candidates);
    const placed = normalized.map(response => {
        if (!response) {
            const identity = new Float32Array(commonOnset + 1);
            identity[commonOnset] = 1;
            return identity;
        }
        const prefixLength = commonOnset - response.onsetIndex;
        if (!Number.isSafeInteger(prefixLength) || prefixLength < 0) {
            throw new RangeError('Speaker response alignment is invalid');
        }
        const result = new Float32Array(prefixLength + response.samples.length);
        result.set(response.samples, prefixLength);
        return result;
    });
    return { responses: placed, timeOriginSamples: commonOnset === 0 ? 0 : -commonOnset };
}

function convolveDirect(left, right) {
    const output = new Float32Array(left.length + right.length - 1);
    const outer = left.length <= right.length ? left : right;
    const inner = outer === left ? right : left;
    for (let outerIndex = 0; outerIndex < outer.length; outerIndex += 1) {
        const value = outer[outerIndex];
        if (value === 0) continue;
        for (let innerIndex = 0; innerIndex < inner.length; innerIndex += 1) {
            output[outerIndex + innerIndex] += value * inner[innerIndex];
        }
    }
    return output;
}

function convolveFft(left, right) {
    const outputLength = left.length + right.length - 1;
    const fftSize = nextPowerOfTwo(outputLength);
    const fft = new FFT(fftSize);
    const leftInput = new Float64Array(fftSize);
    const rightInput = new Float64Array(fftSize);
    leftInput.set(left);
    rightInput.set(right);
    const leftSpectrum = fft.realTransform(leftInput);
    const rightSpectrum = fft.realTransform(rightInput);
    for (let index = 0; index < leftSpectrum.real.length; index += 1) {
        const leftReal = leftSpectrum.real[index];
        const leftImag = leftSpectrum.imag[index];
        const rightReal = rightSpectrum.real[index];
        const rightImag = rightSpectrum.imag[index];
        leftSpectrum.real[index] = leftReal * rightReal - leftImag * rightImag;
        leftSpectrum.imag[index] = leftReal * rightImag + leftImag * rightReal;
    }
    const transformed = fft.inverseRealTransform(leftSpectrum.real, leftSpectrum.imag);
    return Float32Array.from(transformed.subarray(0, outputLength));
}

export function convolveImpulseResponses(left, right) {
    assertFloatArray(left, 'Pipeline impulse response');
    assertFloatArray(right, 'Speaker impulse response');
    if (left.length === 0 || right.length === 0) return new Float32Array(0);
    if (left.length === 1) {
        const output = Float32Array.from(right);
        if (left[0] !== 1) {
            for (let index = 0; index < output.length; index += 1) output[index] *= left[0];
        }
        return output;
    }
    if (right.length === 1) {
        const output = Float32Array.from(left);
        if (right[0] !== 1) {
            for (let index = 0; index < output.length; index += 1) output[index] *= right[0];
        }
        return output;
    }
    return left.length * right.length <= DIRECT_CONVOLUTION_LIMIT
        ? convolveDirect(left, right)
        : convolveFft(left, right);
}

export function sumAlignedImpulseResponses(routes) {
    if (!Array.isArray(routes) || routes.length === 0) {
        throw new TypeError('At least one route is required');
    }
    let length = 0;
    for (const route of routes) {
        assertFloatArray(route, 'Route impulse response');
        if (route.length > length) length = route.length;
    }
    const total = new Float32Array(length);
    for (const route of routes) {
        for (let index = 0; index < route.length; index += 1) total[index] += route[index];
    }
    return total;
}

function wrapDegrees(value) {
    let wrapped = (value + 180) % 360;
    if (wrapped < 0) wrapped += 360;
    return wrapped - 180;
}

function logarithmicBinIndices(fftSize, sampleRate, maximumPoints) {
    const nyquist = sampleRate / 2;
    const maximumFrequency = nyquist < 20000 ? nyquist : 20000;
    const minimumFrequency = maximumFrequency < 20 ? maximumFrequency : 20;
    if (!(maximumFrequency > 0)) return [];
    const maximumBin = Math.floor(maximumFrequency * fftSize / sampleRate);
    const minimumBin = Math.max(1, Math.ceil(minimumFrequency * fftSize / sampleRate));
    if (maximumBin < minimumBin) return [maximumBin];
    const available = maximumBin - minimumBin + 1;
    if (available <= maximumPoints) {
        return Array.from({ length: available }, (_, index) => minimumBin + index);
    }
    const result = [];
    const logMinimum = Math.log(minimumBin);
    const logMaximum = Math.log(maximumBin);
    for (let point = 0; point < maximumPoints; point += 1) {
        const fraction = point / (maximumPoints - 1);
        const bin = Math.round(Math.exp(logMinimum + fraction * (logMaximum - logMinimum)));
        if (result[result.length - 1] !== bin) result.push(bin);
    }
    return result;
}

/**
 * Exact minimum-phase group delay, in samples, derived from the magnitude alone.
 * The causal cepstrum gives phase(w) = -sum(cepstrum[n] * sin(w n)), so the phase
 * derivative -dphase/dw is sum(n * cepstrum[n] * cos(w n)): one more real transform,
 * with no finite difference across bins.
 */
function minimumPhaseGroupDelaySamples(magnitudes, fftSize, magnitudeFloor) {
    const logMagnitude = new Float64Array(magnitudes.length);
    const floor = magnitudeFloor > 0 ? magnitudeFloor : Number.MIN_VALUE;
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
        logMagnitude[bin] = Math.log(magnitudes[bin] > floor ? magnitudes[bin] : floor);
    }
    const fft = new FFT(fftSize);
    const cepstrum = fft.inverseRealTransform(logMagnitude);
    for (let index = 1; index < fftSize / 2; index += 1) cepstrum[index] *= 2;
    for (let index = fftSize / 2 + 1; index < fftSize; index += 1) cepstrum[index] = 0;
    const rampedCepstrum = new Float64Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) rampedCepstrum[index] = cepstrum[index] * index;
    return fft.realTransform(rampedCepstrum).real;
}

/**
 * Exact group delay of the transformed sequence, in samples, evaluated bin by bin.
 * With H(w) = sum(h[n] e^-jwn) and Hr(w) = sum(n h[n] e^-jwn), the phase derivative
 * -dphase/dw is exactly Re{Hr(w) conj(H(w))} / |H(w)|^2. Because each bin is evaluated on
 * its own, the estimator has no bandwidth of its own and the curve no longer changes when
 * the measurement sequence length changes.
 */
function groupDelaySamples(impulse, fftSize, real, imag, valid) {
    const ramped = new Float64Array(fftSize);
    for (let index = 0; index < impulse.length; index += 1) ramped[index] = impulse[index] * index;
    const rampedSpectrum = new FFT(fftSize).realTransform(ramped);
    const delaySamples = new Float64Array(real.length);
    delaySamples.fill(Number.NaN);
    for (let bin = 0; bin < delaySamples.length; bin += 1) {
        if (!valid[bin]) continue;
        const power = real[bin] * real[bin] + imag[bin] * imag[bin];
        if (!(power > 0)) continue;
        delaySamples[bin] = (rampedSpectrum.real[bin] * real[bin] +
            rampedSpectrum.imag[bin] * imag[bin]) / power;
    }
    return delaySamples;
}

function integratePhaseFromGroupDelay(
    wrapped,
    delaySamples,
    valid,
    fftSize,
    sampleRate,
    timeOriginSamples
) {
    const phase = new Float64Array(wrapped.length);
    phase.fill(Number.NaN);
    const referenceBin = 1000 * fftSize / sampleRate;
    const deltaOmega = 2 * Math.PI / fftSize;
    let first = 0;
    while (first < phase.length) {
        while (first < phase.length && !valid[first]) first += 1;
        if (first >= phase.length) break;
        let last = first;
        while (last + 1 < phase.length && valid[last + 1]) last += 1;
        const anchor = Math.max(first, Math.min(last, Math.round(referenceBin)));
        phase[anchor] = wrapped[anchor];
        for (let bin = anchor + 1; bin <= last; bin += 1) {
            const previousDelay = delaySamples[bin - 1] + timeOriginSamples;
            const currentDelay = delaySamples[bin] + timeOriginSamples;
            phase[bin] = phase[bin - 1] -
                0.5 * (previousDelay + currentDelay) * deltaOmega;
        }
        for (let bin = anchor - 1; bin >= first; bin -= 1) {
            const currentDelay = delaySamples[bin] + timeOriginSamples;
            const nextDelay = delaySamples[bin + 1] + timeOriginSamples;
            phase[bin] = phase[bin + 1] +
                0.5 * (currentDelay + nextDelay) * deltaOmega;
        }
        first = last + 1;
    }
    return phase;
}

function createSmoothingSpectrum(
    sampleRate,
    fftSize,
    magnitude,
    totalDelaySamples,
    minimumDelaySamples,
    unwrappedPhase,
    valid,
    timeOriginSamples
) {
    const maximumFrequency = sampleRate / 2 < 20000 ? sampleRate / 2 : 20000;
    const minimumFrequency = maximumFrequency < 20 ? maximumFrequency : 20;
    const grid = createLogFrequencyGrid(
        minimumFrequency,
        maximumFrequency,
        DISPLAY_SMOOTHING_GRID_SPACING_OCTAVES
    );
    const frequencies = Float32Array.from(grid);
    const magnitudeDb = new Float32Array(grid.length);
    const unwrappedPhaseDegrees = new Float32Array(grid.length);
    const groupDelayMs = new Float32Array(grid.length);
    const minimumGroupDelayMs = new Float32Array(grid.length);
    const excessGroupDelayMs = new Float32Array(grid.length);
    const validity = new Uint8Array(grid.length);
    const samplesToMs = 1000 / sampleRate;
    for (let index = 0; index < grid.length; index += 1) {
        const position = grid[index] * fftSize / sampleRate;
        const lower = Math.min(magnitude.length - 1, Math.floor(position));
        const upper = Math.min(magnitude.length - 1, lower + 1);
        const fraction = upper === lower ? 0 : position - lower;
        const exactLower = Math.abs(fraction) < 1e-10;
        const lowerValid = valid[lower] !== 0;
        const upperValid = exactLower || valid[upper] !== 0;
        if (!lowerValid || !upperValid) {
            magnitudeDb[index] = Number.NaN;
            unwrappedPhaseDegrees[index] = Number.NaN;
            groupDelayMs[index] = Number.NaN;
            minimumGroupDelayMs[index] = Number.NaN;
            excessGroupDelayMs[index] = Number.NaN;
            continue;
        }
        const lowerMagnitudeDb = magnitude[lower] > 0
            ? 20 * Math.log10(magnitude[lower])
            : Number.NEGATIVE_INFINITY;
        const upperMagnitudeDb = magnitude[upper] > 0
            ? 20 * Math.log10(magnitude[upper])
            : Number.NEGATIVE_INFINITY;
        const total = (exactLower
            ? totalDelaySamples[lower]
            : totalDelaySamples[lower] + fraction * (
                totalDelaySamples[upper] - totalDelaySamples[lower]
            )) + timeOriginSamples;
        const minimum = exactLower
            ? minimumDelaySamples[lower]
            : minimumDelaySamples[lower] + fraction * (
                minimumDelaySamples[upper] - minimumDelaySamples[lower]
            );
        const phase = exactLower
            ? unwrappedPhase[lower]
            : unwrappedPhase[lower] + fraction * (
                unwrappedPhase[upper] - unwrappedPhase[lower]
            );
        validity[index] = 1;
        magnitudeDb[index] = exactLower
            ? lowerMagnitudeDb
            : lowerMagnitudeDb + fraction * (upperMagnitudeDb - lowerMagnitudeDb);
        unwrappedPhaseDegrees[index] = phase * 180 / Math.PI;
        groupDelayMs[index] = total * samplesToMs;
        minimumGroupDelayMs[index] = minimum * samplesToMs;
        excessGroupDelayMs[index] = (total - minimum) * samplesToMs;
    }
    return {
        frequencies,
        magnitudeDb,
        unwrappedPhaseDegrees,
        groupDelayMs,
        minimumGroupDelayMs,
        excessGroupDelayMs,
        valid: validity
    };
}

export function deriveFrequencyResponse(impulse, sampleRate, options = {}) {
    assertFloatArray(impulse, 'Impulse response');
    if (impulse.length === 0) throw new TypeError('Impulse response must not be empty');
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
        throw new TypeError('Sample rate must be a positive integer');
    }
    const requestedFftSize = options.fftSize;
    const fftSize = requestedFftSize === undefined
        ? nextPowerOfTwo(Math.max(4, impulse.length))
        : requestedFftSize;
    if (!Number.isSafeInteger(fftSize) || fftSize < Math.max(4, impulse.length) ||
        (fftSize & (fftSize - 1)) !== 0) {
        throw new TypeError('Response FFT size must be a power of two large enough for the impulse');
    }
    const input = new Float64Array(fftSize);
    input.set(impulse);
    const { real, imag } = new FFT(fftSize).realTransform(input);
    const timeOriginSamples = options.timeOriginSamples ?? 0;
    if (!Number.isSafeInteger(timeOriginSamples)) {
        throw new TypeError('Response time origin must be an integer sample offset');
    }
    // Magnitude and validity are unaffected by the time-origin rotation, so they are
    // resolved first and the exact group delay is taken from the unrotated spectrum.
    const magnitude = new Float64Array(real.length);
    let peak = 0;
    for (let index = 0; index < real.length; index += 1) {
        const value = Math.hypot(real[index], imag[index]);
        magnitude[index] = value;
        if (value > peak) peak = value;
    }
    const magnitudeFloor = peak * MAGNITUDE_FLOOR_AMPLITUDE;
    const valid = new Uint8Array(real.length);
    for (let index = 0; index < real.length; index += 1) {
        if (magnitude[index] > magnitudeFloor) valid[index] = 1;
    }
    const totalDelaySamples = groupDelaySamples(impulse, fftSize, real, imag, valid);
    if (timeOriginSamples !== 0) {
        for (let index = 0; index < real.length; index += 1) {
            const angle = -2 * Math.PI * index * timeOriginSamples / fftSize;
            const cosine = Math.cos(angle);
            const sine = Math.sin(angle);
            const sourceReal = real[index];
            const sourceImag = imag[index];
            real[index] = sourceReal * cosine - sourceImag * sine;
            imag[index] = sourceReal * sine + sourceImag * cosine;
        }
    }
    const wrapped = new Float64Array(real.length);
    for (let index = 0; index < real.length; index += 1) {
        if (valid[index]) wrapped[index] = Math.atan2(imag[index], real[index]);
    }
    const continuousPhase = integratePhaseFromGroupDelay(
        wrapped,
        totalDelaySamples,
        valid,
        fftSize,
        sampleRate,
        timeOriginSamples
    );
    const minimumDelaySamples = minimumPhaseGroupDelaySamples(magnitude, fftSize, magnitudeFloor);
    const samplesToMs = 1000 / sampleRate;
    const maximumPoints = Number.isSafeInteger(options.maximumPoints) && options.maximumPoints >= 2
        ? options.maximumPoints
        : 2048;
    const bins = logarithmicBinIndices(fftSize, sampleRate, maximumPoints);
    const smoothingSpectrum = createSmoothingSpectrum(
        sampleRate,
        fftSize,
        magnitude,
        totalDelaySamples,
        minimumDelaySamples,
        continuousPhase,
        valid,
        timeOriginSamples
    );
    const frequencies = new Float32Array(bins.length);
    const realReduced = new Float32Array(bins.length);
    const imagReduced = new Float32Array(bins.length);
    const magnitudeDb = new Float32Array(bins.length);
    const phaseDegrees = new Float32Array(bins.length);
    const groupDelayReduced = new Float32Array(bins.length);
    const minimumGroupDelayReduced = new Float32Array(bins.length);
    const excessGroupDelayReduced = new Float32Array(bins.length);
    const validity = new Uint8Array(bins.length);
    for (let point = 0; point < bins.length; point += 1) {
        const bin = bins[point];
        frequencies[point] = bin * sampleRate / fftSize;
        realReduced[point] = real[bin];
        imagReduced[point] = imag[bin];
        magnitudeDb[point] = magnitude[bin] > 0 ? 20 * Math.log10(magnitude[bin]) : -Infinity;
        if (valid[bin]) {
            validity[point] = 1;
            phaseDegrees[point] = wrapDegrees(wrapped[bin] * 180 / Math.PI);
            const total = totalDelaySamples[bin] + timeOriginSamples;
            const minimum = minimumDelaySamples[bin];
            groupDelayReduced[point] = total * samplesToMs;
            minimumGroupDelayReduced[point] = minimum * samplesToMs;
            excessGroupDelayReduced[point] = (total - minimum) * samplesToMs;
        } else {
            phaseDegrees[point] = Number.NaN;
            groupDelayReduced[point] = Number.NaN;
            minimumGroupDelayReduced[point] = Number.NaN;
            excessGroupDelayReduced[point] = Number.NaN;
        }
    }
    return {
        fftSize,
        frequencies,
        real: realReduced,
        imag: imagReduced,
        magnitudeDb,
        phaseDegrees,
        groupDelayMs: groupDelayReduced,
        minimumGroupDelayMs: minimumGroupDelayReduced,
        excessGroupDelayMs: excessGroupDelayReduced,
        valid: validity,
        smoothing: smoothingSpectrum,
        magnitudeFloorDb: ANALYSIS_MAGNITUDE_FLOOR_DB
    };
}

export function buildAnalysisResult({
    pipelineResponses,
    speakerResponses,
    outputChannels,
    sampleRate,
    reportedLatency = 0,
    truncated = false,
    measurement = null,
    warnings = []
}) {
    if (!Array.isArray(pipelineResponses) || !Array.isArray(outputChannels) ||
        pipelineResponses.length === 0 || pipelineResponses.length !== outputChannels.length) {
        throw new TypeError('Pipeline responses and output channels must have matching non-zero lengths');
    }
    if (pipelineResponses.length > 4 || new Set(outputChannels).size !== outputChannels.length) {
        throw new TypeError('Output channels must be distinct and limited to four');
    }
    const requestedSpeakerResponses = speakerResponses ?? pipelineResponses.map(() => null);
    if (!Array.isArray(requestedSpeakerResponses) ||
        requestedSpeakerResponses.length !== pipelineResponses.length) {
        throw new TypeError('Speaker response count must match route count');
    }
    const placed = placeSpeakerResponses(requestedSpeakerResponses, sampleRate);
    const identitySpeakerResponse = requestedSpeakerResponses.every(response =>
        response === null || response === undefined);
    const safeReportedLatency = Number.isSafeInteger(reportedLatency) && reportedLatency >= 0
        ? reportedLatency
        : 0;
    const afterRoutes = pipelineResponses.map((pipelineResponse, index) => {
        assertFloatArray(pipelineResponse, 'Pipeline response');
        return convolveImpulseResponses(pipelineResponse, placed.responses[index]);
    });
    const beforeImpulse = identitySpeakerResponse
        ? new Float32Array(pipelineResponses.reduce(
            (maximum, response) => response.length > maximum ? response.length : maximum,
            1
        ))
        : sumAlignedImpulseResponses(placed.responses);
    if (identitySpeakerResponse) beforeImpulse[0] = 1;
    const afterImpulse = sumAlignedImpulseResponses(afterRoutes);
    const beforeTimeOriginSamples = identitySpeakerResponse ? 0 : placed.timeOriginSamples;
    const afterTimeOriginSamples = placed.timeOriginSamples - safeReportedLatency;
    const responseFftSize = nextPowerOfTwo(Math.max(
        4,
        beforeImpulse.length,
        afterImpulse.length
    ));
    return {
        sampleRate,
        reportedLatency: safeReportedLatency,
        captureLength: pipelineResponses.reduce(
            (maximum, response) => response.length > maximum ? response.length : maximum,
            0
        ),
        truncated: truncated === true,
        measurement,
        warnings: Array.isArray(warnings) ? warnings : [],
        before: {
            impulse: beforeImpulse,
            spectrum: deriveFrequencyResponse(beforeImpulse, sampleRate, {
                fftSize: responseFftSize,
                timeOriginSamples: beforeTimeOriginSamples
            }),
            timeOriginSamples: beforeTimeOriginSamples
        },
        after: {
            impulse: afterImpulse,
            spectrum: deriveFrequencyResponse(afterImpulse, sampleRate, {
                fftSize: responseFftSize,
                timeOriginSamples: afterTimeOriginSamples
            }),
            timeOriginSamples: afterTimeOriginSamples
        }
    };
}
