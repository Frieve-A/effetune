import FFT from '../utils/measurement-dsp/fft.js';
import {
    createLogFrequencyGrid,
    interpolateLogResponse,
    smoothFrequencyResponse
} from '../utils/measurement-dsp/smoothing.js';
import { resampleWindowedSinc } from '../utils/measurement-dsp/resample.js';
import {
    analyzeRoomEqGroupDelay,
    averageRoomEqGroupDelay,
    combineRoomEqGroupDelay,
    integrateRoomEqGroupDelayPhase,
    smoothRoomEqGroupDelay
} from './group-delay-analysis.js';

const MIN_MAGNITUDE = 1e-8;
const IMPULSE_PREVIEW_MAX_FREQUENCY = 20000;
const QUALITY_WARNING_FILTER_ACCURACY = 'filterAccuracy';
const QUALITY_WARNING_IMPULSE_RESPONSE_REQUIRED = 'impulseResponseRequired';
const LOW_PHASE_SCALE_STEPS = [1, 0.5, 0.25];
const LOW_PHASE_SCALE_SEARCH_STEPS = 16;
const LOW_PHASE_SCALE_REFINEMENT_STEPS = 8;
const MAX_LOW_PHASE_EDGE_ENERGY_RATIO = 0.002;
const LOW_PHASE_SUBSONIC_CLOSURE_HZ = 20;
const LOW_PHASE_ACTIVE_ABSOLUTE_TOLERANCE = 0.0001;
const LOW_PHASE_ACTIVE_RELATIVE_TOLERANCE = 0.02;
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

function inverseRealTransformPolarProduct(
    firstMagnitudes,
    firstPhases,
    secondMagnitudes,
    secondPhases,
    size
) {
    if (typeof fftBackend?.inverseRealTransformPolarProduct === 'function') {
        return fftBackend.inverseRealTransformPolarProduct(
            firstMagnitudes,
            firstPhases,
            secondMagnitudes,
            secondPhases,
            size
        );
    }
    const real = new Float64Array(size / 2 + 1);
    const imaginary = new Float64Array(real.length);
    for (let bin = 0; bin < real.length; bin += 1) {
        const magnitude = firstMagnitudes[bin] * secondMagnitudes[bin];
        const phase = firstPhases[bin] + secondPhases[bin];
        real[bin] = magnitude * Math.cos(phase);
        imaginary[bin] = magnitude * Math.sin(phase);
    }
    imaginary[0] = 0;
    imaginary[imaginary.length - 1] = 0;
    return inverseRealTransform(real, imaginary, size);
}

function bandLimitImpulsePreviewSpectrum(spectrum, sampleRate, fftSize) {
    const firstFilteredBin = Math.ceil(
        IMPULSE_PREVIEW_MAX_FREQUENCY * fftSize / sampleRate
    );
    for (let bin = firstFilteredBin; bin < spectrum.real.length; bin += 1) {
        spectrum.real[bin] = 0;
        spectrum.imag[bin] = 0;
    }
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

function unwrapPhaseAround(phases, anchor) {
    const output = Float64Array.from(phases);
    let offset = 0;
    for (let index = anchor + 1; index < output.length; index += 1) {
        const current = output[index] + offset;
        const difference = current - output[index - 1];
        if (difference > Math.PI) offset -= 2 * Math.PI;
        else if (difference < -Math.PI) offset += 2 * Math.PI;
        output[index] += offset;
    }
    for (let index = anchor - 1; index >= 0; index -= 1) {
        let value = output[index];
        const difference = value - output[index + 1];
        if (difference > Math.PI) value -= 2 * Math.PI * Math.ceil(
            (difference - Math.PI) / (2 * Math.PI)
        );
        else if (difference < -Math.PI) value += 2 * Math.PI * Math.ceil(
            (-difference - Math.PI) / (2 * Math.PI)
        );
        output[index] = value;
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

function createInterpolationPlan(frequencies, targetFrequencies) {
    const lowerIndices = new Uint32Array(targetFrequencies.length);
    const fractions = new Float64Array(targetFrequencies.length);
    let upper = 1;
    for (let index = 0; index < targetFrequencies.length; index += 1) {
        const frequency = targetFrequencies[index];
        while (upper < frequencies.length && frequencies[upper] < frequency) upper += 1;
        if (frequency <= frequencies[0]) {
            lowerIndices[index] = 0;
            fractions[index] = 0;
        } else if (upper >= frequencies.length) {
            lowerIndices[index] = frequencies.length - 2;
            fractions[index] = 1;
        } else {
            const low = frequencies[upper - 1];
            const high = frequencies[upper];
            lowerIndices[index] = upper - 1;
            fractions[index] = Math.log(frequency / low) / Math.log(high / low);
        }
    }
    return { binFrequencies: targetFrequencies, lowerIndices, fractions };
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

function interpolateGainsWithPlan(values, plan) {
    const result = new Float64Array(plan.binFrequencies.length);
    for (let index = 0; index < result.length; index += 1) {
        const lower = plan.lowerIndices[index];
        const fraction = plan.fractions[index];
        const decibels = values[lower] + fraction * (values[lower + 1] - values[lower]);
        result[index] = dbToGain(decibels);
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

function impulseDataDigest(data) {
    const scratch = new DataView(new ArrayBuffer(4));
    let first = 2166136261;
    let second = 0;
    for (let index = 0; index < data.length; index += 1) {
        scratch.setFloat32(0, data[index], true);
        for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
            const value = scratch.getUint8(byteIndex);
            first = Math.imul(first ^ value, 16777619);
            second += value;
            second += second << 10;
            second ^= second >>> 6;
        }
    }
    second += second << 3;
    second ^= second >>> 11;
    second += second << 15;
    return `${data.length}:${first >>> 0}:${second >>> 0}`;
}

function impulseSourceIdentity(measurement, impulse) {
    const point = (measurement?.points || []).find(candidate =>
        candidate.pointId === impulse.pointId);
    return [
        impulse.measurementId || measurement?.id || null,
        measurement?.lastModified || null,
        measurement?.timestamp || null,
        impulse.pointId,
        point?.lastModified || null,
        point?.timestamp || null,
        impulse.onsetIndex,
        impulseDataDigest(impulse.data)
    ];
}

function magnitudeSpectrum(analysis) {
    if (analysis.spectrumMagnitude) return analysis.spectrumMagnitude;
    const input = new Float64Array(analysis.fftSize);
    input.set(analysis.samples);
    const spectrum = realTransform(input);
    analysis.spectrumMagnitude = Float64Array.from(
        spectrum.real,
        (real, bin) => Math.hypot(real, spectrum.imag[bin])
    );
    return analysis.spectrumMagnitude;
}

function analyzeImpulse(impulse, contextRate, frequencies, sourceIdentity) {
    const cacheable = sourceIdentity !== null;
    const cacheKey = cacheable
        ? `${JSON.stringify(sourceIdentity)}:${contextRate}:${impulse.sampleRate}:` +
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
    const spectrumMagnitude = Float64Array.from(
        spectrum.real,
        (real, bin) => Math.hypot(real, spectrum.imag[bin])
    );
    const analysis = {
        samples,
        onsetIndex,
        fftSize,
        directCache: new Map(),
        spectrumMagnitude,
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

function directSpectrum(
    analysis,
    sampleRate,
    directWindowMs,
    synthesisFrequencies,
    includeFullMagnitude,
    taperMs = directWindowMs
) {
    const cacheKey = `${directWindowMs}:${synthesisFrequencies.length}:` +
        `${includeFullMagnitude ? 1 : 0}:${taperMs}`;
    const cached = analysis.directCache.get(cacheKey);
    if (cached) return cached;
    const input = new Float64Array(analysis.fftSize);
    const start = Math.max(0, analysis.onsetIndex - Math.round(sampleRate * 0.001));
    const end = Math.min(analysis.samples.length,
        analysis.onsetIndex + Math.max(1, Math.round(sampleRate * directWindowMs / 1000)));
    // The user-facing window remains fully represented except for a terminal
    // taper that closes the truncated response without fading the whole interval.
    const fadeLength = Math.max(1, Math.min(
        end - analysis.onsetIndex,
        Math.round(sampleRate * taperMs / 1000)
    ));
    const fadeStart = end - fadeLength;
    for (let index = start; index < end; index += 1) {
        let gain = 1;
        if (index >= fadeStart) {
            const phase = (index - fadeStart) / fadeLength;
            gain = 0.5 + 0.5 * Math.cos(Math.PI * phase);
        }
        input[index] = analysis.samples[index] * gain;
    }
    const spectrum = realTransform(input);
    const sourceFrequencies = new Float64Array(spectrum.real.length);
    const magnitude = new Float64Array(spectrum.real.length);
    for (let bin = 0; bin < spectrum.real.length; bin += 1) {
        sourceFrequencies[bin] = bin * sampleRate / analysis.fftSize;
        magnitude[bin] = Math.hypot(spectrum.real[bin], spectrum.imag[bin]);
    }
    const sourceFrequencyRange = sourceFrequencies.subarray(1);
    const interpolationPlan = createInterpolationPlan(
        sourceFrequencyRange,
        synthesisFrequencies
    );
    const delayAnalysis = analyzeRoomEqGroupDelay(
        input,
        analysis.onsetIndex,
        sampleRate,
        synthesisFrequencies,
        { minimumFftSize: analysis.fftSize, spectrum }
    );
    const alignedWrappedPhase = new Float64Array(synthesisFrequencies.length);
    for (let index = 0; index < synthesisFrequencies.length; index += 1) {
        const frequency = synthesisFrequencies[index];
        const position = frequency * analysis.fftSize / sampleRate;
        const lower = Math.min(spectrum.real.length - 1, Math.floor(position));
        const upper = Math.min(spectrum.real.length - 1, lower + 1);
        const fraction = upper === lower ? 0 : position - lower;
        const real = spectrum.real[lower] +
            fraction * (spectrum.real[upper] - spectrum.real[lower]);
        const imaginary = spectrum.imag[lower] +
            fraction * (spectrum.imag[upper] - spectrum.imag[lower]);
        alignedWrappedPhase[index] = Math.atan2(imaginary, real) +
            2 * Math.PI * frequency * analysis.onsetIndex / sampleRate;
    }
    const totalGroupDelaySeconds = Float64Array.from(
        delayAnalysis.totalMs,
        value => value / 1000
    );
    const result = {
        magnitude: interpolateWithPlan(magnitude.subarray(1), interpolationPlan),
        fullMagnitude: includeFullMagnitude
            ? interpolateWithPlan(magnitudeSpectrum(analysis).subarray(1), interpolationPlan)
            : null,
        phase: integrateRoomEqGroupDelayPhase(
            synthesisFrequencies,
            totalGroupDelaySeconds,
            delayAnalysis.valid,
            alignedWrappedPhase
        ),
        totalGroupDelaySeconds,
        minimumGroupDelaySeconds: Float64Array.from(
            delayAnalysis.minimumMs,
            value => value / 1000
        ),
        excessGroupDelaySeconds: Float64Array.from(
            delayAnalysis.excessMs,
            value => value / 1000
        ),
        groupDelayValid: delayAnalysis.valid,
        phaseCorrectionCache: new Map(),
        lowPhaseCorrectionCache: new Map(),
        samples: analysis.samples,
        onsetIndex: analysis.onsetIndex,
        groupDelaySamples: analysis.groupDelaySamples,
        groupDelayOnsetIndex: analysis.groupDelayOnsetIndex,
        sampleRate
    };
    analysis.directCache.set(cacheKey, result);
    if (analysis.directCache.size > 8) analysis.directCache.delete(analysis.directCache.keys().next().value);
    return result;
}

// Single definition of the impulse-preview display window (plan section 5 Phase 5
// item 4 / section 7): the largest of 5 ms, the Direct Window and -- only while
// the reverb correction is requested -- the Reverb Window capped at 50 ms, so the
// cancelled reverberant tail is visible. The user-facing Reverb Window (rw) is the
// term, matching the documented rule; the data-clamped effective window is a
// diagnostic, not a display contract. With rv = 0 the third term is 0 and the
// length stays exactly as before.
// The Consensus average only synthesizes samples it is asked for, so it must
// synthesize this far as well or the tail of every multi-point preview is zero-fill
// (see alignedAverageAnalysis). It must NOT, however, size the analysis this rule
// feeds -- that is dspWindowSamples' job.
function previewWindowSamples(config) {
    const previewDurationMs = Math.max(
        5,
        config.directWindowMs,
        config.reverbAmount > 0 ? Math.min(config.reverbWindowMs, 50) : 0
    );
    return Math.max(2, Math.round(config.sampleRate * previewDurationMs / 1000));
}

// Companion rule to previewWindowSamples, and deliberately a separate function:
// this is the DSP window of the Consensus average -- the length every correction
// path is derived from (the FFT size and therefore the bin grid of every spectrum,
// the LFE's available-window budget, the phase/group-delay previews). It depends
// only on the correction parameters, never on what the display happens to show, so
// widening the display window cannot move a shipped sample. Never merge the two
// back into one value: a display rule that reaches the FFT size retunes the whole
// phase path at every nextPowerOfTwo boundary it crosses.
function dspWindowSamples(config) {
    return Math.max(2, Math.round(
        config.sampleRate * Math.max(5, config.directWindowMs) / 1000
    ));
}

function alignedAverageAnalysis(analyses, config) {
    if (analyses.length === 1) return analyses[0];
    const prerollSamples = Math.max(1, Math.round(config.sampleRate * 0.005));
    // Two lengths over one synthesized buffer. `dspLength` is what the analysis
    // sees (`samples`, `fftSize`); `displayLength` additionally covers the preview
    // window and is exposed only as `previewSamples`, which only
    // createImpulseResponsePreview reads. Both views start at index 0 of the same
    // buffer, so the DSP view is bit-identical to a buffer synthesized at
    // `dspLength` alone.
    const dspLength = prerollSamples + config.taps / 2 + dspWindowSamples(config);
    const displayLength = prerollSamples + config.taps / 2 + previewWindowSamples(config);
    const samples = new Float32Array(dspLength > displayLength ? dspLength : displayLength);
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
    const groupDelayOnsetIndex = analyses.reduce(
        (maximum, analysis) => analysis.onsetIndex > maximum ? analysis.onsetIndex : maximum,
        0
    );
    const groupDelayPostLength = analyses.reduce((maximum, analysis) => {
        const length = analysis.samples.length - analysis.onsetIndex;
        return length > maximum ? length : maximum;
    }, 1);
    const groupDelaySamples = new Float32Array(groupDelayOnsetIndex + groupDelayPostLength);
    for (let index = 0; index < groupDelaySamples.length; index += 1) {
        const relativeIndex = index - groupDelayOnsetIndex;
        let sum = 0;
        let count = 0;
        for (const analysis of analyses) {
            const sourceIndex = analysis.onsetIndex + relativeIndex;
            if (sourceIndex < 0 || sourceIndex >= analysis.samples.length) continue;
            sum += analysis.samples[sourceIndex];
            count += 1;
        }
        if (count) groupDelaySamples[index] = sum / count;
    }
    return {
        samples: samples.subarray(0, dspLength),
        previewSamples: samples.subarray(0, displayLength),
        groupDelaySamples,
        groupDelayOnsetIndex,
        onsetIndex: prerollSamples,
        fftSize: nextPowerOfTwo(dspLength),
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

function phaseCorrectionLowFrequency(config) {
    if (config.phaseLowFrequency === null) {
        return Math.max(config.lowFrequency, 3000 / config.directWindowMs);
    }
    return Math.max(1000 / config.directWindowMs, config.phaseLowFrequency);
}

// Derived config for the extended-window (reverb) phase-analysis path. The C_ext
// pipeline reuses directSpectrum/directPhaseAnalysis with this config, so the window
// length, the smoothing width and the analysis band all shift together and their
// cache keys stay distinct from the direct-window path. `reverbWindowEffectiveMs`
// must already carry the fully clamped value (config terms plus available window).
function reverbPhaseConfig(config) {
    return {
        ...config,
        directWindowMs: config.reverbWindowEffectiveMs,
        smoothing: config.reverbSmoothing,
        phaseSmoothing: config.reverbSmoothing,
        highFrequency: Math.min(config.reverbMaxFrequency, config.highFrequency),
        phaseLowFrequency: null,
        preserveAbsoluteGroupDelay: true,
        // Route the residual regridding through the cell-averaging variant (see
        // smoothReverbSynthesisValues); the direct-window path stays point-sampled.
        reverbResidualAggregation: true
    };
}

function reverbWindowTaperMs(config) {
    // One cycle at the lowest analyzed frequency is enough to close the selected
    // interval smoothly while retaining the rest of Reverb Window at full weight.
    const lowestAnalyzedFrequency = Math.max(
        config.lowFrequency,
        3000 / config.reverbWindowEffectiveMs
    );
    return Math.min(
        config.reverbWindowEffectiveMs,
        1000 / lowestAnalyzedFrequency
    );
}

function directWindowTaperMs(config) {
    // Apply the same flat-top interpretation to Direct Window. Phase Low defines
    // the longest cycle that this fixed window is expected to resolve.
    return Math.min(
        config.directWindowMs,
        1000 / phaseCorrectionLowFrequency(config)
    );
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

function smoothSynthesisGroupDelayRuns(values, valid, frequencies, config) {
    const output = new Float64Array(values.length);
    output.fill(Number.NaN);
    let first = 0;
    while (first < values.length) {
        while (first < values.length && !(valid[first] && Number.isFinite(values[first]))) {
            first += 1;
        }
        let last = first;
        while (last < values.length && valid[last] && Number.isFinite(values[last])) last += 1;
        if (last > first) {
            const runFrequencies = frequencies.subarray(first, last);
            const runValues = values.subarray(first, last);
            const low = Math.max(20, runFrequencies[0]);
            const high = runFrequencies[runFrequencies.length - 1];
            if (high > low && runFrequencies.length > 1) {
                const smoothingFrequencies = createLogFrequencyGrid(low, high, 0.01);
                const smoothingValues = interpolateValues(
                    runFrequencies,
                    runValues,
                    smoothingFrequencies
                );
                const smoothed = smoothFrequencyResponse(
                    Array.from(smoothingFrequencies, (frequency, index) => [
                        frequency,
                        smoothingValues[index]
                    ]),
                    config.phaseSmoothing
                );
                output.set(interpolateValues(
                    smoothingFrequencies,
                    smoothed.map(point => point[1]),
                    runFrequencies
                ), first);
            } else {
                output.set(runValues, first);
            }
        }
        first = last + 1;
    }
    return output;
}

// Reverb-path variant of smoothSynthesisValues: the transfer onto the fixed
// 0.01-octave smoothing grid aggregates each grid cell by the mean of the linear-grid
// values that fall inside it instead of point-sampling a single value. Above the log
// grid's resolution limit the comb-structured reverb residual would otherwise alias
// into pseudo-ripple; averaging inside the cell is equivalent to a strong smoothing
// and therefore harmless. Cells narrower than the linear grid spacing keep the same
// point interpolation the direct-window path uses.
function smoothReverbSynthesisValues(values, frequencies, config) {
    const smoothingFrequencies = createLogFrequencyGrid(
        Math.max(20, frequencies[1] || 20),
        Math.min(config.sampleRate * 0.48, frequencies[frequencies.length - 1]),
        0.01
    );
    const sourceFrequencies = frequencies.subarray(1);
    const sourceValues = values.subarray(1);
    const smoothingValues = interpolateValues(
        sourceFrequencies,
        sourceValues,
        smoothingFrequencies
    );
    let cursor = 0;
    for (let index = 0; index < smoothingFrequencies.length; index += 1) {
        const lower = index === 0
            ? smoothingFrequencies[index]
            : Math.sqrt(smoothingFrequencies[index - 1] * smoothingFrequencies[index]);
        const upper = index === smoothingFrequencies.length - 1
            ? smoothingFrequencies[index]
            : Math.sqrt(smoothingFrequencies[index] * smoothingFrequencies[index + 1]);
        while (cursor < sourceFrequencies.length && sourceFrequencies[cursor] < lower) {
            cursor += 1;
        }
        let sum = 0;
        let count = 0;
        for (let source = cursor; source < sourceFrequencies.length &&
            sourceFrequencies[source] <= upper; source += 1) {
            sum += sourceValues[source];
            count += 1;
        }
        if (count > 0) smoothingValues[index] = sum / count;
    }
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

function lowPhaseClosureWeight(frequency, low) {
    if (frequency <= 0) return 0;
    if (frequency >= low) return 1;
    const position = frequency / low;
    return 0.5 - 0.5 * Math.cos(Math.PI * position);
}

function lowPhaseWindowAnalysis(direct, frequencies, requestedWindow, requestedTaper) {
    const onset = direct.onsetIndex;
    const sampleRate = direct.sampleRate;
    const preroll = Math.round(sampleRate * 0.001);
    const start = onset > preroll ? onset - preroll : 0;
    const requestedSamples = Math.max(1, Math.floor(requestedWindow * sampleRate));
    const end = Math.min(direct.samples.length, onset + requestedSamples);
    if (end <= start) return null;
    const fadeSamples = Math.max(1, Math.min(
        end - onset,
        Math.floor(requestedTaper * sampleRate)
    ));
    const fadeStart = end - fadeSamples;
    const input = new Float64Array(end - start);
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        let gain = 1;
        if (sampleIndex >= fadeStart) {
            const position = (sampleIndex - fadeStart) / fadeSamples;
            gain = 0.5 + 0.5 * Math.cos(Math.PI * position);
        }
        input[sampleIndex - start] = direct.samples[sampleIndex] * gain;
    }
    return analyzeRoomEqGroupDelay(
        input,
        onset - start,
        sampleRate,
        frequencies
    );
}

function lowPhaseWindowMagnitude(analysis, frequency, sampleRate) {
    const position = frequency * analysis.fftSize / sampleRate;
    const last = analysis.spectrum.real.length - 1;
    const lower = Math.min(last, Math.floor(position));
    const upper = lower < last ? lower + 1 : lower;
    const fraction = upper === lower ? 0 : position - lower;
    const real = analysis.spectrum.real[lower] + fraction * (
        analysis.spectrum.real[upper] - analysis.spectrum.real[lower]
    );
    const imaginary = analysis.spectrum.imag[lower] + fraction * (
        analysis.spectrum.imag[upper] - analysis.spectrum.imag[lower]
    );
    return Math.hypot(real, imaginary);
}

function frequencyDependentLowSpectrum(
    direct,
    frequencies,
    config,
    high
) {
    if (!direct.samples || !Number.isSafeInteger(direct.onsetIndex)) return null;
    const low = config.lowFrequency;
    if (low >= high) return null;
    const cacheKey = [
        'spectrum',
        low,
        high,
        config.directWindowMs,
        config.taps,
        config.sampleRate,
        frequencies.length
    ].join(':');
    const cached = direct.lowPhaseCorrectionCache?.get(cacheKey);
    if (cached) return cached;

    let first = 0;
    while (first < frequencies.length && frequencies[first] < low) first += 1;
    let anchor = first;
    while (anchor < frequencies.length && frequencies[anchor] < high) anchor += 1;
    if (anchor >= frequencies.length || anchor <= first) return null;

    const magnitude = Float64Array.from(direct.magnitude);
    const excessDelaySeconds = Float64Array.from(direct.excessGroupDelaySeconds);
    const valid = Uint8Array.from(direct.groupDelayValid);
    const coverage = new Float64Array(frequencies.length);
    const windowSeconds = new Float64Array(frequencies.length);
    const sampleRate = direct.sampleRate;
    const availableWindow = (direct.samples.length - direct.onsetIndex) / sampleRate;
    const directWindow = config.directWindowMs / 1000;
    const directTaper = directWindowTaperMs(config) / 1000;
    const octaveSpan = Math.log2(high / low);
    const analyses = [];
    for (let octave = 0; octave <= Math.ceil(octaveSpan); octave += 1) {
        analyses.push(lowPhaseWindowAnalysis(
            direct,
            frequencies,
            directWindow * 2 ** octave,
            directTaper * 2 ** octave
        ));
    }
    if (analyses.some(analysis => analysis === null)) return null;
    let coverageLimited = false;

    for (let index = first; index <= anchor; index += 1) {
        const frequency = frequencies[index];
        const requestedWindow = directWindow * high / frequency;
        windowSeconds[index] = Math.min(requestedWindow, availableWindow);
        let octavePosition = Math.log2(high / frequency);
        if (octavePosition < 0) octavePosition = 0;
        const lowerOctave = Math.min(analyses.length - 1, Math.floor(octavePosition));
        const upperOctave = Math.min(analyses.length - 1, lowerOctave + 1);
        const fraction = upperOctave === lowerOctave
            ? 0
            : octavePosition - lowerOctave;
        const lowerAnalysis = analyses[lowerOctave];
        const upperAnalysis = analyses[upperOctave];
        if (!lowerAnalysis.valid[index] || !upperAnalysis.valid[index]) {
            excessDelaySeconds[index] = Number.NaN;
            valid[index] = 0;
        } else {
            excessDelaySeconds[index] = (
                lowerAnalysis.excessMs[index] * (1 - fraction) +
                upperAnalysis.excessMs[index] * fraction
            ) / 1000;
            magnitude[index] =
                lowPhaseWindowMagnitude(lowerAnalysis, frequency, sampleRate) *
                    (1 - fraction) +
                lowPhaseWindowMagnitude(upperAnalysis, frequency, sampleRate) * fraction;
            valid[index] = 1;
        }
        coverage[index] = requestedWindow > availableWindow
            ? availableWindow / requestedWindow
            : 1;
        if (requestedWindow > availableWindow) coverageLimited = true;
    }

    const result = {
        first,
        anchor,
        magnitude,
        excessDelaySeconds,
        valid,
        coverage,
        windowSeconds,
        coverageLimited
    };
    direct.lowPhaseCorrectionCache?.set(cacheKey, result);
    if (direct.lowPhaseCorrectionCache?.size > 8) {
        direct.lowPhaseCorrectionCache.delete(
            direct.lowPhaseCorrectionCache.keys().next().value
        );
    }
    return result;
}

function frequencyDependentLowPhaseAnalysis(direct, frequencies, config, fftSize) {
    if (!config.lowFrequencyPhaseExtension) return null;
    const high = Math.min(
        phaseCorrectionLowFrequency(config),
        config.highFrequency,
        config.sampleRate * 0.45
    );
    const spectrum = frequencyDependentLowSpectrum(
        direct,
        frequencies,
        config,
        high
    );
    if (!spectrum) return null;
    const cacheKey = [
        'delay',
        config.lowFrequency,
        high,
        config.directWindowMs,
        config.phaseSmoothing,
        config.taps,
        config.sampleRate,
        config.highFrequency,
        fftSize
    ].join(':');
    const cached = direct.lowPhaseCorrectionCache?.get(cacheKey);
    if (cached) return cached;

    const fixed = directPhaseAnalysis(direct, frequencies, config, fftSize);
    const floor = fixed.floor;
    const fullDelaySamples = direct.groupDelaySamples || direct.samples;
    const fullDelayOnset = direct.groupDelayOnsetIndex ?? direct.onsetIndex;
    const smoothedExcessDelays = smoothSynthesisGroupDelayRuns(
        spectrum.excessDelaySeconds,
        spectrum.valid,
        frequencies,
        config
    );

    const intervalDelays = new Float64Array(spectrum.anchor + 1);
    const hybridIntervalDelays = new Float64Array(spectrum.anchor + 1);
    const fixedBlend = new Float64Array(spectrum.anchor + 1);
    const reliability = new Float64Array(spectrum.anchor + 1);
    const blendStart = high / 2 ** (1 / 3);
    for (let index = spectrum.first + 1; index <= spectrum.anchor; index += 1) {
        const validDelay = spectrum.valid[index] &&
            Number.isFinite(smoothedExcessDelays[index]);
        let hybridDelay = validDelay
            ? smoothedExcessDelays[index]
            : 0;
        if (hybridDelay < 0) hybridDelay = 0;
        const midpoint = Math.sqrt(frequencies[index - 1] * frequencies[index]);
        let blend = 0;
        if (midpoint > blendStart) {
            let position = Math.log2(midpoint / blendStart) * 3;
            if (position > 1) position = 1;
            blend = 0.5 - 0.5 * Math.cos(Math.PI * position);
        }
        hybridIntervalDelays[index] = hybridDelay;
        fixedBlend[index] = blend;
        intervalDelays[index] = hybridDelay * (1 - blend) +
            fixed.intervalDelays[index] * blend;
        const lowMagnitude = spectrum.magnitude[index - 1] < spectrum.magnitude[index]
            ? spectrum.magnitude[index - 1]
            : spectrum.magnitude[index];
        const magnitudeRatio = lowMagnitude / floor;
        const magnitudeReliability = magnitudeRatio < 1
            ? magnitudeRatio * magnitudeRatio
            : 1;
        const timeReliability = spectrum.coverage[index - 1] < spectrum.coverage[index]
            ? spectrum.coverage[index - 1]
            : spectrum.coverage[index];
        reliability[index] = validDelay
            ? magnitudeReliability * timeReliability
            : 0;
    }
    const result = {
        first: spectrum.first,
        anchor: spectrum.anchor,
        intervalDelays,
        hybridIntervalDelays,
        fullDelaySamples,
        fullDelayOnset,
        fixedBlend,
        reliability,
        windowSeconds: spectrum.windowSeconds,
        magnitude: spectrum.magnitude,
        floor,
        coverageLimited: spectrum.coverageLimited
    };
    direct.lowPhaseCorrectionCache?.set(cacheKey, result);
    if (direct.lowPhaseCorrectionCache?.size > 8) {
        direct.lowPhaseCorrectionCache.delete(
            direct.lowPhaseCorrectionCache.keys().next().value
        );
    }
    return result;
}

function directPhaseAnalysis(direct, frequencies, config, fftSize) {
    const low = phaseCorrectionLowFrequency(config);
    const high = Math.min(config.highFrequency, config.sampleRate * 0.45);
    // The reverb path reaches this cache through the same `direct` object whenever
    // its effective window equals a direct-window design's dw (analysis.directCache
    // is keyed on the window alone), and reverbPhaseConfig can make every other key
    // term collide as well. reverbResidualAggregation selects the residual regridding
    // below, so it belongs in the identity or the two paths hand each other results.
    const cacheKey = [
        'analysis',
        low,
        high,
        config.directWindowMs,
        config.phaseSmoothing,
        config.sampleRate,
        fftSize,
        config.reverbResidualAggregation ? 1 : 0,
        config.preserveAbsoluteGroupDelay ? 1 : 0
    ].join(':');
    const cached = direct.phaseCorrectionCache?.get(cacheKey);
    if (cached) return cached;
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
    const valid = new Uint8Array(frequencies.length);
    const excessDelays = new Float64Array(frequencies.length);
    excessDelays.fill(Number.NaN);
    let delaySum = 0;
    let delayWeight = 0;
    for (let index = 0; index < frequencies.length; index += 1) {
        if (!direct.groupDelayValid?.[index] || direct.magnitude[index] <= floor ||
            !Number.isFinite(direct.excessGroupDelaySeconds?.[index])) continue;
        valid[index] = 1;
        excessDelays[index] = direct.excessGroupDelaySeconds[index];
        if (frequencies[index] < low || frequencies[index] > high) continue;
        const weight = index === 0 ? 1 : frequencies[index] - frequencies[index - 1];
        delaySum += excessDelays[index] * weight;
        delayWeight += weight;
    }
    const referenceDelay = config.preserveAbsoluteGroupDelay
        ? 0
        : delayWeight > 0 ? delaySum / delayWeight : 0;
    const smoothedDelays = smoothSynthesisGroupDelayRuns(
        excessDelays,
        valid,
        frequencies,
        config
    );
    const intervalDelays = new Float64Array(frequencies.length);
    for (let index = 1; index < frequencies.length; index += 1) {
        if (valid[index] && Number.isFinite(smoothedDelays[index])) {
            intervalDelays[index] = smoothedDelays[index] - referenceDelay;
        }
    }
    const result = {
        first,
        low,
        high,
        floor,
        referenceDelay,
        valid,
        intervalDelays
    };
    direct.phaseCorrectionCache?.set(cacheKey, result);
    if (direct.phaseCorrectionCache?.size > 8) {
        direct.phaseCorrectionCache.delete(direct.phaseCorrectionCache.keys().next().value);
    }
    return result;
}

function directPhaseCorrection(direct, frequencies, config, fftSize) {
    const analysis = directPhaseAnalysis(direct, frequencies, config, fftSize);
    const { first, low, high } = analysis;
    // Same identity rule as the 'analysis' entry above: this value is derived from
    // the analysis result, so it inherits the aggregation flag's influence.
    const cacheKey = [
        'correction',
        low,
        high,
        config.directWindowMs,
        config.phaseSmoothing,
        config.sampleRate,
        fftSize,
        config.reverbResidualAggregation ? 1 : 0,
        config.preserveAbsoluteGroupDelay ? 1 : 0
    ].join(':');
    const cached = direct.phaseCorrectionCache?.get(cacheKey);
    if (cached) return cached;
    const phase = new Float64Array(frequencies.length);
    for (let index = first + 1; index < frequencies.length; index += 1) {
        if (frequencies[index] > high) {
            phase[index] = phase[index - 1];
            continue;
        }
        const deltaOmega = 2 * Math.PI * (frequencies[index] - frequencies[index - 1]);
        phase[index] = phase[index - 1] - analysis.intervalDelays[index] * deltaOmega;
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

function consensusLowPhaseCorrection(
    target,
    directs,
    upperCorrection,
    alignmentGroupDelayPerAmount,
    frequencies,
    config,
    fftSize,
    reverbTarget = null
) {
    if (!config.lowFrequencyPhaseExtension) {
        return { phase: null, reason: 'notRequested' };
    }
    const high = Math.min(
        phaseCorrectionLowFrequency(config),
        config.highFrequency,
        config.sampleRate * 0.45
    );
    const targetAnalysis = frequencyDependentLowPhaseAnalysis(
        target,
        frequencies,
        config,
        fftSize
    );
    if (!targetAnalysis) return { phase: null, reason: 'insufficientData' };
    const pointAnalyses = directs.map(direct =>
        direct === target
            ? targetAnalysis
            : frequencyDependentLowPhaseAnalysis(direct, frequencies, config, fftSize));
    const upperIndex = targetAnalysis.anchor + 1;
    let upperBoundaryDelay = targetAnalysis.intervalDelays[targetAnalysis.anchor];
    if (upperCorrection && upperIndex < frequencies.length) {
        const deltaOmega = 2 * Math.PI * (
            frequencies[upperIndex] - frequencies[targetAnalysis.anchor]
        );
        if (deltaOmega > 0) {
            upperBoundaryDelay = -(
                upperCorrection[upperIndex] - upperCorrection[targetAnalysis.anchor]
            ) / deltaOmega;
        }
    }
    const commonDelays = new Float64Array(frequencies.length);
    for (let index = targetAnalysis.first + 1;
        index <= targetAnalysis.anchor;
        index += 1) {
        let commonDelay = targetAnalysis.hybridIntervalDelays[index];
        if (pointAnalyses.length > 1) {
            let weightedDelay = 0;
            let weightSum = 0;
            for (const analysis of pointAnalyses) {
                if (!analysis) continue;
                const weight = analysis.reliability[index];
                const delay = analysis.hybridIntervalDelays[index];
                if (weight <= 0) continue;
                weightedDelay += delay * weight;
                weightSum += weight;
            }
            if (weightSum > 0) commonDelay = weightedDelay / weightSum;
        }
        commonDelays[index] = commonDelay;
    }
    const phase = new Float64Array(frequencies.length);
    for (let index = targetAnalysis.anchor;
        index > targetAnalysis.first;
        index -= 1) {
        const blend = targetAnalysis.fixedBlend[index];
        const deltaOmega = 2 * Math.PI * (frequencies[index] - frequencies[index - 1]);
        const lowTargetDelay = (
            commonDelays[index] - alignmentGroupDelayPerAmount
        ) * (1 - blend) + upperBoundaryDelay * blend;
        let targetDelay = lowTargetDelay;
        if (reverbTarget) {
            const lowWindowSeconds = targetAnalysis.windowSeconds[index];
            // The longer analysis window owns the target at this frequency. When
            // Reverb Window is longer, blend LFE toward that target instead of
            // cancelling the reverb term back to the shorter octave window.
            if (reverbTarget.windowSeconds >= lowWindowSeconds) {
                targetDelay *= 1 - reverbTarget.amountPerPhaseAmount;
            } else {
                targetDelay -= reverbTarget.delays[index];
            }
        }
        phase[index - 1] = phase[index] + targetDelay * deltaOmega;
    }
    let activeLast = targetAnalysis.first;
    for (let index = targetAnalysis.first + 1;
        index <= targetAnalysis.anchor && targetAnalysis.fixedBlend[index] === 0;
        index += 1) {
        activeLast = index;
    }
    let activeFirst = targetAnalysis.first + 1;
    return {
        phase,
        reason: null,
        guard: {
            first: targetAnalysis.first,
            activeLow: frequencies[activeFirst - 1],
            activeHigh: frequencies[activeLast],
            referenceFullSamples: targetAnalysis.fullDelaySamples,
            referenceFullOnset: targetAnalysis.fullDelayOnset
        },
        coverageLimited: targetAnalysis.coverageLimited ||
            pointAnalyses.some(analysis => analysis?.coverageLimited === true)
    };
}

function consensusDirectPhaseCorrection(directs, frequencies, config, fftSize) {
    if (directs.length === 1) {
        return directPhaseCorrection(directs[0], frequencies, config, fftSize);
    }
    const analyses = directs.map(direct =>
        directPhaseAnalysis(direct, frequencies, config, fftSize));
    const low = phaseCorrectionLowFrequency(config);
    const high = Math.min(config.highFrequency, config.sampleRate * 0.45);
    let first = 0;
    while (first < frequencies.length && frequencies[first] < low) first += 1;

    // Average the smoothed interval delays, then integrate once. Circularly
    // averaging already integrated phase and multiplying that phase by agreement
    // creates branch-sensitive single-bin jumps when points disagree.
    const phase = new Float64Array(frequencies.length);
    for (let index = first + 1; index < frequencies.length; index += 1) {
        if (frequencies[index] > high) {
            phase[index] = phase[index - 1];
            continue;
        }
        let weightedDelay = 0;
        let weightSum = 0;
        for (let point = 0; point < directs.length; point += 1) {
            const delay = analyses[point].intervalDelays[index];
            if (!analyses[point].valid[index] || !Number.isFinite(delay)) continue;
            const reliability = directs[point].magnitude[index] / analyses[point].floor;
            const weight = reliability < 1 ? reliability * reliability : 1;
            weightedDelay += delay * weight;
            weightSum += weight;
        }
        const intervalDelay = weightSum > 0 ? weightedDelay / weightSum : 0;
        const deltaOmega = 2 * Math.PI * (frequencies[index] - frequencies[index - 1]);
        phase[index] = phase[index - 1] - intervalDelay * deltaOmega;
    }
    for (let index = 0; index < phase.length; index += 1) {
        phase[index] *= correctionWeight(
            frequencies[index],
            low,
            high,
            config.sampleRate * 0.48
        );
    }
    return phase;
}

// Extended-window (reverb) inter-point synthesis averages the per-point smoothed
// interval delays directly. This is the least-squares common correction and, when
// all points have delay in the same direction, cannot become more conservative
// than every point. Agreement remains available as a diagnostic, but must not
// attenuate the common phase target toward zero.
function reverbExtendedConsensus(directs, frequencies, config, fftSize) {
    const analyses = directs.map(direct =>
        directPhaseAnalysis(direct, frequencies, config, fftSize));
    const { first, low, high } = analyses[0];
    const intervalDelays = new Float64Array(frequencies.length);
    const agreement = new Float64Array(frequencies.length);
    let agreementMinimum = 1;
    if (analyses.length === 1) {
        intervalDelays.set(analyses[0].intervalDelays);
        agreement.fill(1);
        return { intervalDelays, agreement, agreementMinimum, first, low, high };
    }
    const upper = Math.min(high * 2 ** (1 / 3), config.sampleRate * 0.48);
    const smoothingScale = 2 * Math.PI * (2 ** config.reverbSmoothing - 1);
    for (let index = Math.max(1, first); index < frequencies.length &&
        frequencies[index] <= upper; index += 1) {
        let weightedDelay = 0;
        let agreementReal = 0;
        let agreementImaginary = 0;
        let weightSum = 0;
        for (let point = 0; point < directs.length; point += 1) {
            const delay = analyses[point].intervalDelays[index];
            if (!analyses[point].valid[index] || !Number.isFinite(delay)) continue;
            const reliability = directs[point].magnitude[index] / analyses[point].floor;
            const weight = reliability < 1 ? reliability * reliability : 1;
            if (weight <= 0) continue;
            weightedDelay += delay * weight;
            const agreementTheta = delay * smoothingScale * frequencies[index];
            agreementReal += Math.cos(agreementTheta) * weight;
            agreementImaginary += Math.sin(agreementTheta) * weight;
            weightSum += weight;
        }
        if (weightSum > 0) {
            intervalDelays[index] = weightedDelay / weightSum;
            agreement[index] = Math.hypot(agreementReal, agreementImaginary) / weightSum;
            if (index > first && frequencies[index] <= high &&
                agreement[index] < agreementMinimum) {
                agreementMinimum = agreement[index];
            }
        }
    }
    return { intervalDelays, agreement, agreementMinimum, first, low, high };
}

function predictedDirectResponse(direct, correctionMagnitudes, correctionPhase, fftSize) {
    return inverseRealTransformPolarProduct(
        direct.magnitude,
        direct.phase,
        correctionMagnitudes,
        correctionPhase,
        fftSize
    );
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
    // The alignment window is Hann: 0.5 plus one cosine term. Advance those
    // two sums recursively so the peak scan is O(samples), then recompute the
    // winning neighborhood with the original sum for stable interpolation.
    const weightRadius = (weights.length - 1) / 2;
    const angle = Math.PI / (weightRadius + 1);
    const angleCosine = Math.cos(angle);
    const angleSine = Math.sin(angle);
    const edgeCosine = Math.cos(angle * weightRadius);
    const edgeSine = Math.sin(angle * weightRadius);
    let index = centerIndex - (searchCenter === null ? 0 : searchRadius);
    while (index < 0) index += samples.length;
    while (index >= samples.length) index -= samples.length;
    let rectangularEnergy = 0;
    let cosineEnergy = 0;
    let sineEnergy = 0;
    for (let offset = -weightRadius; offset <= weightRadius; offset += 1) {
        let sampleIndex = index + offset;
        if (sampleIndex < 0) sampleIndex += samples.length;
        else if (sampleIndex >= samples.length) sampleIndex -= samples.length;
        const sample = samples[sampleIndex];
        const energy = sample * sample;
        const phase = angle * offset;
        rectangularEnergy += energy;
        cosineEnergy += energy * Math.cos(phase);
        sineEnergy += energy * Math.sin(phase);
    }
    let bestIndex = index;
    let bestEnergy = -1;
    let bestDistance = Infinity;
    for (let step = 0; step < count; step += 1) {
        const offset = searchCenter === null ? step : step - searchRadius;
        const energy = 0.5 * (rectangularEnergy + cosineEnergy);
        const distance = Math.abs(offset);
        if (energy > bestEnergy || (energy === bestEnergy && distance < bestDistance)) {
            bestIndex = index;
            bestEnergy = energy;
            bestDistance = distance;
        }
        if (step + 1 === count) break;
        let leftIndex = index - weightRadius;
        if (leftIndex < 0) leftIndex += samples.length;
        let rightIndex = index + weightRadius + 1;
        if (rightIndex >= samples.length) rightIndex -= samples.length;
        const leftSample = samples[leftIndex];
        const rightSample = samples[rightIndex];
        const leftEnergy = leftSample * leftSample;
        const rightEnergy = rightSample * rightSample;
        rectangularEnergy += rightEnergy - leftEnergy;
        const sharedCosine = cosineEnergy - leftEnergy * edgeCosine;
        const sharedSine = sineEnergy + leftEnergy * edgeSine;
        cosineEnergy = angleCosine * sharedCosine + angleSine * sharedSine +
            rightEnergy * edgeCosine;
        sineEnergy = angleCosine * sharedSine - angleSine * sharedCosine +
            rightEnergy * edgeSine;
        index += 1;
        if (index === samples.length) index = 0;
    }
    bestEnergy = localPeakEnergy(samples, bestIndex, weights);
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
    fftSize,
    searchWindowMs = null
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
    // The reverb-correction path widens the dominant-peak search to its effective
    // window; the default (null) keeps the direct-window limit bit-identical.
    const windowLimit = Math.round(
        config.sampleRate * (searchWindowMs ?? config.directWindowMs) / 1000
    );
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
    return {
        verification: { maximumMagnitudeErrorDb, maximumPhaseErrorRadians },
        actualSpectrum: spectrum
    };
}

function renderSynthesis(magnitudes, phase, config, plan) {
    const { fftSize } = plan;
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
    const verified = verifySynthesis(taps, magnitudes, real, imag, config);
    return {
        taps,
        magnitudes,
        verification: verified.verification,
        actualSpectrum: verified.actualSpectrum
    };
}

function lowPhaseEdgeEnergyRatio(taps) {
    const edgeLength = Math.max(1, Math.ceil(taps.length * 0.05));
    let totalEnergy = 0;
    let edgeEnergy = 0;
    for (let index = 0; index < taps.length; index += 1) {
        const energy = taps[index] * taps[index];
        totalEnergy += energy;
        if (index < edgeLength || index >= taps.length - edgeLength) edgeEnergy += energy;
    }
    const denominator = totalEnergy > 0 ? totalEnergy : 1;
    return edgeEnergy / denominator;
}

function lowPhaseSynthesisIsSafe(candidate, baseline) {
    const candidateEdge = lowPhaseEdgeEnergyRatio(candidate.taps);
    const baselineEdge = lowPhaseEdgeEnergyRatio(baseline.taps);
    const edgeLimit = Math.max(
        MAX_LOW_PHASE_EDGE_ENERGY_RATIO,
        baselineEdge * 1.05 + 1e-8
    );
    return candidateEdge <= edgeLimit;
}

function lowPhaseCandidateSpectrum(
    magnitudes,
    basePhase,
    correction,
    amount,
    frequencies,
    first
) {
    const candidateMagnitudes = Float64Array.from(magnitudes);
    const candidatePhase = Float64Array.from(basePhase);
    const endpointPhase = correction[first] * amount;
    const endpointReal = Math.cos(endpointPhase);
    const endpointImaginary = -Math.sin(endpointPhase);
    for (let bin = 1; bin < candidatePhase.length; bin += 1) {
        if (bin >= first) {
            candidatePhase[bin] -= correction[bin] * amount;
            continue;
        }
        const frequency = frequencies[bin];
        if (frequency >= LOW_PHASE_SUBSONIC_CLOSURE_HZ) {
            candidatePhase[bin] -= endpointPhase;
            continue;
        }
        const weight = lowPhaseClosureWeight(
            frequency,
            LOW_PHASE_SUBSONIC_CLOSURE_HZ
        );
        const real = 1 - weight + weight * endpointReal;
        const imaginary = weight * endpointImaginary;
        candidateMagnitudes[bin] *= Math.hypot(real, imaginary);
        candidatePhase[bin] += Math.atan2(imaginary, real);
    }
    return { magnitudes: candidateMagnitudes, phase: candidatePhase };
}

function createLowPhaseRmsReference(guard, frequencies, config) {
    if (!guard.referenceFullSamples || !Number.isSafeInteger(guard.referenceFullOnset)) {
        return null;
    }
    return analyzeRoomEqGroupDelay(
        guard.referenceFullSamples,
        guard.referenceFullOnset,
        config.sampleRate,
        frequencies
    );
}

function lowPhaseResidualRms(rendered, reference, guard, frequencies, config) {
    if (!reference) return 0;
    const filter = analyzeRoomEqGroupDelay(
        rendered.taps,
        config.taps / 2,
        config.sampleRate,
        frequencies,
        {
            minimumFftSize: rendered.taps.length * 2,
            spectrum: rendered.actualSpectrum
        }
    );
    const display = smoothRoomEqGroupDelay(
        combineRoomEqGroupDelay(reference, filter),
        frequencies,
        config.smoothing
    );
    let squared = 0;
    let weightSum = 0;
    for (let index = 1; index < frequencies.length; index += 1) {
        if (frequencies[index] < guard.activeLow ||
            frequencies[index] > guard.activeHigh ||
            !display.valid[index] || !Number.isFinite(display.excess[index])) continue;
        const low = frequencies[index - 1];
        const high = frequencies[index];
        if (!(low > 0) || !(high > low)) continue;
        const weight = Math.log(high / low);
        const magnitude = Math.abs(display.excess[index]) / 1000;
        squared += magnitude * magnitude * weight;
        weightSum += weight;
    }
    return weightSum === 0 ? 0 : Math.sqrt(squared / weightSum);
}

function lowPhaseDoesNotWorsen(
    candidate,
    baselineScore,
    reference,
    guard,
    frequencies,
    config
) {
    const candidateScore = lowPhaseResidualRms(
        candidate,
        reference,
        guard,
        frequencies,
        config
    );
    const rmsTolerance = Math.max(
        LOW_PHASE_ACTIVE_ABSOLUTE_TOLERANCE,
        baselineScore * LOW_PHASE_ACTIVE_RELATIVE_TOLERANCE
    );
    return candidateScore <= baselineScore + rmsTolerance;
}

function synthesizeFilter(
    correctionDb,
    gridFrequencies,
    config,
    phaseSource
) {
    const plan = getSynthesisPlan(gridFrequencies, config);
    const { fftSize, binFrequencies } = plan;
    let magnitudes = interpolateGainsWithPlan(correctionDb, plan);
    let phase = new Float64Array(magnitudes.length);
    let fullReferencePhase = null;
    let unalignedFullPhase = null;
    let fullTimingAlignment = 0;
    let lowCorrection = null;
    let lowGuard = null;
    let lowCoverageLimited = false;
    let reverbGuardDiagnostic = null;
    let reverbBaselineRender = null;
    let lowPhaseDiagnostic = {
        state: 'disabled',
        scale: 0,
        reason: !config.lowFrequencyPhaseExtension
            ? 'notRequested'
            : config.phase !== 'full'
                ? 'fullPhaseRequired'
                : config.phaseCorrectionAmount === 0
                    ? 'phaseCorrectionDisabled'
                    : 'insufficientData'
    };
    if (config.phase === 'min') {
        phase = minimumPhaseForMagnitude(magnitudes, fftSize);
    } else if (config.phase === 'full') {
        fullReferencePhase = minimumPhaseForMagnitude(magnitudes, fftSize);
        phase = Float64Array.from(fullReferencePhase);
        const correction = phaseSource?.candidates?.length
            ? consensusDirectPhaseCorrection(
                phaseSource.candidates,
                binFrequencies,
                config,
                fftSize
            )
            : null;
        const reverb = phaseSource?.reverb || null;
        let reverbPhase = null;
        if (reverb) {
            // Interval-delay-domain difference between the extended-window consensus
            // and the direct-window correction: tau_delta = W * (tau_ext - tau_dir),
            // re-integrated as delta[i] = delta[i-1] - tau_delta * dOmega.
            // W comes from the same effective band arguments as the C_ext analysis
            // (its low/high), so out-of-band tau_ext values never leak in. Bins at or
            // below `first` stay zero and accumulation starts at first + 1, matching
            // directPhaseCorrection; above the upper flank W = 0 leaves a constant
            // plateau (a uniform rotation). Agreement is diagnostic only; reducing
            // the arithmetic-mean target by agreement would under-correct every point.
            const deltaOmega = 2 * Math.PI * (binFrequencies[1] - binFrequencies[0]);
            reverbPhase = new Float64Array(phase.length);
            for (let bin = reverb.first + 1; bin < reverbPhase.length; bin += 1) {
                const weight = correctionWeight(
                    binFrequencies[bin],
                    reverb.low,
                    reverb.high,
                    config.sampleRate * 0.48
                );
                let intervalDelay = 0;
                if (weight > 0) {
                    const directDelay = correction
                        ? -(correction[bin] - correction[bin - 1]) / deltaOmega
                        : 0;
                    intervalDelay = weight * (reverb.intervalDelays[bin] - directDelay);
                }
                reverbPhase[bin] = reverbPhase[bin - 1] - intervalDelay * deltaOmega;
            }
        }
        let reverbTarget = null;
        if (reverbPhase) {
            // Staged degradation guard (plan section 3.6, fixed order).
            // Step 1: the rv=0 guard baseline keeps the same magnitude target and
            // recomputes correctionTimingAlignment from the rv=0 phase. Sharing the
            // candidate-side alignment instead would push the baseline's compact
            // impulse into the 5% edge window and inflate baselineEdge,
            // loosening the relative edgeLimit exactly when the guard must fire.
            const baseMagnitudes = magnitudes;
            const baseReferencePhase = fullReferencePhase;
            const basePhase = Float64Array.from(baseReferencePhase);
            for (let bin = 0; bin < basePhase.length; bin += 1) {
                basePhase[bin] -= (correction?.[bin] || 0) * config.phaseCorrectionAmount;
            }
            const baseUnalignedPhase = Float64Array.from(basePhase);
            const baseAlignment = phaseSource?.timing && config.phaseCorrectionAmount > 0
                ? correctionTimingAlignment(
                    phaseSource.timing,
                    baseMagnitudes,
                    baseReferencePhase,
                    basePhase,
                    config,
                    fftSize,
                    null
                )
                : 0;
            for (let bin = 0; bin < basePhase.length; bin += 1) {
                basePhase[bin] += 2 * Math.PI * binFrequencies[bin] * baseAlignment -
                    2 * Math.PI * bin / fftSize * (config.taps / 2);
            }
            const reverbBaseline = renderSynthesis(baseMagnitudes, basePhase, config, plan);
            // Step 2: rv scale ladder [1, 0.5, 0.25], LFE-free and phase-only.
            // The timing alignment is computed once at s=1 and reused for every
            // ladder candidate, matching the LFE loop.
            const buildCandidatePhase = scale => {
                const candidate = new Float64Array(phase.length);
                for (let bin = 0; bin < candidate.length; bin += 1) {
                    candidate[bin] = fullReferencePhase[bin] -
                        ((correction?.[bin] || 0) * config.phaseCorrectionAmount +
                            reverbPhase[bin] * config.reverbAmount * scale);
                }
                return candidate;
            };
            const fullScalePhase = buildCandidatePhase(1);
            fullTimingAlignment = phaseSource?.timing
                ? correctionTimingAlignment(
                    phaseSource.timing,
                    magnitudes,
                    fullReferencePhase,
                    fullScalePhase,
                    config,
                    fftSize,
                    Math.max(config.directWindowMs, reverb.effectiveWindowMs)
                )
                : 0;
            let adoptedScale = 0;
            for (const scale of LOW_PHASE_SCALE_STEPS) {
                const candidatePhase = scale === 1
                    ? fullScalePhase
                    : buildCandidatePhase(scale);
                const alignedPhase = Float64Array.from(candidatePhase);
                for (let bin = 0; bin < alignedPhase.length; bin += 1) {
                    alignedPhase[bin] +=
                        2 * Math.PI * binFrequencies[bin] * fullTimingAlignment -
                        2 * Math.PI * bin / fftSize * (config.taps / 2);
                }
                const candidate = renderSynthesis(magnitudes, alignedPhase, config, plan);
                if (lowPhaseSynthesisIsSafe(candidate, reverbBaseline)) {
                    adoptedScale = scale;
                    reverbBaselineRender = candidate;
                    unalignedFullPhase = candidatePhase;
                    break;
                }
            }
            if (reverbBaselineRender) {
                reverbGuardDiagnostic = {
                    state: adoptedScale === 1 ? 'applied' : 'reduced',
                    scale: adoptedScale,
                    reason: adoptedScale === 1 ? null : 'firEnergy'
                };
                if (config.phaseCorrectionAmount > 0) {
                    // LFE incrementalization input (plan section 3.4): the
                    // interval delay implied by the adopted rv*s*delta, per unit
                    // phaseCorrectionAmount (the same "/pr then *pr" cancel
                    // structure as alignmentGroupDelayPerAmount).
                    const deltaOmega = 2 * Math.PI *
                        (binFrequencies[1] - binFrequencies[0]);
                    const delayFactor = config.reverbAmount * adoptedScale /
                        config.phaseCorrectionAmount;
                    const delays = new Float64Array(phase.length);
                    for (let bin = 1; bin < delays.length; bin += 1) {
                        delays[bin] = -(
                            reverbPhase[bin] - reverbPhase[bin - 1]
                        ) / deltaOmega * delayFactor;
                    }
                    reverbTarget = {
                        delays,
                        amountPerPhaseAmount: delayFactor,
                        windowSeconds: reverb.effectiveWindowMs / 1000
                    };
                }
            } else {
                // All scales failed: ship the guard baseline itself with no
                // re-render. The LFE loop below then runs on this natively aligned
                // phase-only rv=0 baseline.
                reverbGuardDiagnostic = { state: 'disabled', scale: 0, reason: 'firEnergy' };
                reverbBaselineRender = reverbBaseline;
                magnitudes = baseMagnitudes;
                fullReferencePhase = baseReferencePhase;
                unalignedFullPhase = baseUnalignedPhase;
                fullTimingAlignment = baseAlignment;
            }
        } else {
            for (let bin = 0; bin < phase.length; bin += 1) {
                phase[bin] -= (correction?.[bin] || 0) * config.phaseCorrectionAmount;
            }
            unalignedFullPhase = Float64Array.from(phase);
            fullTimingAlignment = phaseSource?.timing && config.phaseCorrectionAmount > 0
                ? correctionTimingAlignment(
                    phaseSource.timing,
                    magnitudes,
                    fullReferencePhase,
                    phase,
                    config,
                    fftSize,
                    null
                )
                : 0;
        }
        const lowResult = config.phaseCorrectionAmount > 0 && phaseSource?.candidates?.length
            ? consensusLowPhaseCorrection(
                phaseSource.timing,
                phaseSource.candidates,
                correction,
                fullTimingAlignment / config.phaseCorrectionAmount,
                binFrequencies,
                config,
                fftSize,
                reverbTarget
            )
            : null;
        lowCorrection = lowResult?.phase || null;
        lowGuard = lowResult?.guard || null;
        lowCoverageLimited = lowResult?.coverageLimited === true;
        if (lowResult?.reason) lowPhaseDiagnostic.reason = lowResult.reason;
        if (!reverbBaselineRender) {
            for (let bin = 0; bin < phase.length; bin += 1) {
                phase[bin] += 2 * Math.PI * binFrequencies[bin] * fullTimingAlignment -
                    2 * Math.PI * bin / fftSize * (config.taps / 2);
            }
        }
    }
    const baseline = reverbBaselineRender ||
        renderSynthesis(magnitudes, phase, config, plan);
    baseline.reverbGuard = reverbGuardDiagnostic;
    if (!lowCorrection || config.phaseCorrectionAmount === 0) {
        baseline.lowPhaseDiagnostic = lowPhaseDiagnostic;
        return baseline;
    }
    const lowRmsReference = createLowPhaseRmsReference(
        lowGuard,
        gridFrequencies,
        config
    );
    const baselineRms = lowPhaseResidualRms(
        baseline,
        lowRmsReference,
        lowGuard,
        gridFrequencies,
        config
    );
    let reductionReason = null;
    const evaluateScale = scale => {
        const candidateSpectrum = lowPhaseCandidateSpectrum(
            magnitudes,
            unalignedFullPhase,
            lowCorrection,
            config.phaseCorrectionAmount * scale,
            binFrequencies,
            lowGuard.first
        );
        for (let bin = 0; bin < candidateSpectrum.phase.length; bin += 1) {
            candidateSpectrum.phase[bin] +=
                2 * Math.PI * binFrequencies[bin] * fullTimingAlignment -
                2 * Math.PI * bin / fftSize * (config.taps / 2);
        }
        const candidate = renderSynthesis(
            candidateSpectrum.magnitudes,
            candidateSpectrum.phase,
            config,
            plan
        );
        const energySafe = lowPhaseSynthesisIsSafe(candidate, baseline);
        const groupDelaySafe = lowPhaseDoesNotWorsen(
            candidate,
            baselineRms,
            lowRmsReference,
            lowGuard,
            gridFrequencies,
            config
        );
        return {
            scale,
            candidate,
            energySafe,
            groupDelaySafe,
            safe: energySafe && groupDelaySafe
        };
    };
    const recordReductionReason = evaluation => {
        if (!evaluation.groupDelaySafe && reductionReason === null) {
            reductionReason = 'groupDelay';
        } else if (!evaluation.energySafe && reductionReason === null) {
            reductionReason = 'firEnergy';
        }
    };
    let safeEvaluation = null;
    let unsafeUpperScale = 1;
    for (let step = 0; step < LOW_PHASE_SCALE_SEARCH_STEPS; step += 1) {
        const scale = 1 - step / LOW_PHASE_SCALE_SEARCH_STEPS;
        const evaluation = evaluateScale(scale);
        if (evaluation.safe) {
            safeEvaluation = evaluation;
            break;
        }
        unsafeUpperScale = scale;
        recordReductionReason(evaluation);
    }
    if (!safeEvaluation) {
        safeEvaluation = {
            scale: 0,
            candidate: baseline,
            energySafe: true,
            groupDelaySafe: true,
            safe: true
        };
    }
    if (safeEvaluation?.scale === 1) {
        safeEvaluation.candidate.lowPhaseDiagnostic = {
            state: lowCoverageLimited ? 'reduced' : 'applied',
            scale: 1,
            reason: lowCoverageLimited ? 'insufficientData' : null
        };
        safeEvaluation.candidate.reverbGuard = reverbGuardDiagnostic;
        return safeEvaluation.candidate;
    }
    if (safeEvaluation) {
        // Keep the largest realizable LFE correction that improves the active-band
        // RMS without concentrating unsafe energy at the FIR boundaries.
        let lower = safeEvaluation.scale;
        let upper = unsafeUpperScale;
        for (let step = 0; step < LOW_PHASE_SCALE_REFINEMENT_STEPS; step += 1) {
            const evaluation = evaluateScale((lower + upper) / 2);
            if (evaluation.safe) {
                lower = evaluation.scale;
                safeEvaluation = evaluation;
            } else {
                upper = evaluation.scale;
                recordReductionReason(evaluation);
            }
        }
        if (safeEvaluation.scale > 0) {
            safeEvaluation.candidate.lowPhaseDiagnostic = {
                state: 'reduced',
                scale: safeEvaluation.scale,
                reason: reductionReason || 'groupDelay'
            };
            safeEvaluation.candidate.reverbGuard = reverbGuardDiagnostic;
            return safeEvaluation.candidate;
        }
    }
    baseline.lowPhaseDiagnostic = {
        state: 'disabled',
        scale: 0,
        reason: reductionReason || 'groupDelay'
    };
    return baseline;
}

function interpolatePhaseOnGrid(phases, sampleRate, fftSize, frequencies) {
    const sourceFrequencies = new Float64Array(phases.length - 1);
    for (let bin = 1; bin < phases.length; bin += 1) {
        sourceFrequencies[bin - 1] = bin * sampleRate / fftSize;
    }
    const unwrapped = unwrapPhase(phases.subarray(1));
    const result = new Float64Array(frequencies.length);
    let upper = 1;
    for (let index = 0; index < frequencies.length; index += 1) {
        const frequency = frequencies[index];
        while (upper < sourceFrequencies.length && sourceFrequencies[upper] < frequency) {
            upper += 1;
        }
        if (frequency <= sourceFrequencies[0]) result[index] = unwrapped[0];
        else if (upper >= sourceFrequencies.length) {
            result[index] = unwrapped[unwrapped.length - 1];
        } else {
            const lowFrequency = sourceFrequencies[upper - 1];
            const highFrequency = sourceFrequencies[upper];
            const fraction = (frequency - lowFrequency) / (highFrequency - lowFrequency);
            result[index] = unwrapped[upper - 1] +
                fraction * (unwrapped[upper] - unwrapped[upper - 1]);
        }
    }
    return result;
}

function phaseComponentsOnGrid(
    samples,
    alignmentSamples,
    sampleRate,
    frequencies,
    minimumFftSize = 0,
    unalignedSpectrum = null
) {
    const fftSize = nextPowerOfTwo(
        samples.length > minimumFftSize ? samples.length : minimumFftSize
    );
    const reusableSpectrum = unalignedSpectrum?.real?.length === fftSize / 2 + 1 &&
        unalignedSpectrum?.imag?.length === fftSize / 2 + 1;
    let spectrum = unalignedSpectrum;
    if (!reusableSpectrum) {
        const input = new Float64Array(fftSize);
        for (let index = 0; index < samples.length; index += 1) {
            let alignedIndex = index - alignmentSamples;
            if (alignedIndex < 0) alignedIndex += fftSize;
            input[alignedIndex] = samples[index];
        }
        spectrum = realTransform(input);
    }
    const totalPhase = new Float64Array(spectrum.real.length);
    const magnitudes = new Float64Array(spectrum.real.length);
    for (let bin = 0; bin < spectrum.real.length; bin += 1) {
        const real = spectrum.real[bin];
        const imaginary = spectrum.imag[bin];
        let phase = Math.atan2(imaginary, real);
        if (reusableSpectrum) {
            phase += 2 * Math.PI * bin * alignmentSamples / fftSize;
            phase %= 2 * Math.PI;
            if (phase >= Math.PI) phase -= 2 * Math.PI;
            else if (phase < -Math.PI) phase += 2 * Math.PI;
        }
        totalPhase[bin] = phase;
        magnitudes[bin] = Math.hypot(real, imaginary);
    }
    const minimumPhase = minimumPhaseForMagnitude(magnitudes, fftSize);
    return {
        total: interpolatePhaseOnGrid(totalPhase, sampleRate, fftSize, frequencies),
        minimum: interpolatePhaseOnGrid(minimumPhase, sampleRate, fftSize, frequencies)
    };
}

function wrapPhaseDegrees(radians) {
    let wrapped = radians % (2 * Math.PI);
    if (wrapped >= Math.PI) wrapped -= 2 * Math.PI;
    else if (wrapped < -Math.PI) wrapped += 2 * Math.PI;
    return wrapped * 180 / Math.PI;
}

function createPhasePreviews(
    analysis,
    taps,
    config,
    frequencies,
    actualSpectrum = null,
    groupDelaySources = [analysis]
) {
    const beforeComponents = phaseComponentsOnGrid(
        analysis.samples,
        analysis.onsetIndex,
        config.sampleRate,
        frequencies
    );
    const filterDelay = config.phase === 'min' ? 0 : taps.length / 2;
    const filterComponents = phaseComponentsOnGrid(
        taps,
        filterDelay,
        config.sampleRate,
        frequencies,
        taps.length * 2,
        actualSpectrum
    );
    const afterRadians = new Float64Array(frequencies.length);
    for (let index = 0; index < frequencies.length; index += 1) {
        const beforeTotal = beforeComponents.total[index];
        const afterTotal = beforeTotal + filterComponents.total[index];
        afterRadians[index] = afterTotal;
    }
    const sourceDelays = groupDelaySources.map(source => analyzeRoomEqGroupDelay(
        source.groupDelaySamples || source.samples,
        source.groupDelayOnsetIndex ?? source.onsetIndex,
        config.sampleRate,
        frequencies
    ));
    const beforeDelay = sourceDelays.length === 1
        ? sourceDelays[0]
        : averageRoomEqGroupDelay(sourceDelays);
    const filterDelayAnalysis = analyzeRoomEqGroupDelay(
        taps,
        filterDelay,
        config.sampleRate,
        frequencies,
        { minimumFftSize: taps.length * 2, spectrum: actualSpectrum }
    );
    const afterDelay = combineRoomEqGroupDelay(beforeDelay, filterDelayAnalysis);
    const beforeDisplay = smoothRoomEqGroupDelay(
        beforeDelay,
        frequencies,
        config.smoothing
    );
    const afterDisplay = smoothRoomEqGroupDelay(
        afterDelay,
        frequencies,
        config.smoothing
    );
    return {
        phase: {
            before: Float32Array.from(beforeComponents.total, wrapPhaseDegrees),
            after: Float32Array.from(afterRadians, wrapPhaseDegrees)
        },
        groupDelay: {
            before: beforeDisplay.total,
            after: afterDisplay.total,
            minimum: {
                before: beforeDisplay.minimum,
                after: afterDisplay.minimum
            },
            excess: {
                before: beforeDisplay.excess,
                after: afterDisplay.excess
            }
        }
    };
}

function createImpulseResponsePreview(analysis, taps, config, actualSpectrum = null) {
    const previewPrerollMs = 2;
    // Display window: see previewWindowSamples. The Consensus average synthesizes
    // this far as `previewSamples`, a display-only view that is longer than the
    // `samples` every analysis path reads; the single-point path has no such view
    // and reads the raw measurement.
    const sampleCount = previewWindowSamples(config);
    const source = analysis.previewSamples || analysis.samples;
    const prerollSamples = Math.max(1, Math.round(
        config.sampleRate * previewPrerollMs / 1000
    ));
    const displaySampleCount = prerollSamples + sampleCount;
    const before = new Float32Array(displaySampleCount);

    const filterDelay = config.phase === 'min' ? 0 : taps.length / 2;
    const correctedSampleCount = filterDelay + displaySampleCount;
    const fftSize = nextPowerOfTwo(taps.length + correctedSampleCount - 1);
    const input = new Float64Array(fftSize);
    const correctedStart = analysis.onsetIndex - prerollSamples;
    const inputStart = correctedStart - (taps.length - 1);
    for (let index = 0; index < input.length; index += 1) {
        input[index] = source[inputStart + index] || 0;
    }
    const inputSpectrum = realTransform(input);
    bandLimitImpulsePreviewSpectrum(inputSpectrum, config.sampleRate, fftSize);
    const filteredInputTime = inverseRealTransform(
        inputSpectrum.real,
        inputSpectrum.imag,
        fftSize
    );
    let filterSpectrum = actualSpectrum;
    if (!filterSpectrum || filterSpectrum.real.length !== fftSize / 2 + 1) {
        const paddedTaps = new Float64Array(fftSize);
        paddedTaps.set(taps);
        filterSpectrum = realTransform(paddedTaps);
    }
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
        before[index] = filteredInputTime[firstValidSample + index] || 0;
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
    const requestedPhaseLowFrequency = Number(config.phaseLowFrequency);
    const requestedPhaseSmoothing = Number(config.phaseSmoothing);
    const sampleRate = Math.round(config.sampleRate || 48000);
    const directWindowMs = Math.max(1, Math.min(50, config.directWindowMs ?? 6));
    const reverbWindowMs = Math.max(20, Math.min(1000, config.reverbWindowMs ?? 300));
    const smoothing = Math.max(0.02, Math.min(1, config.smoothing ?? 0.17));
    return {
        ...config,
        phase,
        taps,
        sampleRate,
        smoothing,
        lowFrequency: Math.max(20, config.lowFrequency ?? 20),
        highFrequency: Math.min(20000, config.highFrequency ?? 16000),
        directWindowMs,
        lowFrequencyPhaseExtension: config.lowFrequencyPhaseExtension === true,
        phaseLowFrequency: config.phaseLowFrequency === null ||
            config.phaseLowFrequency === undefined ||
            !Number.isFinite(requestedPhaseLowFrequency)
            ? null
            : Math.max(20, Math.min(20000, requestedPhaseLowFrequency)),
        maxBoostDb: Math.max(0, Math.min(18, config.maxBoostDb ?? 6)),
        correctionAmount: Math.max(0, Math.min(1, config.correctionAmount ?? 1)),
        phaseCorrectionAmount: Math.max(0, Math.min(1, config.phaseCorrectionAmount ?? 1)),
        reverbAmount: Math.max(0, Math.min(1, config.reverbAmount ?? 0)),
        reverbWindowMs,
        reverbMaxFrequency: Math.max(20, Math.min(20000, config.reverbMaxFrequency ?? 250)),
        reverbSmoothing: Math.max(0.02, Math.min(1, config.reverbSmoothing ?? 0.05)),
        // Auto (null) resolves to the amplitude smoothing so the default stays
        // numerically identical to the pre-split behaviour (plan section 3.9).
        phaseSmoothing: config.phaseSmoothing === null ||
            config.phaseSmoothing === undefined ||
            !Number.isFinite(requestedPhaseSmoothing)
            ? smoothing
            : Math.max(0.02, Math.min(1, requestedPhaseSmoothing)),
        // The requested value controls observation, not correction advance. Actual
        // FIR realizability is judged after synthesis; limiting analysis to the FIR
        // half-length can discard a short modal delay carried by a longer decay.
        // The data-dependent available-window term is applied in designRoomEq.
        reverbWindowEffectiveMs: Math.max(directWindowMs, reverbWindowMs),
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
        lowFrequencyPhaseExtension: config.lowFrequencyPhaseExtension,
        phaseLowFrequency: config.phaseLowFrequency,
        maxBoostDb: config.maxBoostDb,
        correctionAmount: config.correctionAmount,
        phaseCorrectionAmount: config.phaseCorrectionAmount,
        reverbAmount: config.reverbAmount,
        reverbWindowMs: config.reverbWindowMs,
        reverbMaxFrequency: config.reverbMaxFrequency,
        reverbSmoothing: config.reverbSmoothing,
        phaseSmoothing: config.phaseSmoothing,
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
        const impulses = (source.impulses || []).filter(impulse => impulse?.data);
        return {
            measurement: [
                measurement.id || null,
                measurement.lastModified || null,
                measurement.timestamp || null
            ],
            impulses: impulses.map(impulse => [
                ...impulseSourceIdentity(measurement, impulse),
                impulse.sampleRate,
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
            predictedBaseDb: Float32Array.from(preview.predictedBaseDb),
            baseCorrectionDb: Float32Array.from(preview.baseCorrectionDb),
            phaseResponse: preview.phaseResponse ? {
                before: Float32Array.from(preview.phaseResponse.before),
                after: Float32Array.from(preview.phaseResponse.after)
            } : null,
            groupDelayResponse: preview.groupDelayResponse ? {
                before: Float32Array.from(preview.groupDelayResponse.before),
                after: Float32Array.from(preview.groupDelayResponse.after),
                minimum: {
                    before: Float32Array.from(preview.groupDelayResponse.minimum.before),
                    after: Float32Array.from(preview.groupDelayResponse.minimum.after)
                },
                excess: {
                    before: Float32Array.from(preview.groupDelayResponse.excess.before),
                    after: Float32Array.from(preview.groupDelayResponse.excess.after)
                }
            } : null,
            impulseResponse: preview.impulseResponse ? {
                sampleRate: preview.impulseResponse.sampleRate,
                startMs: preview.impulseResponse.startMs,
                durationMs: preview.impulseResponse.durationMs,
                before: Float32Array.from(preview.impulseResponse.before),
                after: Float32Array.from(preview.impulseResponse.after)
            } : null
        } : null),
        qualityWarnings: [...result.qualityWarnings],
        diagnostics: {
            phaseCorrection: result.diagnostics.phaseCorrection
                .map(value => ({ ...value })),
            lowFrequencyPhaseExtension: result.diagnostics.lowFrequencyPhaseExtension
                .map(value => ({ ...value })),
            reverbCorrection: result.diagnostics.reverbCorrection
                .map(value => ({ ...value }))
        },
        supportsFullPhase: result.supportsFullPhase,
        latencyInfo: { ...result.latencyInfo },
        config: {
            ...result.config,
            eqBands: (result.config.eqBands || []).map(band => ({ ...band }))
        }
    };
}

// Diagnostic for channels where the reverb correction cannot run at all (no
// impulse-response phase source). Every state carries effectiveWindowMs so the
// actually observed interval stays visible.
function reverbUnavailableDiagnostic(config, effectiveWindowMs) {
    return {
        state: config.reverbAmount === 0
            ? 'notRequested'
            : config.phase !== 'full'
                ? 'fullPhaseRequired'
                : 'impulseResponseRequired',
        effectiveWindowMs
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
    const phaseDiagnostics = [];
    const lowPhaseDiagnostics = [];
    const reverbDiagnostics = [];
    const qualityWarnings = [];
    let supportsFullPhase = true;
    for (let channelIndex = 0; channelIndex < (request.sources || []).length; channelIndex += 1) {
        const source = request.sources[channelIndex];
        if (!source?.measurement) {
            channels.push(unitImpulse(config));
            previews.push(null);
            phaseDiagnostics.push({
                state: 'disabled',
                scale: 0,
                reason: config.phase === 'full' ? 'impulseResponseRequired' : 'fullPhaseRequired'
            });
            lowPhaseDiagnostics.push({
                state: 'disabled',
                scale: 0,
                reason: config.lowFrequencyPhaseExtension
                    ? 'impulseResponseRequired'
                    : 'notRequested'
            });
            reverbDiagnostics.push(
                reverbUnavailableDiagnostic(config, config.reverbWindowEffectiveMs)
            );
            continue;
        }
        const impulses = Array.isArray(source.impulses) ? source.impulses.filter(value => value?.data) : [];
        let measuredDb;
        let displayMeasuredDb;
        let referenceAnalysis = null;
        let previewGroupDelaySources = null;
        let phaseSource = null;
        let reverbDiagnostic = null;
        if (impulses.length) {
            const analyses = impulses.map(impulse => analyzeImpulse(
                impulse,
                config.sampleRate,
                frequencies,
                impulseSourceIdentity(source.measurement, impulse)
            ));
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
            previewGroupDelaySources = consensus ? analyses : [referenceAnalysis];
            const synthesisFrequencies = new Float64Array(config.taps + 1);
            for (let bin = 0; bin <= config.taps; bin += 1) {
                synthesisFrequencies[bin] = bin * config.sampleRate / (config.taps * 2);
            }
            // Clamp the requested observation window by each candidate point's
            // analyzable length after the onset. FIR realizability is checked only
            // after phase synthesis; observation length and correction advance are
            // independent constraints.
            const reverbCandidateAnalyses = consensus ? analyses : [referenceAnalysis];
            let reverbWindowEffectiveMs = config.reverbWindowEffectiveMs;
            for (const analysis of reverbCandidateAnalyses) {
                const availableMs = (analysis.samples.length - analysis.onsetIndex) /
                    config.sampleRate * 1000;
                if (availableMs < reverbWindowEffectiveMs) {
                    reverbWindowEffectiveMs = availableMs;
                }
            }
            if (config.phase === 'full') {
                const directTaperMs = directWindowTaperMs(config);
                const timing = directSpectrum(
                    referenceAnalysis,
                    config.sampleRate,
                    config.directWindowMs,
                    synthesisFrequencies,
                    config.lowFrequencyPhaseExtension,
                    directTaperMs
                );
                phaseSource = {
                    timing,
                    candidates: (consensus ? analyses : [referenceAnalysis]).map(analysis =>
                        directSpectrum(
                            analysis,
                            config.sampleRate,
                            config.directWindowMs,
                            synthesisFrequencies,
                            config.lowFrequencyPhaseExtension,
                            directTaperMs
                        ))
                };
                if (config.reverbAmount === 0) {
                    reverbDiagnostic = {
                        state: 'notRequested',
                        effectiveWindowMs: reverbWindowEffectiveMs
                    };
                } else if (reverbWindowEffectiveMs <= config.directWindowMs) {
                    reverbDiagnostic = {
                        state: 'disabled',
                        reason: 'windowBudget',
                        effectiveWindowMs: reverbWindowEffectiveMs
                    };
                } else if (Math.max(config.lowFrequency, 3000 / reverbWindowEffectiveMs) >=
                    Math.min(
                        config.reverbMaxFrequency,
                        config.highFrequency,
                        config.sampleRate * 0.45
                    )) {
                    reverbDiagnostic = {
                        state: 'disabled',
                        reason: 'emptyBand',
                        effectiveWindowMs: reverbWindowEffectiveMs
                    };
                } else {
                    const reverbConfig = reverbPhaseConfig({
                        ...config,
                        reverbWindowEffectiveMs
                    });
                    const reverbTaperMs = reverbWindowTaperMs(reverbConfig);
                    const reverbConsensus = reverbExtendedConsensus(
                        reverbCandidateAnalyses.map(analysis => directSpectrum(
                            analysis,
                            config.sampleRate,
                            reverbWindowEffectiveMs,
                            synthesisFrequencies,
                            config.lowFrequencyPhaseExtension,
                            reverbTaperMs
                        )),
                        synthesisFrequencies,
                        reverbConfig,
                        config.taps * 2
                    );
                    phaseSource.reverb = {
                        ...reverbConsensus,
                        effectiveWindowMs: reverbWindowEffectiveMs
                    };
                    reverbDiagnostic = {
                        state: 'applied',
                        scale: 1,
                        agreementMinimum: reverbConsensus.agreementMinimum,
                        effectiveWindowMs: reverbWindowEffectiveMs
                    };
                }
            } else {
                reverbDiagnostic = {
                    state: config.reverbAmount === 0 ? 'notRequested' : 'fullPhaseRequired',
                    effectiveWindowMs: reverbWindowEffectiveMs
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
        for (let index = 0; index < frequencies.length; index += 1) {
            const automaticDb = smoothedAutomaticCorrection[index][1];
            baseCorrectionDb[index] = automaticDb * config.correctionAmount;
            correctionDb[index] = baseCorrectionDb[index] + eqDb[index];
            targetDb[index] = levelDb + eqDb[index];
        }
        const synthesis = synthesizeFilter(
            correctionDb,
            frequencies,
            config,
            phaseSource
        );
        if (synthesis.reverbGuard && reverbDiagnostic?.state === 'applied') {
            reverbDiagnostic = {
                ...reverbDiagnostic,
                state: synthesis.reverbGuard.state,
                scale: synthesis.reverbGuard.scale
            };
            if (synthesis.reverbGuard.reason) {
                reverbDiagnostic.reason = synthesis.reverbGuard.reason;
            }
        }
        // The correction is derived from the smoothed measurement, so adding it back to
        // that same smoothed curve cancels both smoothing passes and always predicts a
        // perfect result. Predict against the unsmoothed response and smooth once for
        // display instead, so peaks and dips narrower than the smoothing width stay
        // visible and the curve agrees with what Pipeline Analyzer measures.
        const predictResponse = appliedDb => Float64Array.from(
            smoothFrequencyResponse(
                frequencies.map((frequency, index) => [
                    frequency,
                    displayMeasuredDb[index] + appliedDb[index]
                ]),
                config.smoothing
            ),
            point => point[1]
        );
        const predictedDb = predictResponse(correctionDb);
        // Without the Additional EQ folded in, so the editor can redraw the corrected
        // curve while bands are being dragged and before the redesign lands.
        const predictedBaseDb = predictResponse(baseCorrectionDb);
        if (synthesis.verification.maximumMagnitudeErrorDb > 0.5 ||
            synthesis.verification.maximumPhaseErrorRadians > 0.05) {
            qualityWarnings.push(QUALITY_WARNING_FILTER_ACCURACY);
        }
        channels.push(synthesis.taps);
        lowPhaseDiagnostics.push(synthesis.lowPhaseDiagnostic);
        reverbDiagnostics.push(reverbDiagnostic ||
            reverbUnavailableDiagnostic(config, config.reverbWindowEffectiveMs));
        const phasePreviews = referenceAnalysis
            ? createPhasePreviews(
                referenceAnalysis,
                synthesis.taps,
                config,
                frequencies,
                synthesis.actualSpectrum,
                previewGroupDelaySources
            )
            : null;
        const phaseDiagnostic = {
            state: config.phase !== 'full' || config.phaseCorrectionAmount === 0
                ? 'notRequested'
                : referenceAnalysis ? 'applied' : 'disabled',
            scale: config.phase === 'full' && config.phaseCorrectionAmount > 0 && referenceAnalysis
                ? 1
                : 0,
            reason: config.phase !== 'full'
                ? 'fullPhaseRequired'
                : config.phaseCorrectionAmount === 0
                    ? 'phaseCorrectionDisabled'
                    : referenceAnalysis ? null : 'impulseResponseRequired'
        };
        if (phaseDiagnostic.state === 'applied' && phasePreviews?.groupDelay?.excess) {
            let beforeMaximum = 0;
            let afterMaximum = 0;
            const beforeValues = phasePreviews.groupDelay.excess.before;
            const afterValues = phasePreviews.groupDelay.excess.after;
            let referenceIndex = -1;
            let referenceDistance = Infinity;
            for (let index = 0; index < frequencies.length; index += 1) {
                if (!Number.isFinite(beforeValues[index]) || !Number.isFinite(afterValues[index])) continue;
                const distance = Math.abs(Math.log(frequencies[index] / 1000));
                if (distance < referenceDistance) {
                    referenceIndex = index;
                    referenceDistance = distance;
                }
            }
            const beforeReference = referenceIndex >= 0 ? beforeValues[referenceIndex] : 0;
            const afterReference = referenceIndex >= 0 ? afterValues[referenceIndex] : 0;
            for (let index = 0; index < beforeValues.length; index += 1) {
                const before = Math.abs(beforeValues[index] - beforeReference);
                const after = Math.abs(afterValues[index] - afterReference);
                if (Number.isFinite(before) && before > beforeMaximum) beforeMaximum = before;
                if (Number.isFinite(after) && after > afterMaximum) afterMaximum = after;
            }
            const availableDelayMs = (config.taps / 2 - 1) / config.sampleRate * 1000;
            if (beforeMaximum > availableDelayMs && afterMaximum > availableDelayMs) {
                phaseDiagnostic.state = 'reduced';
                phaseDiagnostic.scale = availableDelayMs / beforeMaximum;
                phaseDiagnostic.reason = 'firWindow';
                phaseDiagnostic.residualMaximumMs = afterMaximum;
            }
        }
        phaseDiagnostics.push(phaseDiagnostic);
        previews.push({
            channel: channelIndex,
            referenceLevelDb: levelDb,
            frequencies: Float32Array.from(frequencies),
            measuredDb: Float32Array.from(displaySmoothed),
            targetDb: Float32Array.from(targetDb),
            predictedDb: Float32Array.from(predictedDb),
            predictedBaseDb: Float32Array.from(predictedBaseDb),
            baseCorrectionDb: Float32Array.from(baseCorrectionDb),
            phaseResponse: phasePreviews?.phase || null,
            groupDelayResponse: phasePreviews?.groupDelay || null,
            impulseResponse: referenceAnalysis
                ? createImpulseResponsePreview(
                    referenceAnalysis,
                    synthesis.taps,
                    config,
                    synthesis.actualSpectrum
                )
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
        diagnostics: {
            phaseCorrection: phaseDiagnostics,
            lowFrequencyPhaseExtension: lowPhaseDiagnostics,
            reverbCorrection: reverbDiagnostics
        },
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
