import FFT from '../utils/measurement-dsp/fft.js';
import {
    createLogFrequencyGrid,
    interpolateLogResponse,
    smoothFrequencyResponse
} from '../utils/measurement-dsp/smoothing.js';
import { resampleWindowedSinc } from '../utils/measurement-dsp/resample.js';

const MIN_MAGNITUDE = 1e-8;
const IMPULSE_PREVIEW_MAX_FREQUENCY = 20000;
const GROUP_DELAY_REFERENCE_FREQUENCY = 1000;
const QUALITY_WARNING_FILTER_ACCURACY = 'filterAccuracy';
const QUALITY_WARNING_IMPULSE_RESPONSE_REQUIRED = 'impulseResponseRequired';
const LOW_PHASE_DFT_WORK_BUDGET = 8_000_000;
const LOW_PHASE_SCALE_STEPS = [1, 0.5, 0.25];
const MAX_LOW_PHASE_EDGE_ENERGY_RATIO = 0.002;
const LOW_PHASE_SUBSONIC_CLOSURE_HZ = 20;
const LOW_PHASE_INACTIVE_RMS_TOLERANCE = 0.00025;
const LOW_PHASE_INACTIVE_P95_TOLERANCE = 0.00075;
const LOW_PHASE_ACTIVE_ABSOLUTE_TOLERANCE = 0.0001;
const LOW_PHASE_ACTIVE_P95_ABSOLUTE_TOLERANCE = 0.00075;
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
        fullMagnitude: interpolateValues(
            sourceFrequencies.subarray(1),
            magnitudeSpectrum(analysis).subarray(1),
            synthesisFrequencies
        ),
        phase: interpolateValues(sourceFrequencies.subarray(1), unwrapPhase(phase).subarray(1), synthesisFrequencies),
        phaseCorrectionCache: new Map(),
        lowPhaseCorrectionCache: new Map(),
        samples: analysis.samples,
        onsetIndex: analysis.onsetIndex,
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
    return {
        samples: samples.subarray(0, dspLength),
        previewSamples: samples.subarray(0, displayLength),
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
        // Route the residual regridding through the cell-averaging variant (see
        // smoothReverbSynthesisValues); the direct-window path stays point-sampled.
        reverbResidualAggregation: true
    };
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

function lowPhaseCorrectionGate(frequency, low) {
    if (frequency <= low) return 0;
    const upper = low * 2 ** (1 / 3);
    if (frequency >= upper) return 1;
    const position = Math.log2(frequency / low) * 3;
    return 0.5 - 0.5 * Math.cos(Math.PI * position);
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
    const wrappedPhase = Float64Array.from(direct.phase);
    const coverage = new Float64Array(frequencies.length);
    coverage[anchor] = 1;
    const onset = direct.onsetIndex;
    const sampleRate = direct.sampleRate;
    const start = onset - Math.round(sampleRate * 0.001) > 0
        ? onset - Math.round(sampleRate * 0.001)
        : 0;
    const availableWindow = (direct.samples.length - onset) / sampleRate;
    const directWindow = config.directWindowMs / 1000;
    let coverageLimited = false;

    for (let index = first; index < anchor; index += 1) {
        const frequency = frequencies[index];
        const requestedWindow = directWindow * high / frequency;
        const windowLimited = requestedWindow > availableWindow;
        let window = requestedWindow;
        if (window > availableWindow) window = availableWindow;
        if (window <= 0) continue;
        const fadeSamples = Math.max(1, Math.floor(window * sampleRate));
        const end = Math.min(direct.samples.length, onset + fadeSamples);
        let real = 0;
        let imaginary = 0;
        const omega = 2 * Math.PI * frequency / sampleRate;
        for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
            let gain = 1;
            if (sampleIndex >= onset) {
                const position = (sampleIndex - onset) / fadeSamples;
                gain = 0.5 + 0.5 * Math.cos(Math.PI * position);
            }
            const sample = direct.samples[sampleIndex] * gain;
            const phase = omega * sampleIndex;
            real += sample * Math.cos(phase);
            imaginary -= sample * Math.sin(phase);
        }
        magnitude[index] = Math.hypot(real, imaginary);
        wrappedPhase[index] = Math.atan2(imaginary, real);
        coverage[index] = window < requestedWindow ? window / requestedWindow : 1;
        if (windowLimited) coverageLimited = true;
    }

    const phase = unwrapPhaseAround(wrappedPhase, anchor);
    const result = {
        first,
        anchor,
        magnitude,
        phase,
        coverage,
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
    const physicalMagnitude = Float64Array.from(
        direct.fullMagnitude || spectrum.magnitude,
        magnitude => magnitude > floor ? magnitude : floor
    );
    const measuredMinimumPhase = minimumPhaseForMagnitude(physicalMagnitude, fftSize);
    const hybridTotal = unwrapPhaseAround(spectrum.phase, spectrum.anchor);
    const onsetDelay = direct.onsetIndex / direct.sampleRate;
    const totalAnchorPhase = hybridTotal[spectrum.anchor] +
        2 * Math.PI * frequencies[spectrum.anchor] * onsetDelay;
    const totalResidual = Float64Array.from(frequencies, (frequency, index) =>
        hybridTotal[index] + 2 * Math.PI * frequency * onsetDelay - totalAnchorPhase);
    const lowResidualSmoothingConfig = { ...config, smoothing: config.phaseSmoothing };
    const smoothedTotalResidual =
        smoothSynthesisValues(totalResidual, frequencies, lowResidualSmoothingConfig);
    const hybridWrappedExcess = Float64Array.from(
        spectrum.phase,
        (phase, index) => phase - measuredMinimumPhase[index]
    );
    const hybridExcess = unwrapPhaseAround(hybridWrappedExcess, spectrum.anchor);
    const anchorPhase = hybridExcess[spectrum.anchor] +
        2 * Math.PI * frequencies[spectrum.anchor] * onsetDelay;
    const residual = Float64Array.from(frequencies, (frequency, index) =>
        hybridExcess[index] + 2 * Math.PI * frequency * onsetDelay - anchorPhase);
    const smoothedResidual =
        smoothSynthesisValues(residual, frequencies, lowResidualSmoothingConfig);

    const intervalDelays = new Float64Array(spectrum.anchor + 1);
    const hybridIntervalDelays = new Float64Array(spectrum.anchor + 1);
    const totalIntervalDelays = new Float64Array(spectrum.anchor + 1);
    const fixedBlend = new Float64Array(spectrum.anchor + 1);
    const reliability = new Float64Array(spectrum.anchor + 1);
    const blendStart = high / 2 ** (1 / 3);
    for (let index = spectrum.first + 1; index <= spectrum.anchor; index += 1) {
        const deltaOmega = 2 * Math.PI * (frequencies[index] - frequencies[index - 1]);
        const hybridDelay = deltaOmega === 0
            ? 0
            : -(smoothedResidual[index] - smoothedResidual[index - 1]) / deltaOmega;
        const totalDelay = deltaOmega === 0
            ? 0
            : -(smoothedTotalResidual[index] - smoothedTotalResidual[index - 1]) /
                deltaOmega;
        const midpoint = Math.sqrt(frequencies[index - 1] * frequencies[index]);
        let blend = 0;
        if (midpoint > blendStart) {
            let position = Math.log2(midpoint / blendStart) * 3;
            if (position > 1) position = 1;
            blend = 0.5 - 0.5 * Math.cos(Math.PI * position);
        }
        hybridIntervalDelays[index] = hybridDelay;
        totalIntervalDelays[index] = totalDelay;
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
        reliability[index] = magnitudeReliability * timeReliability;
    }
    const result = {
        first: spectrum.first,
        anchor: spectrum.anchor,
        intervalDelays,
        hybridIntervalDelays,
        totalIntervalDelays,
        fixedBlend,
        reliability,
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

function lowPhaseDftWork(directs, frequencies, config, high) {
    const directWindow = config.directWindowMs / 1000;
    let work = 0;
    for (const direct of directs) {
        if (!direct.samples || !Number.isSafeInteger(direct.onsetIndex)) continue;
        const preroll = direct.onsetIndex - Math.max(
            0,
            direct.onsetIndex - Math.round(direct.sampleRate * 0.001)
        );
        const sourceWindow = (direct.samples.length - direct.onsetIndex) /
            direct.sampleRate;
        for (const frequency of frequencies) {
            if (frequency < config.lowFrequency) continue;
            if (frequency >= high) break;
            let window = directWindow * high / frequency;
            if (window > sourceWindow) window = sourceWindow;
            if (window <= 0) continue;
            work += preroll + Math.max(1, Math.floor(window * direct.sampleRate));
            if (work > LOW_PHASE_DFT_WORK_BUDGET) return work;
        }
    }
    return work;
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
        config.reverbResidualAggregation ? 1 : 0
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
    // The direct-phase residual is smoothed with the phase smoothing (ps). The
    // reverb path arrives here with smoothing === phaseSmoothing === rs via
    // reverbPhaseConfig, so both paths read the same resolved width.
    const residualSmoothingConfig = { ...config, smoothing: config.phaseSmoothing };
    const smoothedResidual = config.reverbResidualAggregation
        ? smoothReverbSynthesisValues(residual, frequencies, residualSmoothingConfig)
        : smoothSynthesisValues(residual, frequencies, residualSmoothingConfig);
    const intervalDelays = new Float64Array(frequencies.length);
    const limit = config.directWindowMs / 1000;
    for (let index = 1; index < frequencies.length; index += 1) {
        const deltaOmega = 2 * Math.PI * (frequencies[index] - frequencies[index - 1]);
        let delay = deltaOmega === 0
            ? 0
            : -(smoothedResidual[index] - smoothedResidual[index - 1]) / deltaOmega;
        if (delay > limit) delay = limit;
        else if (delay < -limit) delay = -limit;
        intervalDelays[index] = delay;
    }
    const result = {
        first,
        low,
        high,
        floor,
        slope,
        intercept,
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
        config.reverbResidualAggregation ? 1 : 0
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
    reverbTargetDelays = null
) {
    if (!config.lowFrequencyPhaseExtension) {
        return { phase: null, reason: 'notRequested' };
    }
    const high = Math.min(
        phaseCorrectionLowFrequency(config),
        config.highFrequency,
        config.sampleRate * 0.45
    );
    const workSources = directs.includes(target) ? directs : [target, ...directs];
    if (lowPhaseDftWork(workSources, frequencies, config, high) > LOW_PHASE_DFT_WORK_BUDGET) {
        return { phase: null, reason: 'dftWorkBudget' };
    }
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
            const estimates = [];
            let weightedDelay = 0;
            let weightedDelaySquared = 0;
            let weightSum = 0;
            for (const analysis of pointAnalyses) {
                if (!analysis) continue;
                const weight = analysis.reliability[index];
                const delay = analysis.hybridIntervalDelays[index];
                if (weight <= 0) continue;
                estimates.push({ delay, weight });
                weightedDelay += delay * weight;
                weightedDelaySquared += delay * delay * weight;
                weightSum += weight;
            }
            estimates.sort((left, right) => left.delay - right.delay);
            let cumulativeWeight = 0;
            commonDelay = 0;
            for (let estimateIndex = 0; estimateIndex < estimates.length; estimateIndex += 1) {
                const estimate = estimates[estimateIndex];
                cumulativeWeight += estimate.weight;
                const halfWeight = weightSum / 2;
                const halfTolerance = Number.EPSILON * Math.max(1, weightSum) * 8;
                if (Math.abs(cumulativeWeight - halfWeight) <= halfTolerance &&
                    estimateIndex + 1 < estimates.length) {
                    commonDelay = (estimate.delay + estimates[estimateIndex + 1].delay) / 2;
                    break;
                }
                if (cumulativeWeight > halfWeight) {
                    commonDelay = estimate.delay;
                    break;
                }
            }
            if (weightedDelaySquared > 0 && weightSum > 0) {
                commonDelay *= weightedDelay * weightedDelay /
                    (weightedDelaySquared * weightSum);
            }
        }
        commonDelays[index] = commonDelay;
    }
    let smoothedCommonDelays = commonDelays;
    if (pointAnalyses.length > 1) {
        const smoothingInput = Float64Array.from(commonDelays);
        smoothingInput.fill(
            commonDelays[targetAnalysis.first + 1],
            0,
            targetAnalysis.first + 1
        );
        smoothingInput.fill(
            commonDelays[targetAnalysis.anchor],
            targetAnalysis.anchor + 1
        );
        smoothedCommonDelays = smoothSynthesisValues(
            smoothingInput,
            frequencies,
            {
                ...config,
                smoothing: config.phaseSmoothing < 1 / 3 ? 1 / 3 : config.phaseSmoothing
            }
        );
    }
    const phase = new Float64Array(frequencies.length);
    for (let index = targetAnalysis.anchor;
        index > targetAnalysis.first;
        index -= 1) {
        const blend = targetAnalysis.fixedBlend[index];
        const deltaOmega = 2 * Math.PI * (frequencies[index] - frequencies[index - 1]);
        const midpoint = Math.sqrt(frequencies[index] * frequencies[index - 1]);
        // Reverb incrementalization (plan section 3.4): the adopted reverb
        // correction rv*s*delta already removes part of the measured low-band
        // excess delay, so the LFE targets only the remaining residual --
        // without this subtraction the two paths double-estimate the same
        // excess delay and over-correct by the shared amount.
        const targetDelay = (
            smoothedCommonDelays[index] - alignmentGroupDelayPerAmount
        ) * (1 - blend) + upperBoundaryDelay * blend -
            (reverbTargetDelays ? reverbTargetDelays[index] : 0);
        const gatedTargetDelay = targetDelay * lowPhaseCorrectionGate(
            midpoint,
            config.lowFrequency
        );
        phase[index - 1] = phase[index] + gatedTargetDelay * deltaOmega;
    }
    let activeLast = targetAnalysis.first;
    for (let index = targetAnalysis.first + 1;
        index <= targetAnalysis.anchor && targetAnalysis.fixedBlend[index] === 0;
        index += 1) {
        activeLast = index;
    }
    let activeFirst = targetAnalysis.first + 1;
    const lowGateEnd = config.lowFrequency * 2 ** (1 / 3);
    while (activeFirst <= activeLast &&
        Math.sqrt(frequencies[activeFirst - 1] * frequencies[activeFirst]) < lowGateEnd) {
        activeFirst += 1;
    }
    return {
        phase,
        reason: null,
        guard: {
            first: targetAnalysis.first,
            activeFirst,
            activeLast,
            referenceTotalDelays: targetAnalysis.totalIntervalDelays
        },
        coverageLimited: targetAnalysis.coverageLimited ||
            pointAnalyses.some(analysis => analysis?.coverageLimited === true)
    };
}

function consensusDirectPhaseCorrection(directs, frequencies, config, fftSize) {
    if (directs.length === 1) {
        return directPhaseCorrection(directs[0], frequencies, config, fftSize);
    }
    const corrections = directs.map(direct =>
        directPhaseCorrection(direct, frequencies, config, fftSize));
    const low = phaseCorrectionLowFrequency(config);
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

// Extended-window (reverb) inter-point synthesis: combines the per-point clamped
// interval delays tau_ext,i into a reliability-weighted circular mean plus an
// agreement A_ext. The mean's angle scale is the synthesis-grid delta-omega, which
// is single-valued because |tau| <= rw_eff/1000 and rw_eff <= taps/(2*rate)*1000
// bound |theta| by pi/2. The agreement is evaluated on the reverb-smoothing scale
// delta-omega_rs = 2*pi*f*(2^rs - 1) instead, so its sensitivity tracks the
// structure that survives smoothing rather than the taps count. A single point
// passes through with A_ext = 1, mirroring consensusDirectPhaseCorrection.
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
    const deltaOmega = 2 * Math.PI * (frequencies[1] - frequencies[0]);
    const smoothingScale = 2 * Math.PI * (2 ** config.reverbSmoothing - 1);
    for (let index = Math.max(1, first); index < frequencies.length &&
        frequencies[index] <= upper; index += 1) {
        let real = 0;
        let imaginary = 0;
        let agreementReal = 0;
        let agreementImaginary = 0;
        let weightSum = 0;
        for (let point = 0; point < directs.length; point += 1) {
            const reliability = directs[point].magnitude[index] / analyses[point].floor;
            const weight = reliability < 1 ? reliability * reliability : 1;
            const delay = analyses[point].intervalDelays[index];
            const theta = delay * deltaOmega;
            real += Math.cos(theta) * weight;
            imaginary += Math.sin(theta) * weight;
            const agreementTheta = delay * smoothingScale * frequencies[index];
            agreementReal += Math.cos(agreementTheta) * weight;
            agreementImaginary += Math.sin(agreementTheta) * weight;
            weightSum += weight;
        }
        if (weightSum > 0) {
            intervalDelays[index] = Math.atan2(imaginary, real) / deltaOmega;
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

function lowPhaseRelativeDelays(candidate, baseline, frequencies) {
    const candidateSpectrum = candidate.actualSpectrum;
    const baselineSpectrum = baseline.actualSpectrum;
    const wrapped = new Float64Array(frequencies.length);
    let first = 1;
    while (first < frequencies.length &&
        frequencies[first] < LOW_PHASE_SUBSONIC_CLOSURE_HZ) {
        first += 1;
    }
    for (let bin = first; bin < wrapped.length; bin += 1) {
        const candidateReal = candidateSpectrum.real[bin];
        const candidateImaginary = candidateSpectrum.imag[bin];
        const baselineReal = baselineSpectrum.real[bin];
        const baselineImaginary = baselineSpectrum.imag[bin];
        wrapped[bin] = Math.atan2(
            candidateImaginary * baselineReal - candidateReal * baselineImaginary,
            candidateReal * baselineReal + candidateImaginary * baselineImaginary
        );
    }
    const phase = unwrapPhaseFrom(wrapped, first);
    const delays = new Float64Array(frequencies.length);
    for (let bin = first + 1; bin < delays.length; bin += 1) {
        const deltaOmega = 2 * Math.PI * (frequencies[bin] - frequencies[bin - 1]);
        if (deltaOmega > 0) {
            delays[bin] = -(phase[bin] - phase[bin - 1]) / deltaOmega;
        }
    }
    return delays;
}

function lowPhaseActualFilterDelays(rendered, frequencies, config) {
    const spectrum = rendered.actualSpectrum;
    const wrapped = new Float64Array(frequencies.length);
    const centerDelay = config.taps / (2 * config.sampleRate);
    for (let bin = 1; bin < wrapped.length; bin += 1) {
        wrapped[bin] = Math.atan2(spectrum.imag[bin], spectrum.real[bin]) +
            2 * Math.PI * frequencies[bin] * centerDelay;
    }
    const phase = unwrapPhaseFrom(wrapped, 1);
    const delays = new Float64Array(frequencies.length);
    for (let bin = 2; bin < delays.length; bin += 1) {
        const deltaOmega = 2 * Math.PI * (frequencies[bin] - frequencies[bin - 1]);
        if (deltaOmega > 0) {
            delays[bin] = -(phase[bin] - phase[bin - 1]) / deltaOmega;
        }
    }
    return delays;
}

function lowPhaseDelayScore(delays, frequencies, first, last) {
    if (last < first) return { rms: 0, p95: 0 };
    const distribution = [];
    let squared = 0;
    let weightSum = 0;
    for (let index = first; index <= last; index += 1) {
        const low = frequencies[index - 1];
        const high = frequencies[index];
        if (!(low > 0) || !(high > low)) continue;
        const weight = Math.log(high / low);
        const magnitude = Math.abs(delays[index]);
        distribution.push({ magnitude, weight });
        squared += magnitude * magnitude * weight;
        weightSum += weight;
    }
    if (weightSum === 0) return { rms: 0, p95: 0 };
    distribution.sort((left, right) => left.magnitude - right.magnitude);
    const percentileWeight = weightSum * 0.95;
    let cumulative = 0;
    let p95 = distribution[distribution.length - 1].magnitude;
    for (const entry of distribution) {
        cumulative += entry.weight;
        if (cumulative >= percentileWeight) {
            p95 = entry.magnitude;
            break;
        }
    }
    return { rms: Math.sqrt(squared / weightSum), p95 };
}

function lowPhaseDoesNotWorsen(
    candidate,
    baseline,
    guard,
    frequencies,
    config
) {
    const relativeDelays = lowPhaseRelativeDelays(candidate, baseline, frequencies);
    let inactiveFirst = 1;
    while (inactiveFirst < guard.first &&
        frequencies[inactiveFirst - 1] < LOW_PHASE_SUBSONIC_CLOSURE_HZ) {
        inactiveFirst += 1;
    }
    const inactive = lowPhaseDelayScore(
        relativeDelays,
        frequencies,
        inactiveFirst,
        guard.first - 1
    );
    if (inactive.rms > LOW_PHASE_INACTIVE_RMS_TOLERANCE ||
        inactive.p95 > LOW_PHASE_INACTIVE_P95_TOLERANCE) {
        return false;
    }

    const baselineFilterDelays = lowPhaseActualFilterDelays(
        baseline,
        frequencies,
        config
    );
    const baselineResidual = new Float64Array(frequencies.length);
    const candidateResidual = new Float64Array(frequencies.length);
    for (let index = guard.activeFirst; index <= guard.activeLast; index += 1) {
        baselineResidual[index] = guard.referenceTotalDelays[index] +
            baselineFilterDelays[index];
        candidateResidual[index] = baselineResidual[index] + relativeDelays[index];
    }
    const baselineScore = lowPhaseDelayScore(
        baselineResidual,
        frequencies,
        guard.activeFirst,
        guard.activeLast
    );
    const candidateScore = lowPhaseDelayScore(
        candidateResidual,
        frequencies,
        guard.activeFirst,
        guard.activeLast
    );
    const rmsTolerance = Math.max(
        LOW_PHASE_ACTIVE_ABSOLUTE_TOLERANCE,
        baselineScore.rms * LOW_PHASE_ACTIVE_RELATIVE_TOLERANCE
    );
    const p95Tolerance = Math.max(
        LOW_PHASE_ACTIVE_P95_ABSOLUTE_TOLERANCE,
        baselineScore.p95 * LOW_PHASE_ACTIVE_RELATIVE_TOLERANCE
    );
    return candidateScore.rms <= baselineScore.rms + rmsTolerance &&
        candidateScore.p95 <= baselineScore.p95 + p95Tolerance;
}

function synthesizeFilter(
    correctionDb,
    gridFrequencies,
    config,
    phaseSource,
    baseOnlyCorrectionDb = correctionDb
) {
    const plan = getSynthesisPlan(gridFrequencies, config);
    const { fftSize, binFrequencies } = plan;
    const interpolated = interpolateWithPlan(correctionDb, plan);
    let magnitudes = Float64Array.from(interpolated, dbToGain);
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
        phase = Float64Array.from(minimumPhaseForMagnitude(magnitudes, fftSize));
    } else if (config.phase === 'full') {
        fullReferencePhase = Float64Array.from(minimumPhaseForMagnitude(magnitudes, fftSize));
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
            // and the direct-window correction: tau_delta = A_ext * W * (tau_ext -
            // tau_dir), re-integrated as delta[i] = delta[i-1] - tau_delta * dOmega.
            // W comes from the same effective band arguments as the C_ext analysis
            // (its low/high), so out-of-band tau_ext values never leak in. Bins at or
            // below `first` stay zero and accumulation starts at first + 1, matching
            // directPhaseCorrection; above the upper flank W = 0 leaves a constant
            // plateau (a uniform rotation). A_ext and W act on interval delays only,
            // never on the integrated phase.
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
                    intervalDelay = reverb.agreement[bin] * weight *
                        (reverb.intervalDelays[bin] - directDelay);
                }
                reverbPhase[bin] = reverbPhase[bin - 1] - intervalDelay * deltaOmega;
            }
        }
        let reverbTargetDelays = null;
        if (reverbPhase) {
            // Staged degradation guard (plan section 3.6, fixed order).
            // Step 1: the rv=0 guard baseline synthesizes from the baseOnly
            // (fine-free) amplitude with correctionTimingAlignment recomputed
            // natively from the rv=0 phase -- identical to the true rv=0 design
            // and therefore to the all-fail final product. Sharing the
            // candidate-side alignment instead would push the baseline's compact
            // impulse into the 5% edge window and inflate baselineEdge,
            // loosening the relative edgeLimit exactly when the guard must fire.
            const baseMagnitudes = baseOnlyCorrectionDb === correctionDb
                ? magnitudes
                : Float64Array.from(
                    interpolateWithPlan(baseOnlyCorrectionDb, plan),
                    dbToGain
                );
            const baseReferencePhase = baseMagnitudes === magnitudes
                ? fullReferencePhase
                : Float64Array.from(minimumPhaseForMagnitude(baseMagnitudes, fftSize));
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
            // Step 2: rv scale ladder [1, 0.5, 0.25], LFE-free and phase-only
            // (the fine amplitude stays intact under 'reduced'; a fine-driven
            // edge excess fails every scale and converges to 'disabled', which
            // stops the fine as well). The timing alignment is computed once at
            // s=1 and reused for every ladder candidate, matching the LFE loop.
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
                    reverbTargetDelays = new Float64Array(phase.length);
                    for (let bin = 1; bin < reverbTargetDelays.length; bin += 1) {
                        reverbTargetDelays[bin] = -(
                            reverbPhase[bin] - reverbPhase[bin - 1]
                        ) / deltaOmega * delayFactor;
                    }
                }
            } else {
                // All scales failed: ship the guard baseline itself with no
                // re-render -- 'disabled' stops the phase delta and the fine
                // amplitude both, bit-identical to the true rv=0 design. The
                // LFE loop below then runs on this natively aligned baseline.
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
                reverbTargetDelays
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
    let reductionReason = null;
    for (const scale of LOW_PHASE_SCALE_STEPS) {
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
            baseline,
            lowGuard,
            binFrequencies,
            config
        );
        if (energySafe && groupDelaySafe) {
            candidate.lowPhaseDiagnostic = {
                state: scale === 1 && !lowCoverageLimited ? 'applied' : 'reduced',
                scale,
                reason: scale < 1
                    ? reductionReason || 'groupDelay'
                    : lowCoverageLimited
                        ? 'insufficientData'
                        : null
            };
            candidate.reverbGuard = reverbGuardDiagnostic;
            return candidate;
        }
        if (!groupDelaySafe) reductionReason = 'groupDelay';
        else if (!energySafe && reductionReason === null) reductionReason = 'firEnergy';
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

function interpolateOnGrid(values, frequencies, frequency) {
    if (!frequencies.length) return 0;
    let upper = 1;
    while (upper < frequencies.length && frequencies[upper] < frequency) upper += 1;
    if (upper >= frequencies.length) return values[values.length - 1];
    const lowFrequency = frequencies[upper - 1];
    const highFrequency = frequencies[upper];
    const fraction = highFrequency > lowFrequency
        ? (frequency - lowFrequency) / (highFrequency - lowFrequency)
        : 0;
    return values[upper - 1] + fraction * (values[upper] - values[upper - 1]);
}

// Group delay is the negative slope of the unwrapped phase, taken between adjacent
// grid points so the curve carries no smoothing of its own. Smoothing is the single
// configured pass, matching the measured magnitude display.
function referencedGroupDelayMs(phaseRadians, frequencies, smoothing) {
    const delays = frequencies.map((frequency, index) => {
        const low = index > 0 ? index - 1 : index;
        const high = index < frequencies.length - 1 ? index + 1 : index;
        const span = frequencies[high] - frequencies[low];
        return [
            frequency,
            span > 0
                ? (phaseRadians[low] - phaseRadians[high]) * 1000 /
                    (2 * Math.PI * span)
                : 0
        ];
    });
    const smoothed = smoothFrequencyResponse(delays, smoothing)
        .map(point => point[1]);
    const reference = interpolateOnGrid(
        smoothed,
        frequencies,
        GROUP_DELAY_REFERENCE_FREQUENCY
    );
    return Float32Array.from(smoothed, value => value - reference);
}

function createPhasePreviews(analysis, taps, config, frequencies, actualSpectrum = null) {
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
    const afterMinimumRadians = new Float64Array(frequencies.length);
    const beforeExcessRadians = new Float64Array(frequencies.length);
    const afterExcessRadians = new Float64Array(frequencies.length);
    for (let index = 0; index < frequencies.length; index += 1) {
        const beforeTotal = beforeComponents.total[index];
        const beforeMinimum = beforeComponents.minimum[index];
        const afterTotal = beforeTotal + filterComponents.total[index];
        const afterMinimum = beforeMinimum + filterComponents.minimum[index];
        afterRadians[index] = afterTotal;
        afterMinimumRadians[index] = afterMinimum;
        beforeExcessRadians[index] = beforeTotal - beforeMinimum;
        afterExcessRadians[index] = afterTotal - afterMinimum;
    }
    return {
        phase: {
            before: Float32Array.from(beforeComponents.total, wrapPhaseDegrees),
            after: Float32Array.from(afterRadians, wrapPhaseDegrees)
        },
        groupDelay: {
            before: referencedGroupDelayMs(
                beforeComponents.total,
                frequencies,
                config.smoothing
            ),
            after: referencedGroupDelayMs(afterRadians, frequencies, config.smoothing),
            minimum: {
                before: referencedGroupDelayMs(
                    beforeComponents.minimum,
                    frequencies,
                    config.smoothing
                ),
                after: referencedGroupDelayMs(
                    afterMinimumRadians,
                    frequencies,
                    config.smoothing
                )
            },
            excess: {
                before: referencedGroupDelayMs(
                    beforeExcessRadians,
                    frequencies,
                    config.smoothing
                ),
                after: referencedGroupDelayMs(
                    afterExcessRadians,
                    frequencies,
                    config.smoothing
                )
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
        // Effective reverb analysis window from the two config-derived terms only:
        // the requested window (never shorter than the direct window) and the taps
        // budget taps/(2*rate). The data-dependent available-window term is applied
        // in designRoomEq where the impulse analyses are known.
        reverbWindowEffectiveMs: Math.min(
            Math.max(directWindowMs, reverbWindowMs),
            taps / (2 * sampleRate) * 1000
        ),
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
// implicit taps-budget clamp stays visible.
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
    const lowPhaseDiagnostics = [];
    const reverbDiagnostics = [];
    const qualityWarnings = [];
    let supportsFullPhase = true;
    for (let channelIndex = 0; channelIndex < (request.sources || []).length; channelIndex += 1) {
        const source = request.sources[channelIndex];
        if (!source?.measurement) {
            channels.push(unitImpulse(config));
            previews.push(null);
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
            const synthesisFrequencies = new Float64Array(config.taps + 1);
            for (let bin = 0; bin <= config.taps; bin += 1) {
                synthesisFrequencies[bin] = bin * config.sampleRate / (config.taps * 2);
            }
            // rw_eff finalization: clamp the config-derived effective window by each
            // candidate point's analyzable length after the onset (directSpectrum
            // silently truncates its window otherwise). Evaluation order below is
            // fixed: rw_eff clamp -> windowBudget -> emptyBand.
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
                    const reverbConsensus = reverbExtendedConsensus(
                        reverbCandidateAnalyses.map(analysis => directSpectrum(
                            analysis,
                            config.sampleRate,
                            reverbWindowEffectiveMs,
                            synthesisFrequencies
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
        // Fine amplitude structure (plan section 3.5): when the extended-window
        // consensus is available (phase full, rv > 0, rw_eff > dw, non-empty band),
        // blend a reverb-smoothed (rs) correction toward the base (sm) correction
        // inside the reverb amplitude band. W_amp shifts the correctionWeight
        // arguments inward by 2^(1/3) so both flank ends land exactly on the band
        // boundaries (low_W, high_W) and the rv term stays strictly zero outside
        // the current amplitude-correction band. The shifted band can be empty
        // even when the phase band is not, and correctionWeight is not
        // identically zero for crossed arguments (its lower flank ignores the
        // high argument), so that configuration must skip the fine path through
        // this explicit branch. With correctionAmount 0 the amplitude correction
        // is fully disabled, so the fine path is skipped as well.
        let fineBlend = null;
        let fineCorrectionDb = null;
        if (phaseSource?.reverb && config.correctionAmount > 0) {
            const reverb = phaseSource.reverb;
            const fineLow = reverb.low * 2 ** (1 / 3);
            const fineHigh = Math.min(config.reverbMaxFrequency, effectiveHigh) /
                2 ** (1 / 3);
            if (fineLow < fineHigh) {
                const smoothedFine = smoothFrequencyResponse(
                    frequencies.map((frequency, index) => [
                        frequency,
                        frequency > config.lowFrequency && frequency < effectiveHigh
                            ? softLimitBoost(
                                levelDb - unsmoothedMeasuredDb[index],
                                config.maxBoostDb
                            )
                            : 0
                    ]),
                    config.reverbSmoothing
                );
                // A_ext lives on the synthesis linear grid; consume it here by
                // linear interpolation only. Recomputing the inter-point
                // consensus on this grid is forbidden (CPU budget assumption).
                const binWidth = config.sampleRate / (config.taps * 2);
                fineBlend = new Float64Array(frequencies.length);
                fineCorrectionDb = new Float64Array(frequencies.length);
                for (let index = 0; index < frequencies.length; index += 1) {
                    const weight = correctionWeight(
                        frequencies[index],
                        fineLow,
                        fineHigh,
                        config.sampleRate * 0.48
                    );
                    if (weight === 0) continue;
                    const position = frequencies[index] / binWidth;
                    const lowerBin = Math.min(Math.floor(position), config.taps - 1);
                    const fraction = position - lowerBin;
                    const agreement = reverb.agreement[lowerBin] * (1 - fraction) +
                        reverb.agreement[lowerBin + 1] * fraction;
                    fineBlend[index] = config.reverbAmount * agreement * weight;
                    fineCorrectionDb[index] = smoothedFine[index][1];
                }
            }
        }
        const correctionDb = new Float64Array(frequencies.length);
        const baseCorrectionDb = new Float64Array(frequencies.length);
        // Fine-free amplitude twins (plan section 3.6 dataflow): the rv=0 guard
        // baseline and the all-fail final product synthesize from the baseOnly
        // side, so it is built alongside whenever the fine path is active.
        const baseOnlyCorrectionDb = fineBlend
            ? new Float64Array(frequencies.length)
            : correctionDb;
        const baseOnlyBaseCorrectionDb = fineBlend
            ? new Float64Array(frequencies.length)
            : baseCorrectionDb;
        const targetDb = new Float64Array(frequencies.length);
        for (let index = 0; index < frequencies.length; index += 1) {
            let automaticDb = smoothedAutomaticCorrection[index][1];
            if (fineBlend) {
                baseOnlyBaseCorrectionDb[index] = automaticDb * config.correctionAmount;
                baseOnlyCorrectionDb[index] =
                    baseOnlyBaseCorrectionDb[index] + eqDb[index];
                automaticDb += fineBlend[index] *
                    (fineCorrectionDb[index] - automaticDb);
            }
            baseCorrectionDb[index] = automaticDb * config.correctionAmount;
            correctionDb[index] = baseCorrectionDb[index] + eqDb[index];
            targetDb[index] = levelDb + eqDb[index];
        }
        const synthesis = synthesizeFilter(
            correctionDb,
            frequencies,
            config,
            phaseSource,
            baseOnlyCorrectionDb
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
        // When the guard disables the reverb correction, the shipped filter is
        // the baseOnly baseline, so the preview curves are rebuilt from the
        // baseOnly side to match the shipped fine-free reality (plan section 3.6).
        const shipsBaseOnly = synthesis.reverbGuard?.state === 'disabled';
        const previewCorrectionDb = shipsBaseOnly ? baseOnlyCorrectionDb : correctionDb;
        const previewBaseCorrectionDb = shipsBaseOnly
            ? baseOnlyBaseCorrectionDb
            : baseCorrectionDb;
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
        const predictedDb = predictResponse(previewCorrectionDb);
        // Without the Additional EQ folded in, so the editor can redraw the corrected
        // curve while bands are being dragged and before the redesign lands.
        const predictedBaseDb = predictResponse(previewBaseCorrectionDb);
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
                synthesis.actualSpectrum
            )
            : null;
        previews.push({
            channel: channelIndex,
            referenceLevelDb: levelDb,
            frequencies: Float32Array.from(frequencies),
            measuredDb: Float32Array.from(displaySmoothed),
            targetDb: Float32Array.from(targetDb),
            predictedDb: Float32Array.from(predictedDb),
            predictedBaseDb: Float32Array.from(predictedBaseDb),
            baseCorrectionDb: Float32Array.from(previewBaseCorrectionDb),
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
