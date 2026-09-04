import FFT from '../utils/measurement-dsp/fft.js';
import { resampleWindowedSinc } from '../utils/measurement-dsp/resample.js';

export const CROSSTALK_FIR_CHANNEL_ORDER = Object.freeze(['C11', 'C21', 'C12', 'C22']);

const SOURCE_SLOTS = Object.freeze(['ll', 'lr', 'rl', 'rr']);
const ALLOWED_TAPS = new Set([1024, 2048, 4096, 8192, 16384]);
const SUPPORTED_TIME_REFERENCES = new Set(['audio-context', 'file']);
const VIRTUAL_CHANNEL_SEPARATOR = '::ch=';
const COMMON_PREROLL_SECONDS = 0.001;
const COMPLEX_SMOOTHING_OCTAVES = 1 / 6;
const BAND_TRANSITION_OCTAVES = 1;
const DIRECT_WINDOW_LOW_FREQUENCY_CYCLES = 1;
const FIR_EDGE_TAPER_FRACTION = 0.01;
const OUT_OF_WINDOW_WARNING_RATIO = 1e-3;
const MIN_MAGNITUDE = 1e-12;
const RESAMPLE_ATTENUATION_DB = 100;
const RESAMPLE_TRANSITION_BAND_FRACTION = 0.1;

export class CrosstalkCancellationDesignError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'CrosstalkCancellationDesignError';
        this.code = code;
        Object.assign(this, details);
    }
}

function fail(code, message, details) {
    throw new CrosstalkCancellationDesignError(code, message, details);
}

function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function nextPowerOfTwo(value) {
    let result = 1;
    while (result < value) result *= 2;
    return result;
}

function resampleSupportRadius(sourceRate, targetRate) {
    if (sourceRate === targetRate) return 0;
    const bandLimit = targetRate < sourceRate ? targetRate / sourceRate : 1;
    const transitionWidthRadians = Math.PI * bandLimit * RESAMPLE_TRANSITION_BAND_FRACTION;
    return Math.ceil(
        (RESAMPLE_ATTENUATION_DB - 8) / (4.57 * transitionWidthRadians)
    );
}

function normalizeConfig(candidate = {}) {
    const requestedTaps = Number(candidate.taps);
    const taps = ALLOWED_TAPS.has(requestedTaps) ? requestedTaps : 4096;
    const sampleRate = Math.round(clamp(candidate.sampleRate, 8000, 768000, 48000));
    const lowFrequency = clamp(candidate.lowFrequency, 20, 2000, 200);
    const highFrequency = Math.max(
        lowFrequency,
        clamp(candidate.highFrequency, 1000, 20000, 6000)
    );
    return {
        sampleRate,
        taps,
        filterDelaySamples: taps / 2,
        regularization: clamp(candidate.regularization, 0, 100, 50),
        maxGainDb: clamp(candidate.maxGainDb, 0, 24, 12),
        lowFrequency,
        highFrequency,
        directWindowMs: clamp(candidate.directWindowMs, 2, 50, 8)
    };
}

function baseMeasurementId(id) {
    const separator = id.lastIndexOf(VIRTUAL_CHANNEL_SEPARATOR);
    return separator > 0 ? id.slice(0, separator) : id;
}

function sourceRecord(slot, source) {
    if (!source || typeof source !== 'object') {
        fail('missing-source', `Assign a measurement to the ${slot.toUpperCase()} slot.`);
    }
    const impulses = Array.isArray(source.impulses)
        ? source.impulses.filter(impulse => impulse?.data)
        : source.data ? [source] : [];
    const declaredPointCount = Number.isFinite(Number(source.pointCount))
        ? Number(source.pointCount)
        : 0;
    const measurementPointCount = Array.isArray(source.measurement?.points)
        ? source.measurement.points.length
        : 0;
    const pointCount = Math.max(declaredPointCount, measurementPointCount, impulses.length);
    if (pointCount > 1 || impulses.length > 1) {
        fail(
            'multiple-measurement-points',
            'This measurement has multiple points. Assign a single-point measurement.',
            { slot }
        );
    }
    if (impulses.length !== 1) {
        fail('missing-impulse-response', 'This measurement does not contain an impulse response.', {
            slot
        });
    }
    const record = impulses[0];
    const id = String(source.id || source.assignmentId || '').trim();
    if (!id) {
        fail('missing-measurement-id', 'This measurement assignment does not have an ID.', { slot });
    }
    const timeReference = record.outputTimeReference;
    if (timeReference === 'media-element') {
        fail(
            'media-element-time-reference',
            'This measurement does not have an audio-clock time reference.',
            { slot, timeReference }
        );
    }
    if (!SUPPORTED_TIME_REFERENCES.has(timeReference)) {
        fail(
            'unknown-output-time-reference',
            'This measurement does not have a supported output time reference.',
            { slot, timeReference: timeReference ?? null }
        );
    }
    if (!Number.isSafeInteger(record.trimStartSamples)) {
        fail(
            'old-measurement-format',
            'This measurement uses an old format. Please measure again.',
            { slot }
        );
    }
    if (!Number.isSafeInteger(record.onsetIndex) || record.onsetIndex < 0) {
        fail('invalid-onset', 'This measurement has an invalid impulse-response onset.', { slot });
    }
    if (!Number.isSafeInteger(record.sampleRate) || record.sampleRate <= 0) {
        fail('invalid-sample-rate', 'This measurement has an invalid sample rate.', { slot });
    }
    if (!(record.data instanceof Float32Array) && !(record.data instanceof Float64Array)) {
        fail('invalid-impulse-response', 'This measurement has invalid impulse-response data.', {
            slot
        });
    }
    if (record.data.length === 0) {
        fail('invalid-impulse-response', 'This measurement has an empty impulse response.', {
            slot
        });
    }
    for (const sample of record.data) {
        if (!Number.isFinite(sample)) {
            fail('invalid-impulse-response', 'This measurement has invalid impulse-response data.', {
                slot
            });
        }
    }
    return { id, baseId: baseMeasurementId(id), record, slot };
}

export function validateCrosstalkSources(sources) {
    const normalized = Object.fromEntries(
        SOURCE_SLOTS.map(slot => [slot, sourceRecord(slot, sources?.[slot])])
    );
    const ids = SOURCE_SLOTS.map(slot => normalized[slot].id);
    if (new Set(ids).size !== ids.length) {
        fail(
            'duplicate-measurement-assignment',
            'Assign a different measurement channel to each slot.'
        );
    }
    if (normalized.ll.baseId !== normalized.rl.baseId) {
        fail(
            'left-ear-session-mismatch',
            'LL and RL must be two different channels of one measurement made with the microphone at your left ear.'
        );
    }
    if (normalized.lr.baseId !== normalized.rr.baseId) {
        fail(
            'right-ear-session-mismatch',
            'LR and RR must be two different channels of one measurement made with the microphone at your right ear.'
        );
    }
    const sampleRates = new Set(SOURCE_SLOTS.map(slot => normalized[slot].record.sampleRate));
    if (sampleRates.size !== 1) {
        fail('sample-rate-mismatch', 'All four measurements must use the same sample rate.');
    }
    return {
        sources: normalized,
        sampleRate: normalized.ll.record.sampleRate
    };
}

function alignedSession(first, second, sampleRate, directWindowMs) {
    const records = [first.record, second.record];
    const absoluteOnsets = records.map(record => record.trimStartSamples + record.onsetIndex);
    const prerollSamples = Math.max(1, Math.round(sampleRate * COMMON_PREROLL_SECONDS));
    const commonOffset = Math.max(0, Math.min(...absoluteOnsets) - prerollSamples);
    const directSamples = Math.max(1, Math.round(sampleRate * directWindowMs / 1000));
    const alignedOnsets = absoluteOnsets.map(onset => onset - commonOffset);
    const length = Math.max(...alignedOnsets.map(onset => onset + directSamples + 1));
    const channels = records.map((record, recordIndex) => {
        const output = new Float32Array(length);
        // Stored impulse responses keep the deconvolution reference scale. A
        // measurement made with interface calibration stores unit reference,
        // an uncalibrated one stores a scale of tens of thousands, so mixing
        // the two without dividing it out leaves the plant matrix rank one.
        const referenceScale = Number.isFinite(record.refScale) && record.refScale > MIN_MAGNITUDE
            ? record.refScale
            : 1;
        const dataStart = record.trimStartSamples - commonOffset;
        const end = alignedOnsets[recordIndex] + directSamples;
        const fadeLength = Math.max(1, Math.floor(directSamples / 2));
        const fadeStart = end - fadeLength;
        for (let inputIndex = 0; inputIndex < record.data.length; inputIndex += 1) {
            const outputIndex = dataStart + inputIndex;
            if (outputIndex < 0 || outputIndex >= length || outputIndex >= end) continue;
            let gain = 1;
            if (outputIndex >= fadeStart) {
                const fraction = (outputIndex - fadeStart) / fadeLength;
                gain = 0.5 + 0.5 * Math.cos(Math.PI * fraction);
            }
            output[outputIndex] = record.data[inputIndex] * gain / referenceScale;
        }
        return output;
    });
    return {
        channels,
        delaySeconds: alignedOnsets.map(onset => onset / sampleRate)
    };
}

function complexMultiply(left, right) {
    return {
        re: left.re * right.re - left.im * right.im,
        im: left.re * right.im + left.im * right.re
    };
}

function complexAdd(left, right) {
    return { re: left.re + right.re, im: left.im + right.im };
}

function complexSubtract(left, right) {
    return { re: left.re - right.re, im: left.im - right.im };
}

function complexScale(value, scale) {
    return { re: value.re * scale, im: value.im * scale };
}

function complexConjugate(value) {
    return { re: value.re, im: -value.im };
}

function complexMagnitudeSquared(value) {
    return value.re * value.re + value.im * value.im;
}

/**
 * Smooths a complex response only after removing its known bulk delay. The same
 * delay is restored after the fixed 1/6-octave boxcar average, preserving ITD.
 */
export function smoothDelayCompensatedSpectrum(
    spectrum,
    sampleRate,
    fftSize,
    delaySeconds,
    smoothingOctaves = COMPLEX_SMOOTHING_OCTAVES
) {
    const length = fftSize / 2 + 1;
    if (!Number.isSafeInteger(fftSize) || fftSize < 2 || (fftSize & (fftSize - 1)) !== 0 ||
        !(Number.isFinite(sampleRate) && sampleRate > 0) ||
        !(Number.isFinite(delaySeconds) && delaySeconds >= 0) ||
        !(Number.isFinite(smoothingOctaves) && smoothingOctaves >= 0)) {
        throw new TypeError('Complex smoothing parameters are invalid.');
    }
    if (spectrum?.real?.length !== length || spectrum?.imag?.length !== length) {
        throw new TypeError('The spectrum size does not match the FFT size.');
    }
    const alignedReal = new Float64Array(length);
    const alignedImag = new Float64Array(length);
    const prefixReal = new Float64Array(length + 1);
    const prefixImag = new Float64Array(length + 1);
    for (let bin = 0; bin < length; bin += 1) {
        const frequency = bin * sampleRate / fftSize;
        const phase = 2 * Math.PI * frequency * delaySeconds;
        const cosine = Math.cos(phase);
        const sine = Math.sin(phase);
        alignedReal[bin] = spectrum.real[bin] * cosine - spectrum.imag[bin] * sine;
        alignedImag[bin] = spectrum.real[bin] * sine + spectrum.imag[bin] * cosine;
        prefixReal[bin + 1] = prefixReal[bin] + alignedReal[bin];
        prefixImag[bin + 1] = prefixImag[bin] + alignedImag[bin];
    }
    const smoothedReal = new Float64Array(length);
    const smoothedImag = new Float64Array(length);
    const halfWidth = Math.max(0, smoothingOctaves) / 2;
    const lowerScale = 2 ** -halfWidth;
    const upperScale = 2 ** halfWidth;
    for (let bin = 0; bin < length; bin += 1) {
        const first = bin === 0 ? 0 : Math.max(1, Math.ceil(bin * lowerScale));
        const last = bin === 0
            ? 0
            : Math.min(length - 1, Math.floor(bin * upperScale));
        const count = last - first + 1;
        const averageReal = (prefixReal[last + 1] - prefixReal[first]) / count;
        const averageImag = (prefixImag[last + 1] - prefixImag[first]) / count;
        const frequency = bin * sampleRate / fftSize;
        const phase = -2 * Math.PI * frequency * delaySeconds;
        const cosine = Math.cos(phase);
        const sine = Math.sin(phase);
        smoothedReal[bin] = averageReal * cosine - averageImag * sine;
        smoothedImag[bin] = averageReal * sine + averageImag * cosine;
    }
    smoothedImag[0] = 0;
    smoothedImag[length - 1] = 0;
    return { real: smoothedReal, imag: smoothedImag };
}

function spectrumForAlignedImpulse(samples, sampleRate, fftSize) {
    const input = new Float64Array(fftSize);
    input.set(samples);
    return new FFT(fftSize).realTransform(input);
}

/**
 * Validates, common-aligns, resamples, windows, normalizes, and smooths the four
 * measured responses. This export is the measurement-to-plant contract used by
 * numerical tests; worker results deliberately do not expose these spectra.
 */
export function prepareCrosstalkPlant(request) {
    const config = normalizeConfig(request?.config);
    const validated = validateCrosstalkSources(request?.sources);
    const leftEar = alignedSession(
        validated.sources.ll,
        validated.sources.rl,
        validated.sampleRate,
        config.directWindowMs
    );
    const rightEar = alignedSession(
        validated.sources.lr,
        validated.sources.rr,
        validated.sampleRate,
        config.directWindowMs
    );
    const resampleRadius = resampleSupportRadius(validated.sampleRate, config.sampleRate);
    const resampleGuardSamples = resampleRadius * 2;
    const resample = samples => {
        if (resampleRadius === 0) return Float32Array.from(samples);
        const guarded = new Float32Array(samples.length + resampleGuardSamples * 2);
        guarded.set(samples, resampleGuardSamples);
        return resampleWindowedSinc(
            guarded,
            validated.sampleRate,
            config.sampleRate,
            { radius: resampleRadius }
        );
    };
    const resampled = {
        ll: resample(leftEar.channels[0]),
        rl: resample(leftEar.channels[1]),
        lr: resample(rightEar.channels[0]),
        rr: resample(rightEar.channels[1])
    };
    const resampleGuardSeconds = resampleGuardSamples / validated.sampleRate;
    const delays = {
        ll: leftEar.delaySeconds[0] + resampleGuardSeconds,
        rl: leftEar.delaySeconds[1] + resampleGuardSeconds,
        lr: rightEar.delaySeconds[0] + resampleGuardSeconds,
        rr: rightEar.delaySeconds[1] + resampleGuardSeconds
    };
    const longestResponse = Math.max(...SOURCE_SLOTS.map(slot => resampled[slot].length));
    const fftSize = nextPowerOfTwo(Math.max(config.taps * 4, longestResponse));
    const unsmoothedSpectra = Object.fromEntries(SOURCE_SLOTS.map(slot => [
        slot,
        spectrumForAlignedImpulse(resampled[slot], config.sampleRate, fftSize)
    ]));
    const requestedWindowLow = DIRECT_WINDOW_LOW_FREQUENCY_CYCLES *
        1000 / config.directWindowMs;
    const effectiveLowFrequency = Math.max(config.lowFrequency, requestedWindowLow);
    const effectiveHighFrequency = Math.min(
        config.highFrequency,
        validated.sampleRate * 0.475,
        config.sampleRate * 0.475
    );
    const firstBin = Math.max(1, Math.ceil(effectiveLowFrequency * fftSize / config.sampleRate));
    const lastBin = Math.min(
        fftSize / 2,
        Math.floor(effectiveHighFrequency * fftSize / config.sampleRate)
    );
    let magnitudeSum = 0;
    let magnitudeCount = 0;
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
        magnitudeSum += Math.hypot(
            unsmoothedSpectra.ll.real[bin],
            unsmoothedSpectra.ll.imag[bin]
        );
        magnitudeSum += Math.hypot(
            unsmoothedSpectra.rr.real[bin],
            unsmoothedSpectra.rr.imag[bin]
        );
        magnitudeCount += 2;
    }
    if (magnitudeCount === 0 || !(magnitudeSum > MIN_MAGNITUDE)) {
        fail('empty-design-band', 'The selected frequency range cannot be designed.');
    }
    const normalizationScale = magnitudeCount / magnitudeSum;
    for (const slot of SOURCE_SLOTS) {
        const spectrum = unsmoothedSpectra[slot];
        for (let bin = 0; bin < spectrum.real.length; bin += 1) {
            spectrum.real[bin] *= normalizationScale;
            spectrum.imag[bin] *= normalizationScale;
        }
    }
    const spectra = Object.fromEntries(SOURCE_SLOTS.map(slot => [
        slot,
        smoothDelayCompensatedSpectrum(
            unsmoothedSpectra[slot],
            config.sampleRate,
            fftSize,
            delays[slot]
        )
    ]));
    return {
        config,
        spectra,
        delays,
        fftSize,
        measurementSampleRate: validated.sampleRate,
        normalizationScale,
        effectiveLowFrequency,
        effectiveHighFrequency,
        lowFrequencyClamped: effectiveLowFrequency > config.lowFrequency
    };
}

/**
 * Computes C = (H^H H + beta I)^-1 H^H D for one frequency bin.
 * Matrix rows are destinations and columns are sources:
 * H = [[H_LL, H_RL], [H_LR, H_RR]].
 */
export function solveRegularizedCrosstalkBin({
    hLL,
    hLR,
    hRL,
    hRR,
    targetLL,
    targetRR,
    beta
}) {
    if (!(Number.isFinite(beta) && beta > 0)) {
        throw new TypeError('Regularization beta must be positive and finite.');
    }
    const a11 = complexMagnitudeSquared(hLL) + complexMagnitudeSquared(hLR) + beta;
    const a22 = complexMagnitudeSquared(hRL) + complexMagnitudeSquared(hRR) + beta;
    const a12 = complexAdd(
        complexMultiply(complexConjugate(hLL), hRL),
        complexMultiply(complexConjugate(hLR), hRR)
    );
    const determinant = a11 * a22 - complexMagnitudeSquared(a12);
    const b11 = complexMultiply(complexConjugate(hLL), targetLL);
    const b21 = complexMultiply(complexConjugate(hRL), targetLL);
    const b12 = complexMultiply(complexConjugate(hLR), targetRR);
    const b22 = complexMultiply(complexConjugate(hRR), targetRR);
    const a21 = complexConjugate(a12);
    return {
        c11: complexScale(complexSubtract(complexScale(b11, a22), complexMultiply(a12, b21)),
            1 / determinant),
        c21: complexScale(complexSubtract(complexScale(b21, a11), complexMultiply(a21, b11)),
            1 / determinant),
        c12: complexScale(complexSubtract(complexScale(b12, a22), complexMultiply(a12, b22)),
            1 / determinant),
        c22: complexScale(complexSubtract(complexScale(b22, a11), complexMultiply(a21, b12)),
            1 / determinant)
    };
}

function spectrumValue(spectrum, bin) {
    return { re: spectrum.real[bin], im: spectrum.imag[bin] };
}

function singularValuesSquared(hLL, hLR, hRL, hRR) {
    const trace = complexMagnitudeSquared(hLL) + complexMagnitudeSquared(hLR) +
        complexMagnitudeSquared(hRL) + complexMagnitudeSquared(hRR);
    const determinant = complexSubtract(
        complexMultiply(hLL, hRR),
        complexMultiply(hRL, hLR)
    );
    const discriminant = Math.max(
        0,
        trace * trace - 4 * complexMagnitudeSquared(determinant)
    );
    const root = Math.sqrt(discriminant);
    return [(trace + root) / 2, Math.max(0, (trace - root) / 2)];
}

function maximumSingularValue(c11, c21, c12, c22) {
    return Math.sqrt(singularValuesSquared(c11, c21, c12, c22)[0]);
}

function bandWeight(frequency, lowFrequency, highFrequency) {
    if (!(frequency > 0)) return 0;
    const transitionScale = 2 ** BAND_TRANSITION_OCTAVES;
    if (frequency < lowFrequency / transitionScale || frequency > highFrequency * transitionScale) {
        return 0;
    }
    if (frequency < lowFrequency) {
        const fraction = Math.log2(frequency / (lowFrequency / transitionScale)) /
            BAND_TRANSITION_OCTAVES;
        return 0.5 - 0.5 * Math.cos(Math.PI * fraction);
    }
    if (frequency > highFrequency) {
        const fraction = Math.log2(frequency / highFrequency) / BAND_TRANSITION_OCTAVES;
        return 0.5 + 0.5 * Math.cos(Math.PI * fraction);
    }
    return 1;
}

function designSpectra(plant) {
    const { config, spectra, fftSize, effectiveLowFrequency, effectiveHighFrequency } = plant;
    const length = fftSize / 2 + 1;
    const output = Array.from({ length: 4 }, () => ({
        real: new Float64Array(length),
        imag: new Float64Array(length)
    }));
    const betaMid = 10 ** ((-60 + 0.4 * config.regularization) / 10);
    const gainLimit = 10 ** (config.maxGainDb / 20);
    let maximumGain = 0;
    let gainLimitedBins = 0;
    for (let bin = 0; bin < length; bin += 1) {
        const frequency = bin * config.sampleRate / fftSize;
        const hLL = spectrumValue(spectra.ll, bin);
        const hLR = spectrumValue(spectra.lr, bin);
        const hRL = spectrumValue(spectra.rl, bin);
        const hRR = spectrumValue(spectra.rr, bin);
        const delayPhase = -2 * Math.PI * frequency *
            config.filterDelaySamples / config.sampleRate;
        const delayedUnit = { re: Math.cos(delayPhase), im: Math.sin(delayPhase) };
        const targetLL = complexMultiply(hLL, delayedUnit);
        const targetRR = complexMultiply(hRR, delayedUnit);
        const lowRatio = frequency > 0 ? effectiveLowFrequency / frequency : Infinity;
        const highRatio = effectiveHighFrequency > 0 ? frequency / effectiveHighFrequency : 1;
        const shape = Math.min(100, Math.max(1, lowRatio * lowRatio, highRatio * highRatio));
        const betaShape = betaMid * shape;
        const targetMagnitude = Math.max(
            Math.sqrt(complexMagnitudeSquared(hLL)),
            Math.sqrt(complexMagnitudeSquared(hRR))
        );
        let betaBin = 0;
        for (const sigmaSquared of singularValuesSquared(hLL, hLR, hRL, hRR)) {
            const sigma = Math.sqrt(sigmaSquared);
            betaBin = Math.max(
                betaBin,
                sigma * targetMagnitude / gainLimit - sigmaSquared
            );
        }
        betaBin = Math.max(0, betaBin);
        if (betaBin > betaShape) gainLimitedBins += 1;
        const solution = solveRegularizedCrosstalkBin({
            hLL,
            hLR,
            hRL,
            hRR,
            targetLL,
            targetRR,
            beta: Math.max(betaShape, betaBin)
        });
        const weight = bandWeight(frequency, effectiveLowFrequency, effectiveHighFrequency);
        const c11 = {
            re: solution.c11.re * weight + delayedUnit.re * (1 - weight),
            im: solution.c11.im * weight + delayedUnit.im * (1 - weight)
        };
        const c21 = complexScale(solution.c21, weight);
        const c12 = complexScale(solution.c12, weight);
        const c22 = {
            re: solution.c22.re * weight + delayedUnit.re * (1 - weight),
            im: solution.c22.im * weight + delayedUnit.im * (1 - weight)
        };
        const ordered = [c11, c21, c12, c22];
        for (let channel = 0; channel < ordered.length; channel += 1) {
            output[channel].real[bin] = ordered[channel].re;
            output[channel].imag[bin] = ordered[channel].im;
        }
        maximumGain = Math.max(maximumGain, maximumSingularValue(c11, c21, c12, c22));
    }
    for (const spectrum of output) {
        spectrum.imag[0] = 0;
        spectrum.imag[length - 1] = 0;
    }
    return { output, maximumGain, gainLimitedBins };
}

function firEdgeWindow(index, length) {
    const edge = Math.max(2, Math.round(length * FIR_EDGE_TAPER_FRACTION));
    if (index < edge) return 0.5 - 0.5 * Math.cos(Math.PI * index / edge);
    if (index >= length - edge) {
        return 0.5 - 0.5 * Math.cos(Math.PI * (length - 1 - index) / edge);
    }
    return 1;
}

export function designCrosstalkCancellation(request) {
    const plant = prepareCrosstalkPlant(request);
    const designed = designSpectra(plant);
    const completeResponses = designed.output.map(spectrum =>
        new FFT(plant.fftSize).inverseRealTransform(spectrum.real, spectrum.imag));
    let totalEnergy = 0;
    let outOfWindowEnergy = 0;
    for (const response of completeResponses) {
        for (let index = 0; index < response.length; index += 1) {
            const energy = response[index] * response[index];
            totalEnergy += energy;
            if (index >= plant.config.taps) outOfWindowEnergy += energy;
        }
    }
    const outOfWindowEnergyRatio = outOfWindowEnergy / Math.max(totalEnergy, MIN_MAGNITUDE);
    const channels = completeResponses.map(response => Float32Array.from(
        { length: plant.config.taps },
        (_, index) => response[index] * firEdgeWindow(index, plant.config.taps)
    ));
    for (const channel of channels) {
        for (const sample of channel) {
            if (!Number.isFinite(sample)) {
                fail('non-finite-design', 'The crosstalk filter could not be designed.');
            }
        }
    }
    return {
        // ETA1 trueStereo consumes input-major paths: L input to L/R output,
        // followed by R input to L/R output. Therefore this strict order is
        // [C11, C21, C12, C22], not matrix row-major order.
        channels,
        config: { ...plant.config },
        diagnostics: {
            fftSize: plant.fftSize,
            measurementSampleRate: plant.measurementSampleRate,
            maxGainLinear: designed.maximumGain,
            maxGainDb: 20 * Math.log10(Math.max(designed.maximumGain, MIN_MAGNITUDE)),
            maxGainLimitDb: plant.config.maxGainDb,
            gainLimitActive: designed.gainLimitedBins > 0,
            gainLimitedBins: designed.gainLimitedBins,
            outOfWindowEnergyRatio,
            outOfWindowWarningThreshold: OUT_OF_WINDOW_WARNING_RATIO,
            tapsWarning: outOfWindowEnergyRatio > OUT_OF_WINDOW_WARNING_RATIO,
            requestedLowFrequency: plant.config.lowFrequency,
            effectiveLowFrequency: plant.effectiveLowFrequency,
            lowFrequencyClamped: plant.lowFrequencyClamped,
            effectiveHighFrequency: plant.effectiveHighFrequency,
            normalizationScale: plant.normalizationScale
        }
    };
}
