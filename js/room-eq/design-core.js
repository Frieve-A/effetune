import FFT from '../utils/measurement-dsp/fft.js';
import {
    createLogFrequencyGrid,
    interpolateLogResponse,
    smoothFrequencyResponse
} from '../utils/measurement-dsp/smoothing.js';
import { resampleWindowedSinc } from '../utils/measurement-dsp/resample.js';

const MIN_MAGNITUDE = 1e-8;
const QUALITY_WARNING_FILTER_ACCURACY = 'filterAccuracy';
const QUALITY_WARNING_IMPULSE_RESPONSE_REQUIRED = 'impulseResponseRequired';
const analysisCache = new Map();
const synthesisPlanCache = new Map();
const designCache = new Map();
let fftBackend = null;

export function setRoomEqFftBackend(backend = null) {
    if (backend !== null &&
        (typeof backend.realTransform !== 'function' ||
            typeof backend.inverseRealTransform !== 'function')) {
        throw new TypeError('Room EQ FFT backend is invalid');
    }
    fftBackend = backend;
    designCache.clear();
}

function realTransform(input) {
    return fftBackend?.realTransform(input) || new FFT(input.length).realTransform(input);
}

function inverseRealTransform(real, imag, size) {
    return fftBackend?.inverseRealTransform(real, imag, size) ||
        new FFT(size).inverseRealTransform(real, imag);
}

export function nextPowerOfTwo(value) {
    let result = 1;
    while (result < value) result *= 2;
    return result;
}

function dbToGain(decibels) {
    return 10 ** (decibels / 20);
}

function gainToDb(gain) {
    return 20 * Math.log10(gain > MIN_MAGNITUDE ? gain : MIN_MAGNITUDE);
}

function unwrapPhase(phases) {
    const output = Float64Array.from(phases);
    let offset = 0;
    for (let index = 1; index < output.length; index += 1) {
        const current = output[index] + offset;
        const difference = current - output[index - 1];
        if (difference > Math.PI) offset -= 2 * Math.PI;
        else if (difference < -Math.PI) offset += 2 * Math.PI;
        output[index] += offset;
    }
    return output;
}

function unwrapPhaseFrom(phases, first) {
    const output = Float64Array.from(phases);
    let offset = 0;
    for (let index = first + 1; index < output.length; index += 1) {
        const current = output[index] + offset;
        const difference = current - output[index - 1];
        if (difference > Math.PI) offset -= 2 * Math.PI;
        else if (difference < -Math.PI) offset += 2 * Math.PI;
        output[index] += offset;
    }
    return output;
}

function interpolateValues(frequencies, values, targetFrequencies) {
    if (!frequencies.length) return new Float64Array(targetFrequencies.length);
    const result = new Float64Array(targetFrequencies.length);
    let upper = 1;
    for (let index = 0; index < targetFrequencies.length; index += 1) {
        const frequency = targetFrequencies[index];
        while (upper < frequencies.length && frequencies[upper] < frequency) upper += 1;
        if (frequency <= frequencies[0] || upper === 0) result[index] = values[0];
        else if (upper >= frequencies.length) result[index] = values[values.length - 1];
        else {
            const lowFrequency = frequencies[upper - 1];
            const highFrequency = frequencies[upper];
            const fraction = Math.log(frequency / lowFrequency) / Math.log(highFrequency / lowFrequency);
            result[index] = values[upper - 1] + fraction * (values[upper] - values[upper - 1]);
        }
    }
    return result;
}

function getSynthesisPlan(gridFrequencies, config) {
    const fftSize = config.taps * 2;
    const key = `${config.sampleRate}:${config.taps}:${gridFrequencies.length}:` +
        `${gridFrequencies[0]}:${gridFrequencies[gridFrequencies.length - 1]}`;
    const cached = synthesisPlanCache.get(key);
    if (cached) return cached;
    const binFrequencies = new Float64Array(fftSize / 2 + 1);
    const lowerIndices = new Uint32Array(binFrequencies.length);
    const fractions = new Float64Array(binFrequencies.length);
    let upper = 1;
    for (let bin = 0; bin < binFrequencies.length; bin += 1) {
        const frequency = bin * config.sampleRate / fftSize;
        binFrequencies[bin] = frequency;
        while (upper < gridFrequencies.length && gridFrequencies[upper] < frequency) upper += 1;
        if (frequency <= gridFrequencies[0]) {
            lowerIndices[bin] = 0;
            fractions[bin] = 0;
        } else if (upper >= gridFrequencies.length) {
            lowerIndices[bin] = gridFrequencies.length - 2;
            fractions[bin] = 1;
        } else {
            const low = gridFrequencies[upper - 1];
            const high = gridFrequencies[upper];
            lowerIndices[bin] = upper - 1;
            fractions[bin] = Math.log(frequency / low) / Math.log(high / low);
        }
    }
    const linearWindow = new Float64Array(config.taps);
    const edge = config.taps * 0.05;
    for (let index = 0; index < linearWindow.length; index += 1) {
        let window = 1;
        if (index < edge) window = 0.5 - 0.5 * Math.cos(Math.PI * index / edge);
        else if (index > config.taps - edge) {
            window = 0.5 - 0.5 * Math.cos(Math.PI * (config.taps - index) / edge);
        }
        linearWindow[index] = window;
    }
    const minimumWindow = new Float64Array(config.taps).fill(1);
    const fadeStart = Math.floor(config.taps * 0.9);
    for (let index = fadeStart; index < minimumWindow.length; index += 1) {
        const fraction = (index - fadeStart) / Math.max(1, config.taps - fadeStart - 1);
        minimumWindow[index] = 0.5 + 0.5 * Math.cos(Math.PI * fraction);
    }
    const plan = { fftSize, binFrequencies, lowerIndices, fractions, linearWindow, minimumWindow };
    synthesisPlanCache.set(key, plan);
    if (synthesisPlanCache.size > 8) {
        synthesisPlanCache.delete(synthesisPlanCache.keys().next().value);
    }
    return plan;
}

function interpolateWithPlan(values, plan) {
    const result = new Float64Array(plan.binFrequencies.length);
    for (let index = 0; index < result.length; index += 1) {
        const lower = plan.lowerIndices[index];
        const fraction = plan.fractions[index];
        result[index] = values[lower] + fraction * (values[lower + 1] - values[lower]);
    }
    return result;
}

function reduceSpectrumToLogGrid(real, imag, sampleRate, fftSize, frequencies) {
    const output = new Float64Array(frequencies.length);
    const binWidth = sampleRate / fftSize;
    for (let index = 0; index < frequencies.length; index += 1) {
        const lower = index === 0 ? frequencies[index] / Math.sqrt(frequencies[1] / frequencies[0]) :
            Math.sqrt(frequencies[index - 1] * frequencies[index]);
        const upper = index === frequencies.length - 1
            ? frequencies[index] * Math.sqrt(frequencies[index] / frequencies[index - 1])
            : Math.sqrt(frequencies[index] * frequencies[index + 1]);
        let firstBin = Math.ceil(lower / binWidth);
        let lastBin = Math.floor(upper / binWidth);
        if (firstBin < 1) firstBin = 1;
        if (lastBin >= real.length) lastBin = real.length - 1;
        if (lastBin < firstBin) firstBin = lastBin = Math.min(real.length - 1,
            Math.max(1, Math.round(frequencies[index] / binWidth)));
        let power = 0;
        let count = 0;
        for (let bin = firstBin; bin <= lastBin; bin += 1) {
            power += real[bin] * real[bin] + imag[bin] * imag[bin];
            count += 1;
        }
        output[index] = Math.sqrt(power / (count || 1));
    }
    return output;
}

function analyzeImpulse(impulse, contextRate, frequencies) {
    const cacheable = typeof impulse.measurementId === 'string' && impulse.measurementId &&
        Number.isSafeInteger(impulse.pointId);
    const cacheKey = cacheable
        ? `${impulse.measurementId}:${impulse.pointId}:${contextRate}:${impulse.sampleRate}:` +
            `${impulse.data.length}:${impulse.refScale ?? 1}`
        : '';
    const cached = cacheable ? analysisCache.get(cacheKey) : null;
    if (cached) return cached;
    const samples = impulse.sampleRate === contextRate
        ? Float32Array.from(impulse.data)
        : resampleWindowedSinc(impulse.data, impulse.sampleRate, contextRate);
    const referenceScale = Number.isFinite(impulse.refScale) && impulse.refScale > MIN_MAGNITUDE
        ? impulse.refScale
        : 1;
    if (referenceScale !== 1) {
        for (let index = 0; index < samples.length; index += 1) {
            samples[index] /= referenceScale;
        }
    }
    const onsetIndex = Math.round(impulse.onsetIndex * contextRate / impulse.sampleRate);
    const fftSize = nextPowerOfTwo(samples.length);
    const input = new Float64Array(fftSize);
    input.set(samples);
    const spectrum = realTransform(input);
    const analysis = {
        samples,
        onsetIndex,
        fftSize,
        directCache: new Map(),
        magnitude: reduceSpectrumToLogGrid(
            spectrum.real,
            spectrum.imag,
            contextRate,
            fftSize,
            frequencies
        )
    };
    if (cacheable) {
        analysisCache.set(cacheKey, analysis);
        if (analysisCache.size > 64) analysisCache.delete(analysisCache.keys().next().value);
    }
    return analysis;
}

export function clearRoomEqAnalysisCache() {
    analysisCache.clear();
}

export function clearRoomEqDesignCache() {
    designCache.clear();
}

function directSpectrum(analysis, sampleRate, directWindowMs, synthesisFrequencies) {
    const cacheKey = `${directWindowMs}:${synthesisFrequencies.length}`;
    const cached = analysis.directCache.get(cacheKey);
    if (cached) return cached;
    const input = new Float64Array(analysis.fftSize);
    const start = Math.max(0, analysis.onsetIndex - Math.round(sampleRate * 0.001));
    const end = Math.min(analysis.samples.length,
        analysis.onsetIndex + Math.max(1, Math.round(sampleRate * directWindowMs / 1000)));
    const fadeLength = Math.max(1, end - analysis.onsetIndex);
    for (let index = start; index < end; index += 1) {
        let gain = 1;
        if (index >= analysis.onsetIndex) {
            const phase = (index - analysis.onsetIndex) / fadeLength;
            gain = 0.5 + 0.5 * Math.cos(Math.PI * phase);
        }
        input[index] = analysis.samples[index] * gain;
    }
    const spectrum = realTransform(input);
    const sourceFrequencies = new Float64Array(spectrum.real.length);
    const magnitude = new Float64Array(spectrum.real.length);
    const phase = new Float64Array(spectrum.real.length);
    for (let bin = 0; bin < spectrum.real.length; bin += 1) {
        sourceFrequencies[bin] = bin * sampleRate / analysis.fftSize;
        magnitude[bin] = Math.hypot(spectrum.real[bin], spectrum.imag[bin]);
        phase[bin] = Math.atan2(spectrum.imag[bin], spectrum.real[bin]);
    }
    const result = {
        magnitude: interpolateValues(sourceFrequencies.subarray(1), magnitude.subarray(1), synthesisFrequencies),
        phase: interpolateValues(sourceFrequencies.subarray(1), unwrapPhase(phase).subarray(1), synthesisFrequencies),
        phaseCorrectionCache: new Map()
    };
    analysis.directCache.set(cacheKey, result);
    if (analysis.directCache.size > 8) analysis.directCache.delete(analysis.directCache.keys().next().value);
    return result;
}

function alignedAverageAnalysis(analyses, config) {
    if (analyses.length === 1) return analyses[0];
    const prerollSamples = Math.max(1, Math.round(config.sampleRate * 0.005));
    const previewSamples = Math.max(2, Math.round(
        config.sampleRate * Math.max(5, config.directWindowMs) / 1000
    ));
    const postrollSamples = config.taps / 2 + previewSamples;
    const samples = new Float32Array(prerollSamples + postrollSamples);
    for (let index = 0; index < samples.length; index += 1) {
        const relativeIndex = index - prerollSamples;
        let sum = 0;
        let count = 0;
        for (const analysis of analyses) {
            const sourceIndex = analysis.onsetIndex + relativeIndex;
            if (sourceIndex < 0 || sourceIndex >= analysis.samples.length) continue;
            sum += analysis.samples[sourceIndex];
            count += 1;
        }
        if (count) samples[index] = sum / count;
    }
    return {
        samples,
        onsetIndex: prerollSamples,
        fftSize: nextPowerOfTwo(samples.length),
        directCache: new Map()
    };
}

function rbjMagnitude(type, center, gainDb, q, frequency, sampleRate) {
    const nyquistCenter = center < sampleRate * 0.49 ? center : sampleRate * 0.49;
    const omega = 2 * Math.PI * nyquistCenter / sampleRate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    const amplitude = 10 ** (gainDb / 40);
    const alpha = sine / (2 * q);
    const root = Math.sqrt(amplitude);
    let b0;
    let b1;
    let b2;
    let a0;
    let a1;
    let a2;
    if (type === 'ls') {
        b0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + 2 * root * alpha);
        b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine);
        b2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - 2 * root * alpha);
        a0 = (amplitude + 1) + (amplitude - 1) * cosine + 2 * root * alpha;
        a1 = -2 * ((amplitude - 1) + (amplitude + 1) * cosine);
        a2 = (amplitude + 1) + (amplitude - 1) * cosine - 2 * root * alpha;
    } else if (type === 'hs') {
        b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + 2 * root * alpha);
        b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine);
        b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - 2 * root * alpha);
        a0 = (amplitude + 1) - (amplitude - 1) * cosine + 2 * root * alpha;
        a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cosine);
        a2 = (amplitude + 1) - (amplitude - 1) * cosine - 2 * root * alpha;
    } else {
        b0 = 1 + alpha * amplitude;
        b1 = -2 * cosine;
        b2 = 1 - alpha * amplitude;
        a0 = 1 + alpha / amplitude;
        a1 = -2 * cosine;
        a2 = 1 - alpha / amplitude;
    }
    const targetOmega = 2 * Math.PI * frequency / sampleRate;
    const targetCosine = Math.cos(targetOmega);
    const targetSine = Math.sin(targetOmega);
    const doubleCosine = Math.cos(2 * targetOmega);
    const doubleSine = Math.sin(2 * targetOmega);
    const numeratorReal = b0 + b1 * targetCosine + b2 * doubleCosine;
    const numeratorImag = -b1 * targetSine - b2 * doubleSine;
    const denominatorReal = a0 + a1 * targetCosine + a2 * doubleCosine;
    const denominatorImag = -a1 * targetSine - a2 * doubleSine;
    return Math.hypot(numeratorReal, numeratorImag) /
        Math.max(MIN_MAGNITUDE, Math.hypot(denominatorReal, denominatorImag));
}

function equalizerDb(config, frequencies) {
    const result = new Float64Array(frequencies.length);
    for (const band of config.eqBands || []) {
        if (!band.enabled || band.gain === 0) continue;
        for (let index = 0; index < frequencies.length; index += 1) {
            result[index] += gainToDb(rbjMagnitude(
                band.type,
                band.frequency,
                band.gain,
                band.q,
                frequencies[index],
                config.sampleRate
            ));
        }
    }
    return result;
}

function correctionWeight(frequency, low, high, upperLimit = Infinity) {
    const flank = 1 / 3;
    if (frequency >= low && frequency <= high) return 1;
    if (frequency < low) {
        const edge = low / 2 ** flank;
        if (frequency <= edge) return 0;
        const phase = Math.log2(frequency / edge) / flank;
        return 0.5 - 0.5 * Math.cos(Math.PI * phase);
    }
    const edge = Math.min(high * 2 ** flank, upperLimit);
    if (frequency >= edge) return 0;
    const phase = Math.log2(edge / frequency) / flank;
    return 0.5 - 0.5 * Math.cos(Math.PI * phase);
}

export function softLimitBoost(decibels, maximum) {
    const kneeStart = maximum - 1;
    if (decibels <= kneeStart) return decibels;
    if (decibels >= maximum) return maximum;
    const position = decibels - kneeStart;
    return kneeStart + position + position * position - position * position * position;
}

function minimumPhaseForMagnitude(magnitudes, fftSize) {
    const logMagnitude = new Float64Array(fftSize / 2 + 1);
    for (let bin = 0; bin <= fftSize / 2; bin += 1) {
        const value = Math.log(Math.max(MIN_MAGNITUDE, magnitudes[bin]));
        logMagnitude[bin] = value;
    }
    const halfImaginary = new Float64Array(logMagnitude.length);
    const cepstrum = inverseRealTransform(logMagnitude, halfImaginary, fftSize);
    for (let index = 1; index < fftSize / 2; index += 1) cepstrum[index] *= 2;
    for (let index = fftSize / 2 + 1; index < fftSize; index += 1) cepstrum[index] = 0;
    return realTransform(cepstrum).imag;
}

function smoothSynthesisValues(values, frequencies, config) {
    const smoothingFrequencies = createLogFrequencyGrid(
        Math.max(20, frequencies[1] || 20),
        Math.min(config.sampleRate * 0.48, frequencies[frequencies.length - 1]),
        0.01
    );
    const smoothingValues = interpolateValues(
        frequencies.subarray(1),
        values.subarray(1),
        smoothingFrequencies
    );
    const smoothedPoints = smoothFrequencyResponse(
        Array.from(smoothingFrequencies, (frequency, index) => [
            frequency,
            smoothingValues[index]
        ]),
        config.smoothing
    );
    return interpolateValues(
        smoothingFrequencies,
        smoothedPoints.map(point => point[1]),
        frequencies
    );
}

function directPhaseCorrection(direct, frequencies, config, fftSize) {
    const cacheKey = [
        config.lowFrequency,
        config.highFrequency,
        config.directWindowMs,
        config.smoothing,
        config.sampleRate,
        fftSize
    ].join(':');
    const cached = direct.phaseCorrectionCache?.get(cacheKey);
    if (cached) return cached;
    const low = Math.max(config.lowFrequency, 3000 / config.directWindowMs);
    const high = Math.min(config.highFrequency, config.sampleRate * 0.45);
    let first = 0;
    while (first < frequencies.length && frequencies[first] < low) first += 1;
    const inBandMagnitudes = [];
    for (let index = 0; index < frequencies.length; index += 1) {
        if (frequencies[index] >= low && frequencies[index] <= high) {
            inBandMagnitudes.push(direct.magnitude[index]);
        }
    }
    inBandMagnitudes.sort((left, right) => left - right);
    const median = inBandMagnitudes.length
        ? inBandMagnitudes[Math.floor(inBandMagnitudes.length / 2)]
        : 1;
    const floor = Math.max(MIN_MAGNITUDE, median * 0.01);
    const regularizedMagnitude = Float64Array.from(
        direct.magnitude,
        magnitude => magnitude > floor ? magnitude : floor
    );
    const directMinimumPhase = minimumPhaseForMagnitude(regularizedMagnitude, fftSize);
    const rawExcess = new Float64Array(frequencies.length);
    for (let index = 0; index < rawExcess.length; index += 1) {
        rawExcess[index] = direct.phase[index] - directMinimumPhase[index];
    }
    const excess = unwrapPhaseFrom(rawExcess, first);
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (let index = 0; index < frequencies.length; index += 1) {
        if (frequencies[index] < low || frequencies[index] > high) continue;
        const omega = 2 * Math.PI * frequencies[index];
        count += 1;
        sumX += omega;
        sumY += excess[index];
        sumXX += omega * omega;
        sumXY += omega * excess[index];
    }
    const denominator = count * sumXX - sumX * sumX;
    const slope = denominator === 0 ? 0 : (count * sumXY - sumX * sumY) / denominator;
    const intercept = count === 0 ? 0 : (sumY - slope * sumX) / count;
    const residual = Float64Array.from(frequencies, (frequency, index) =>
        excess[index] - (intercept + slope * 2 * Math.PI * frequency));
    const smoothedResidual = smoothSynthesisValues(residual, frequencies, config);
    const phase = new Float64Array(frequencies.length);
    let previousFrequency = frequencies[first] || low;
    let previousResidual = smoothedResidual[first] || 0;
    for (let index = first + 1; index < frequencies.length; index += 1) {
        if (frequencies[index] > high) {
            phase[index] = phase[index - 1];
            continue;
        }
        const deltaOmega = 2 * Math.PI * (frequencies[index] - previousFrequency);
        let delay = deltaOmega === 0 ? 0 : -(smoothedResidual[index] - previousResidual) / deltaOmega;
        const limit = config.directWindowMs / 1000;
        if (delay > limit) delay = limit;
        else if (delay < -limit) delay = -limit;
        phase[index] = phase[index - 1] - delay * deltaOmega;
        previousFrequency = frequencies[index];
        previousResidual = smoothedResidual[index];
    }
    for (let index = 0; index < phase.length; index += 1) {
        phase[index] *= correctionWeight(
            frequencies[index],
            low,
            high,
            config.sampleRate * 0.48
        );
    }
    direct.phaseCorrectionCache?.set(cacheKey, phase);
    if (direct.phaseCorrectionCache?.size > 8) {
        direct.phaseCorrectionCache.delete(direct.phaseCorrectionCache.keys().next().value);
    }
    return phase;
}

function consensusDirectPhaseCorrection(directs, frequencies, config, fftSize) {
    if (directs.length === 1) {
        return directPhaseCorrection(directs[0], frequencies, config, fftSize);
    }
    const corrections = directs.map(direct =>
        directPhaseCorrection(direct, frequencies, config, fftSize));
    const low = Math.max(config.lowFrequency, 3000 / config.directWindowMs);
    const high = Math.min(config.highFrequency, config.sampleRate * 0.45);
    const upper = Math.min(high * 2 ** (1 / 3), config.sampleRate * 0.48);
    let first = 0;
    while (first < frequencies.length && frequencies[first] < low) first += 1;

    const magnitudeFloors = directs.map(direct => {
        const magnitudes = [];
        for (let index = first; index < frequencies.length &&
            frequencies[index] <= high; index += 1) {
            magnitudes.push(direct.magnitude[index]);
        }
        magnitudes.sort((left, right) => left - right);
        const median = magnitudes.length
            ? magnitudes[Math.floor(magnitudes.length / 2)]
            : 1;
        return Math.max(MIN_MAGNITUDE, median * 0.01);
    });
    const wrappedPhase = new Float64Array(frequencies.length);
    const agreement = new Float64Array(frequencies.length);
    for (let index = first; index < frequencies.length &&
        frequencies[index] <= upper; index += 1) {
        let real = 0;
        let imaginary = 0;
        let weightSum = 0;
        for (let point = 0; point < directs.length; point += 1) {
            const reliability = directs[point].magnitude[index] / magnitudeFloors[point];
            const weight = reliability < 1 ? reliability * reliability : 1;
            const phase = corrections[point][index];
            real += Math.cos(phase) * weight;
            imaginary += Math.sin(phase) * weight;
            weightSum += weight;
        }
        if (weightSum > 0) {
            wrappedPhase[index] = Math.atan2(imaginary, real);
            agreement[index] = Math.hypot(real, imaginary) / weightSum;
        }
    }
    const unwrappedPhase = unwrapPhaseFrom(wrappedPhase, first);
    const consensus = new Float64Array(frequencies.length);
    for (let index = first; index < consensus.length &&
        frequencies[index] <= upper; index += 1) {
        consensus[index] = unwrappedPhase[index] * agreement[index];
    }
    return consensus;
}

function predictedDirectResponse(direct, correctionMagnitudes, correctionPhase, fftSize) {
    const real = new Float64Array(fftSize / 2 + 1);
    const imaginary = new Float64Array(real.length);
    for (let bin = 0; bin < real.length; bin += 1) {
        const magnitude = direct.magnitude[bin] * correctionMagnitudes[bin];
        const phase = direct.phase[bin] + correctionPhase[bin];
        real[bin] = magnitude * Math.cos(phase);
        imaginary[bin] = magnitude * Math.sin(phase);
    }
    imaginary[0] = 0;
    imaginary[imaginary.length - 1] = 0;
    return inverseRealTransform(real, imaginary, fftSize);
}

function localPeakEnergy(samples, center, weights) {
    const radius = (weights.length - 1) / 2;
    let sampleIndex = center - radius;
    if (sampleIndex < 0) sampleIndex += samples.length;
    else if (sampleIndex >= samples.length) sampleIndex -= samples.length;
    let energy = 0;
    for (let weightIndex = 0; weightIndex < weights.length; weightIndex += 1) {
        const sample = samples[sampleIndex];
        energy += sample * sample * weights[weightIndex];
        sampleIndex += 1;
        if (sampleIndex === samples.length) sampleIndex = 0;
    }
    return energy;
}

function dominantEnergyPosition(samples, weights, searchCenter = null, searchRadius = 0) {
    const centerIndex = searchCenter === null ? 0 : Math.round(searchCenter);
    const count = searchCenter === null ? samples.length : searchRadius * 2 + 1;
    let bestIndex = centerIndex;
    let bestEnergy = -1;
    let bestDistance = Infinity;
    for (let step = 0; step < count; step += 1) {
        const offset = searchCenter === null ? step : step - searchRadius;
        let index = centerIndex + offset;
        if (index < 0) index += samples.length;
        else if (index >= samples.length) index -= samples.length;
        const energy = localPeakEnergy(samples, index, weights);
        const distance = Math.abs(offset);
        if (energy > bestEnergy || (energy === bestEnergy && distance < bestDistance)) {
            bestIndex = index;
            bestEnergy = energy;
            bestDistance = distance;
        }
    }
    const left = localPeakEnergy(samples,
        bestIndex === 0 ? samples.length - 1 : bestIndex - 1, weights);
    const right = localPeakEnergy(samples,
        bestIndex === samples.length - 1 ? 0 : bestIndex + 1, weights);
    const denominator = left - 2 * bestEnergy + right;
    let fraction = denominator < 0 ? 0.5 * (left - right) / denominator : 0;
    if (fraction > 0.5) fraction = 0.5;
    else if (fraction < -0.5) fraction = -0.5;
    return bestIndex + (Number.isFinite(fraction) ? fraction : 0);
}

function correctionTimingAlignment(
    direct,
    correctionMagnitudes,
    referencePhase,
    correctionPhase,
    config,
    fftSize
) {
    const energyRadius = Math.max(1, Math.round(config.sampleRate * 0.000125));
    const weights = new Float64Array(energyRadius * 2 + 1);
    for (let index = 0; index < weights.length; index += 1) {
        const offset = index - energyRadius;
        weights[index] = 0.5 + 0.5 * Math.cos(
            Math.PI * offset / (energyRadius + 1)
        );
    }
    const referenceResponse = predictedDirectResponse(
        direct,
        correctionMagnitudes,
        referencePhase,
        fftSize
    );
    const referencePosition = dominantEnergyPosition(referenceResponse, weights);
    const correctedResponse = predictedDirectResponse(
        direct,
        correctionMagnitudes,
        correctionPhase,
        fftSize
    );
    const tapHeadroom = config.taps / 2 - 1;
    const windowLimit = Math.round(config.sampleRate * config.directWindowMs / 1000);
    const searchRadius = Math.min(tapHeadroom, windowLimit);
    const correctedPosition = dominantEnergyPosition(
        correctedResponse,
        weights,
        referencePosition,
        searchRadius
    );
    let sampleOffset = correctedPosition - referencePosition;
    if (sampleOffset > fftSize / 2) sampleOffset -= fftSize;
    else if (sampleOffset < -fftSize / 2) sampleOffset += fftSize;
    return Number.isFinite(sampleOffset) ? sampleOffset / config.sampleRate : 0;
}

function verifySynthesis(taps, intendedMagnitudes, intendedReal, intendedImaginary, config) {
    const fftSize = config.taps * 2;
    const input = new Float64Array(fftSize);
    input.set(taps);
    const spectrum = realTransform(input);
    const effectiveHigh = Math.min(config.highFrequency, config.sampleRate * 0.45);
    let maximumMagnitudeErrorDb = 0;
    let minimumPhaseCosine = 1;
    for (let bin = 1; bin < spectrum.real.length; bin += 1) {
        const frequency = bin * config.sampleRate / fftSize;
        if (frequency < config.lowFrequency || frequency > effectiveHigh) continue;
        const actualReal = spectrum.real[bin];
        const actualImaginary = spectrum.imag[bin];
        const actualPower = actualReal * actualReal + actualImaginary * actualImaginary;
        const intendedMagnitude = intendedMagnitudes[bin];
        const intendedPower = intendedMagnitude * intendedMagnitude;
        const magnitudeError = Math.abs(10 * Math.log10(
            Math.max(MIN_MAGNITUDE * MIN_MAGNITUDE, actualPower) / intendedPower
        ));
        if (magnitudeError > maximumMagnitudeErrorDb) maximumMagnitudeErrorDb = magnitudeError;
        if (config.phase !== 'min') {
            const denominator = Math.sqrt(actualPower * intendedPower);
            if (denominator > MIN_MAGNITUDE * MIN_MAGNITUDE) {
                const phaseCosine = (
                    actualReal * intendedReal[bin] + actualImaginary * intendedImaginary[bin]
                ) / denominator;
                if (phaseCosine < minimumPhaseCosine) minimumPhaseCosine = phaseCosine;
            }
        }
    }
    const maximumPhaseErrorRadians = config.phase === 'min'
        ? 0
        : Math.acos(Math.max(-1, Math.min(1, minimumPhaseCosine)));
    return { maximumMagnitudeErrorDb, maximumPhaseErrorRadians };
}

function synthesizeFilter(correctionDb, gridFrequencies, config, phaseSource) {
    const plan = getSynthesisPlan(gridFrequencies, config);
    const { fftSize, binFrequencies } = plan;
    const interpolated = interpolateWithPlan(correctionDb, plan);
    const magnitudes = Float64Array.from(interpolated, dbToGain);
    let phase = new Float64Array(magnitudes.length);
    if (config.phase === 'min') {
        phase = Float64Array.from(minimumPhaseForMagnitude(magnitudes, fftSize));
    } else if (config.phase === 'full') {
        const referencePhase = Float64Array.from(minimumPhaseForMagnitude(magnitudes, fftSize));
        phase = Float64Array.from(referencePhase);
        const correction = phaseSource?.candidates?.length
            ? consensusDirectPhaseCorrection(
                phaseSource.candidates,
                binFrequencies,
                config,
                fftSize
            )
            : null;
        for (let bin = 0; bin < phase.length; bin += 1) {
            phase[bin] -= (correction?.[bin] || 0) * config.phaseCorrectionAmount;
        }
        const timingAlignment = phaseSource?.timing && config.phaseCorrectionAmount > 0
            ? correctionTimingAlignment(
                phaseSource.timing,
                magnitudes,
                referencePhase,
                phase,
                config,
                fftSize
            )
            : 0;
        for (let bin = 0; bin < phase.length; bin += 1) {
            phase[bin] += 2 * Math.PI * binFrequencies[bin] * timingAlignment -
                2 * Math.PI * bin / fftSize * (config.taps / 2);
        }
    }
    const real = new Float64Array(fftSize / 2 + 1);
    const imag = new Float64Array(fftSize / 2 + 1);
    if (config.phase === 'lin') {
        for (let bin = 0; bin <= fftSize / 2; bin += 1) {
            const magnitude = magnitudes[bin];
            if ((bin & 3) === 0) real[bin] = magnitude;
            else if ((bin & 3) === 1) imag[bin] = -magnitude;
            else if ((bin & 3) === 2) real[bin] = -magnitude;
            else imag[bin] = magnitude;
        }
    } else {
        for (let bin = 0; bin <= fftSize / 2; bin += 1) {
            real[bin] = magnitudes[bin] * Math.cos(phase[bin]);
            imag[bin] = magnitudes[bin] * Math.sin(phase[bin]);
        }
    }
    imag[0] = 0;
    imag[imag.length - 1] = 0;
    const time = inverseRealTransform(real, imag, fftSize);
    const taps = new Float32Array(config.taps);
    const window = config.phase === 'min' ? plan.minimumWindow : plan.linearWindow;
    for (let index = 0; index < config.taps; index += 1) {
        taps[index] = time[index] * window[index];
    }
    return {
        taps,
        magnitudes,
        verification: verifySynthesis(taps, magnitudes, real, imag, config)
    };
}

function createImpulseResponsePreview(analysis, taps, config) {
    const previewDurationMs = Math.max(5, config.directWindowMs);
    const sampleCount = Math.max(2, Math.round(
        config.sampleRate * previewDurationMs / 1000
    ));
    const prerollSamples = Math.max(1, Math.round(config.sampleRate * 0.005));
    const displaySampleCount = prerollSamples + sampleCount;
    const before = new Float32Array(displaySampleCount);
    const beforeStart = analysis.onsetIndex - prerollSamples;
    for (let index = 0; index < displaySampleCount; index += 1) {
        before[index] = analysis.samples[beforeStart + index] || 0;
    }

    const filterDelay = config.phase === 'min' ? 0 : taps.length / 2;
    const correctedSampleCount = filterDelay + displaySampleCount;
    const fftSize = nextPowerOfTwo(taps.length + correctedSampleCount - 1);
    const input = new Float64Array(fftSize);
    const correctedStart = analysis.onsetIndex - prerollSamples;
    const inputStart = correctedStart - (taps.length - 1);
    for (let index = 0; index < input.length; index += 1) {
        input[index] = analysis.samples[inputStart + index] || 0;
    }
    const paddedTaps = new Float64Array(fftSize);
    paddedTaps.set(taps);
    const inputSpectrum = realTransform(input);
    const filterSpectrum = realTransform(paddedTaps);
    const correctedReal = new Float64Array(inputSpectrum.real.length);
    const correctedImaginary = new Float64Array(inputSpectrum.imag.length);
    for (let bin = 0; bin < correctedReal.length; bin += 1) {
        correctedReal[bin] =
            inputSpectrum.real[bin] * filterSpectrum.real[bin] -
            inputSpectrum.imag[bin] * filterSpectrum.imag[bin];
        correctedImaginary[bin] =
            inputSpectrum.real[bin] * filterSpectrum.imag[bin] +
            inputSpectrum.imag[bin] * filterSpectrum.real[bin];
    }
    const correctedTime = inverseRealTransform(correctedReal, correctedImaginary, fftSize);
    const firstValidSample = taps.length - 1;
    const after = new Float32Array(displaySampleCount);
    const afterStart = firstValidSample + filterDelay;
    for (let index = 0; index < displaySampleCount; index += 1) {
        after[index] = correctedTime[afterStart + index] || 0;
    }
    return {
        sampleRate: config.sampleRate,
        startMs: -prerollSamples * 1000 / config.sampleRate,
        durationMs: sampleCount * 1000 / config.sampleRate,
        before,
        after
    };
}

function unitImpulse(config) {
    const taps = new Float32Array(config.taps);
    taps[config.phase === 'min' ? 0 : config.taps / 2] = 1;
    return taps;
}

function normalizeConfig(config) {
    const phase = ['min', 'lin', 'full'].includes(config.phase) ? config.phase : 'lin';
    const taps = [8192, 16384, 32768, 65536, 131072].includes(config.taps) ? config.taps : 32768;
    const requestedReferencePoint = Number(config.referencePoint);
    return {
        ...config,
        phase,
        taps,
        sampleRate: Math.round(config.sampleRate || 48000),
        smoothing: Math.max(0.02, Math.min(1, config.smoothing ?? 0.17)),
        lowFrequency: Math.max(20, config.lowFrequency ?? 20),
        highFrequency: Math.min(20000, config.highFrequency ?? 16000),
        directWindowMs: Math.max(1, Math.min(50, config.directWindowMs ?? 6)),
        maxBoostDb: Math.max(0, Math.min(18, config.maxBoostDb ?? 6)),
        correctionAmount: Math.max(0, Math.min(1, config.correctionAmount ?? 1)),
        phaseCorrectionAmount: Math.max(0, Math.min(1, config.phaseCorrectionAmount ?? 1)),
        referencePoint: Number.isSafeInteger(requestedReferencePoint) &&
            requestedReferencePoint >= 0
            ? requestedReferencePoint
            : 0
    };
}

function designCacheKey(config, sources) {
    const configIdentity = {
        sampleRate: config.sampleRate,
        taps: config.taps,
        phase: config.phase,
        smoothing: config.smoothing,
        lowFrequency: config.lowFrequency,
        highFrequency: config.highFrequency,
        directWindowMs: config.directWindowMs,
        maxBoostDb: config.maxBoostDb,
        correctionAmount: config.correctionAmount,
        phaseCorrectionAmount: config.phaseCorrectionAmount,
        referencePoint: config.referencePoint,
        eqBands: (config.eqBands || []).map(band => [
            Boolean(band.enabled),
            band.type,
            band.frequency,
            band.gain,
            band.q
        ])
    };
    const sourceIdentity = (sources || []).map(source => {
        if (!source?.measurement) return null;
        const measurement = source.measurement;
        const pointTimestamps = new Map((measurement.points || []).map(point => [
            point.pointId,
            point.timestamp || null
        ]));
        const impulses = (source.impulses || []).filter(impulse => impulse?.data);
        return {
            measurement: [
                measurement.id || null,
                measurement.lastModified || null,
                measurement.timestamp || null
            ],
            impulses: impulses.map(impulse => [
                impulse.measurementId || measurement.id || null,
                impulse.pointId,
                pointTimestamps.get(impulse.pointId) || null,
                impulse.sampleRate,
                impulse.onsetIndex,
                impulse.refScale ?? 1,
                impulse.data.length
            ]),
            frequencyResponse: impulses.length ? null : measurement.averageFrequencyResponse || []
        };
    });
    return JSON.stringify([configIdentity, sourceIdentity]);
}

function cloneDesignResult(result) {
    return {
        channels: result.channels.map(channel => Float32Array.from(channel)),
        previews: result.previews.map(preview => preview ? {
            channel: preview.channel,
            referenceLevelDb: preview.referenceLevelDb,
            frequencies: Float32Array.from(preview.frequencies),
            measuredDb: Float32Array.from(preview.measuredDb),
            targetDb: Float32Array.from(preview.targetDb),
            predictedDb: Float32Array.from(preview.predictedDb),
            baseCorrectionDb: Float32Array.from(preview.baseCorrectionDb),
            impulseResponse: preview.impulseResponse ? {
                sampleRate: preview.impulseResponse.sampleRate,
                startMs: preview.impulseResponse.startMs,
                durationMs: preview.impulseResponse.durationMs,
                before: Float32Array.from(preview.impulseResponse.before),
                after: Float32Array.from(preview.impulseResponse.after)
            } : null
        } : null),
        qualityWarnings: [...result.qualityWarnings],
        supportsFullPhase: result.supportsFullPhase,
        latencyInfo: { ...result.latencyInfo },
        config: {
            ...result.config,
            eqBands: (result.config.eqBands || []).map(band => ({ ...band }))
        }
    };
}

export function designRoomEq(request) {
    const config = normalizeConfig(request.config || {});
    const cacheKey = designCacheKey(config, request.sources);
    const cached = designCache.get(cacheKey);
    if (cached) return cloneDesignResult(cached);
    const nyquist = config.sampleRate / 2;
    const frequencies = createLogFrequencyGrid(20, Math.min(20000, nyquist * 0.96), 0.01);
    const eqDb = equalizerDb(config, frequencies);
    const channels = [];
    const previews = [];
    const qualityWarnings = [];
    let supportsFullPhase = true;
    for (let channelIndex = 0; channelIndex < (request.sources || []).length; channelIndex += 1) {
        const source = request.sources[channelIndex];
        if (!source?.measurement) {
            channels.push(unitImpulse(config));
            previews.push(null);
            continue;
        }
        const impulses = Array.isArray(source.impulses) ? source.impulses.filter(value => value?.data) : [];
        let measuredDb;
        let displayMeasuredDb;
        let referenceAnalysis = null;
        let phaseSource = null;
        if (impulses.length) {
            const analyses = impulses.map(impulse => analyzeImpulse(impulse, config.sampleRate, frequencies));
            const powerMean = new Float64Array(frequencies.length);
            const decibelMean = new Float64Array(frequencies.length);
            for (const analysis of analyses) {
                for (let index = 0; index < powerMean.length; index += 1) {
                    powerMean[index] += analysis.magnitude[index] * analysis.magnitude[index] / analyses.length;
                    decibelMean[index] += gainToDb(analysis.magnitude[index]) / analyses.length;
                }
            }
            measuredDb = Array.from(powerMean, value => gainToDb(Math.sqrt(value)));
            displayMeasuredDb = Array.from(decibelMean);
            const requestedPointIndex = config.referencePoint > 0
                ? impulses.findIndex((impulse, index) => {
                    const pointId = Number.isSafeInteger(impulse.pointId) && impulse.pointId >= 0
                        ? impulse.pointId
                        : index;
                    return pointId + 1 === config.referencePoint;
                })
                : -1;
            const consensus = requestedPointIndex < 0;
            referenceAnalysis = consensus
                ? alignedAverageAnalysis(analyses, config)
                : analyses[requestedPointIndex];
            const synthesisFrequencies = new Float64Array(config.taps + 1);
            for (let bin = 0; bin <= config.taps; bin += 1) {
                synthesisFrequencies[bin] = bin * config.sampleRate / (config.taps * 2);
            }
            if (config.phase === 'full') {
                const timing = directSpectrum(
                    referenceAnalysis,
                    config.sampleRate,
                    config.directWindowMs,
                    synthesisFrequencies
                );
                phaseSource = {
                    timing,
                    candidates: (consensus ? analyses : [referenceAnalysis]).map(analysis =>
                        directSpectrum(
                            analysis,
                            config.sampleRate,
                            config.directWindowMs,
                            synthesisFrequencies
                        ))
                };
            }
        } else {
            supportsFullPhase = false;
            const response = source.measurement.averageFrequencyResponse || [];
            measuredDb = interpolateLogResponse(response, frequencies).map(point => point[1]);
            displayMeasuredDb = measuredDb;
        }
        const unsmoothedMeasuredDb = measuredDb;
        const smoothed = smoothFrequencyResponse(
            frequencies.map((frequency, index) => [frequency, measuredDb[index]]),
            config.smoothing
        );
        measuredDb = smoothed.map(point => point[1]);
        const displaySmoothed = impulses.length
            ? smoothFrequencyResponse(
                frequencies.map((frequency, index) => [frequency, displayMeasuredDb[index]]),
                config.smoothing
            ).map(point => point[1])
            : measuredDb;
        const effectiveHigh = Math.min(config.highFrequency, config.sampleRate * 0.45);
        let levelPower = 0;
        let levelCount = 0;
        for (let index = 0; index < frequencies.length; index += 1) {
            if (frequencies[index] < config.lowFrequency || frequencies[index] > effectiveHigh) continue;
            const gain = dbToGain(measuredDb[index]);
            levelPower += gain * gain;
            levelCount += 1;
        }
        const levelDb = gainToDb(Math.sqrt(levelPower / (levelCount || 1)));
        const smoothedAutomaticCorrection = smoothFrequencyResponse(
            frequencies.map((frequency, index) => [
                frequency,
                frequency > config.lowFrequency && frequency < effectiveHigh
                    ? softLimitBoost(
                        levelDb - unsmoothedMeasuredDb[index],
                        config.maxBoostDb
                    )
                    : 0
            ]),
            config.smoothing
        );
        const correctionDb = new Float64Array(frequencies.length);
        const baseCorrectionDb = new Float64Array(frequencies.length);
        const targetDb = new Float64Array(frequencies.length);
        const predictedDb = new Float64Array(frequencies.length);
        for (let index = 0; index < frequencies.length; index += 1) {
            baseCorrectionDb[index] =
                smoothedAutomaticCorrection[index][1] * config.correctionAmount;
            correctionDb[index] = baseCorrectionDb[index] + eqDb[index];
            targetDb[index] = levelDb + eqDb[index];
            predictedDb[index] = measuredDb[index] + correctionDb[index];
        }
        const synthesis = synthesizeFilter(correctionDb, frequencies, config, phaseSource);
        if (synthesis.verification.maximumMagnitudeErrorDb > 0.5 ||
            synthesis.verification.maximumPhaseErrorRadians > 0.05) {
            qualityWarnings.push(QUALITY_WARNING_FILTER_ACCURACY);
        }
        channels.push(synthesis.taps);
        previews.push({
            channel: channelIndex,
            referenceLevelDb: levelDb,
            frequencies: Float32Array.from(frequencies),
            measuredDb: Float32Array.from(displaySmoothed),
            targetDb: Float32Array.from(targetDb),
            predictedDb: Float32Array.from(predictedDb),
            baseCorrectionDb: Float32Array.from(baseCorrectionDb),
            impulseResponse: referenceAnalysis
                ? createImpulseResponsePreview(referenceAnalysis, synthesis.taps, config)
                : null
        });
    }
    if (config.phase === 'full' && !supportsFullPhase) {
        qualityWarnings.push(QUALITY_WARNING_IMPULSE_RESPONSE_REQUIRED);
    }
    const result = {
        channels,
        previews,
        qualityWarnings,
        supportsFullPhase,
        latencyInfo: {
            filterDelaySamples: config.phase === 'min' ? 0 : config.taps / 2,
            resolutionHz: config.sampleRate / config.taps
        },
        config
    };
    designCache.set(cacheKey, cloneDesignResult(result));
    if (designCache.size > 2) designCache.delete(designCache.keys().next().value);
    return result;
}
