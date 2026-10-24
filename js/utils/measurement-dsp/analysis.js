import FFT from './fft.js';
import { smoothFrequencyResponse } from './smoothing.js';

const MAX_SAMPLES = 2 ** 20;

function finiteSamples(data) {
    return data instanceof Float32Array && data.length > 1 && data.length <= MAX_SAMPLES &&
        data.every(Number.isFinite);
}

export function validateHarmonicAnalysis(value) {
    if (value?.version !== 2 || value.method !== 'ess' || value.reference !== 'unit-input' ||
        value.calibration !== 'uncorrected-system' || !Number.isFinite(value.sampleRate) ||
        value.sampleRate <= 0 || typeof value.quality?.valid !== 'boolean' ||
        !Array.isArray(value.quality.reasons) || !value.quality.reasons.every(reason => typeof reason === 'string')) return false;
    const excitation = value.excitation;
    if (!excitation || !Number.isFinite(excitation.startFrequency) || excitation.startFrequency <= 0 ||
        !Number.isFinite(excitation.endFrequency) || excitation.endFrequency <= excitation.startFrequency ||
        excitation.endFrequency >= value.sampleRate / 2 || !Number.isFinite(excitation.durationSeconds) ||
        excitation.durationSeconds <= 0 || !Number.isFinite(excitation.levelDb) ||
        !Number.isSafeInteger(excitation.sweepSamples) || excitation.sweepSamples < 2 ||
        Math.abs(excitation.durationSeconds * value.sampleRate - excitation.sweepSamples) > 1) return false;
    if (!Array.isArray(value.orders) || value.orders.length !== 3) return false;
    return value.orders.every((entry, index) => entry?.order === index + 1 && finiteSamples(entry.data) &&
        finiteSamples(entry.referenceData) && entry.referenceData.length === entry.data.length &&
        (entry.order === 1 || (finiteSamples(entry.harmonicReferenceData) && entry.harmonicReferenceData.length === entry.data.length)) &&
        Number.isSafeInteger(entry.onsetIndex) && entry.onsetIndex >= 0 && entry.onsetIndex < entry.data.length &&
        Number.isFinite(entry.validMinFrequency) && entry.validMinFrequency >= excitation.startFrequency &&
        Number.isFinite(entry.validMaxFrequency) && entry.validMaxFrequency > 0 &&
        entry.validMaxFrequency * entry.order <= excitation.endFrequency * (1 + 1e-12));
}

function assertRecord(record) {
    if (!(record?.data instanceof Float32Array) || record.data.length < 2 || !record.data.every(Number.isFinite) ||
        !Number.isFinite(record.sampleRate) || record.sampleRate <= 0 ||
        !Number.isSafeInteger(record.onsetIndex) || record.onsetIndex < 0 || record.onsetIndex >= record.data.length) {
        throw new TypeError('Invalid impulse response');
    }
}

function finiteSetting(settings, key, fallback, minimum = 0) {
    const value = settings[key] ?? fallback;
    if (!Number.isFinite(value) || value < minimum) throw new RangeError(`Invalid ${key}`);
    return value;
}

function windowWeight(index, length, shape, riseSamples) {
    if (shape === 'rectangular') return 1;
    if (shape === 'hann') return 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (length - 1));
    if (shape !== 'tukey') throw new RangeError('Invalid window');
    const rise = Math.min(riseSamples, Math.floor((length - 1) / 2));
    const fall = Math.max(1, Math.floor(length * 0.1));
    if (rise > 0 && index < rise) return 0.5 - 0.5 * Math.cos(Math.PI * index / rise);
    if (index >= length - fall) return 0.5 - 0.5 * Math.cos(Math.PI * (length - 1 - index) / fall);
    return 1;
}

function spectrum(data, start, end, shape, riseSamples, scale = 1) {
    const length = end - start;
    if (length < 2 || length > MAX_SAMPLES) throw new RangeError('Invalid analysis window');
    const size = 2 ** Math.ceil(Math.log2(length));
    const real = new Float64Array(size);
    const imaginary = new Float64Array(size);
    for (let i = 0; i < length; i++) real[i] = data[start + i] * windowWeight(i, length, shape, riseSamples) / scale;
    new FFT(size).transform(real, imaginary, real, imaginary);
    const magnitudes = new Float64Array(size / 2 + 1);
    for (let i = 0; i < magnitudes.length; i++) magnitudes[i] = Math.hypot(real[i], imaginary[i]);
    return { magnitudes, real, imaginary, size, length };
}

function complexAt(result, frequency, sampleRate) {
    const position = frequency * result.size / sampleRate;
    const index = Math.floor(position);
    if (index < 0 || index >= result.size / 2) return null;
    const t = position - index;
    return [result.real[index] * (1 - t) + result.real[index + 1] * t,
        result.imaginary[index] * (1 - t) + result.imaginary[index + 1] * t];
}

function referencedMagnitude(measured, reference, frequency, sampleRate) {
    const numerator = complexAt(measured, frequency, sampleRate);
    const denominator = complexAt(reference, frequency, sampleRate);
    if (!numerator || !denominator) return null;
    const referenceMagnitude = Math.hypot(...denominator);
    if (!(referenceMagnitude > 1e-8)) return null;
    return Math.hypot(...numerator) / referenceMagnitude;
}

function magnitudeAt(spectrumResult, frequency, sampleRate) {
    const index = frequency * spectrumResult.size / sampleRate;
    const left = Math.floor(index);
    if (left < 0 || left >= spectrumResult.magnitudes.length - 1) return null;
    const t = index - left;
    return spectrumResult.magnitudes[left] * (1 - t) + spectrumResult.magnitudes[left + 1] * t;
}

function frequencyGrid(sampleRate, settings, resolution) {
    const lo = Math.max(resolution, finiteSetting(settings, 'minFrequency', 20, Number.MIN_VALUE));
    const hi = Math.min(sampleRate / 2 * 0.999, finiteSetting(settings, 'maxFrequency', 20000, Number.MIN_VALUE));
    if (hi <= lo) return [];
    return Array.from({ length: 512 }, (_, i) => lo * (hi / lo) ** (i / 511));
}

function smoothLevels(frequencies, values, smoothing) {
    if (!(smoothing > 0) || values.some(value => value === null)) return values;
    return smoothFrequencyResponse(frequencies.map((f, i) => [f, values[i]]), smoothing).map(point => point[1]);
}

export function analyzeImpulseResponse(record, settings = {}) {
    assertRecord(record);
    const { data, sampleRate, onsetIndex } = record;
    const before = finiteSetting(settings, 'beforeSeconds', onsetIndex / sampleRate);
    const after = finiteSetting(settings, 'afterSeconds', (data.length - onsetIndex) / sampleRate);
    const startIndex = Math.max(0, onsetIndex - Math.round(before * sampleRate));
    const endIndex = Math.min(data.length, onsetIndex + Math.ceil(after * sampleRate));
    const result = spectrum(data, startIndex, endIndex, settings.window || 'tukey', onsetIndex - startIndex,
        Number.isFinite(record.refScale) && record.refScale > 0 ? record.refScale : 1);
    const resolutionHz = sampleRate / result.length;
    const frequencies = frequencyGrid(sampleRate, settings, resolutionHz);
    const levels = frequencies.map(f => 20 * Math.log10(Math.max(1e-15, magnitudeAt(result, f, sampleRate))));
    const smoothed = smoothLevels(frequencies, levels, finiteSetting(settings, 'smoothing', 0));
    return {
        frequencyResponse: frequencies.map((f, i) => [f, smoothed[i]]), resolutionHz,
        window: { startIndex, endIndex },
        windowStartSeconds: (startIndex - onsetIndex) / sampleRate,
        windowEndSeconds: (endIndex - onsetIndex) / sampleRate
    };
}

export function analyzeDistortion(payload, settings = {}) {
    if (!validateHarmonicAnalysis(payload) || !payload.quality.valid) throw new TypeError('Distortion unavailable');
    const maxOrder = settings.maxOrder ?? 3;
    if (maxOrder !== 2 && maxOrder !== 3) throw new RangeError('Invalid maximum order');
    // The THD ceiling does not remove independently displayed harmonic orders.
    const entries = payload.orders;
    const sampleRate = payload.sampleRate;
    const available = entries.filter(entry => entry.validMaxFrequency > entry.validMinFrequency);
    const availableBefore = Math.min(...available.map(entry => entry.onsetIndex / sampleRate));
    const availableAfter = Math.min(...available.map(entry => (entry.data.length - entry.onsetIndex) / sampleRate));
    const before = finiteSetting(settings, 'beforeSeconds', availableBefore);
    const after = finiteSetting(settings, 'afterSeconds', availableAfter);
    if (before > availableBefore + 1 / sampleRate || after > availableAfter + 1 / sampleRate) {
        throw new RangeError('Window exceeds separated harmonic responses');
    }
    const analyze = (entry, data) => spectrum(data,
        Math.max(0, entry.onsetIndex - Math.round(before * sampleRate)),
        Math.min(entry.data.length, entry.onsetIndex + Math.ceil(after * sampleRate)),
        settings.window || 'tukey', Math.round(before * sampleRate));
    const spectra = entries.map(entry => entry.validMaxFrequency <= entry.validMinFrequency ? null
        : analyze(entry, entry.order === 1 ? entry.data
            : Float32Array.from(entry.data, (value, i) => value - entry.referenceData[i])));
    const references = entries.map(entry => entry.validMaxFrequency <= entry.validMinFrequency ? null
        : analyze(entry, entry.order === 1 ? entry.referenceData : entry.harmonicReferenceData));
    const resolutionHz = sampleRate / spectra[0].length;
    const frequencies = frequencyGrid(sampleRate, settings, resolutionHz);
    const fundamentals = frequencies.map(f => referencedMagnitude(spectra[0], references[0], f, sampleRate));
    const peak = Math.max(...fundamentals.filter(Number.isFinite));
    const series = entries.slice(1).map((entry, offset) => ({
        order: entry.order,
        ratios: frequencies.map((f, i) => {
            // A window cannot resolve a tone from an excitation edge closer than
            // its frequency resolution. Apply the margin at each observed frequency.
            if (f < entry.validMinFrequency || f > entry.validMaxFrequency - resolutionHz / entry.order ||
                f < entries[0].validMinFrequency + resolutionHz || f > entries[0].validMaxFrequency - resolutionHz ||
                !(fundamentals[i] > Math.max(1e-9, peak * 1e-4))) return null;
            const amplitude = referencedMagnitude(spectra[offset + 1], references[offset + 1], f * entry.order, sampleRate);
            return Number.isFinite(amplitude) ? amplitude / fundamentals[i] : null;
        })
    }));
    const included = series.filter(entry => entry.order <= maxOrder);
    const thd = frequencies.map((_, i) => included.some(entry => entry.ratios[i] === null)
        ? null : Math.hypot(...included.map(entry => entry.ratios[i])));
    return { frequencies, series, thd, maxOrder, resolutionHz,
        availableBeforeSeconds: availableBefore, availableAfterSeconds: availableAfter };
}

export function analyzeWaterfall(record, settings = {}) {
    assertRecord(record);
    const { data, sampleRate, onsetIndex } = record;
    const availableStart = -onsetIndex / sampleRate;
    const availableEnd = (data.length - onsetIndex) / sampleRate;
    const start = finiteSetting(settings, 'startSeconds', 0, availableStart);
    const end = finiteSetting(settings, 'endSeconds', availableEnd, availableStart);
    const windowSeconds = finiteSetting(settings, 'windowSeconds', Math.min(0.1, availableEnd - start), 2 / sampleRate);
    const rise = finiteSetting(settings, 'riseSeconds', Math.min(0.005, windowSeconds / 4));
    const length = Math.round(windowSeconds * sampleRate);
    const first = Math.max(0, onsetIndex + Math.round((start - rise) * sampleRate));
    const last = Math.min(data.length - length, onsetIndex + Math.floor((end - rise) * sampleRate));
    if (end <= start || first > last || start < availableStart || end > availableEnd + 1 / sampleRate) {
        throw new RangeError('No complete observed waterfall window');
    }
    const count = Math.min(64, Math.floor(finiteSetting(settings, 'maxSlices', 40, 1)), last - first + 1);
    const resolutionHz = sampleRate / length;
    const frequencies = frequencyGrid(sampleRate, settings, resolutionHz);
    const scale = Number.isFinite(record.refScale) && record.refScale > 0 ? record.refScale : 1;
    const smoothing = finiteSetting(settings, 'smoothing', 0);
    const slices = Array.from({ length: count }, (_, i) => {
        const offset = first + Math.round((last - first) * i / Math.max(1, count - 1));
        const result = spectrum(data, offset, offset + length, settings.window || 'tukey', Math.round(rise * sampleRate), scale);
        const values = frequencies.map(f => 20 * Math.log10(Math.max(1e-15, magnitudeAt(result, f, sampleRate))));
        return { time: (offset - onsetIndex) / sampleRate + rise, levels: smoothLevels(frequencies, values, smoothing) };
    });
    return { frequencies, slices, resolutionHz, referenceDb: 0, windowSeconds: length / sampleRate };
}

// ARTA section 6.5 / REW Burst Decay: convolve the IR with a unit-peak
// complex Morlet burst. Fixed one-third-octave half-power bandwidth.
const BURST_BANDWIDTH = 1 / 3;
const BURST_TAU_CYCLES = Math.sqrt(2 * Math.log(2)) /
    (Math.PI * (2 ** (BURST_BANDWIDTH / 2) - 2 ** (-BURST_BANDWIDTH / 2)));
const BURST_SAMPLE_BUDGET = 256_000_000;

function burstSupport(record, frequency, time) {
    const tau = BURST_TAU_CYCLES * record.sampleRate / frequency;
    const center = record.onsetIndex + time * record.sampleRate;
    // Preserve observed pre-onset samples; the finite causal estimate is zero
    // before the stored start. Never assume the unobserved late tail is zero.
    // At four tau the Gaussian amplitude is exp(-16), about -139 dB.
    if (center + 4 * tau > record.data.length - 1) return null;
    return { tau, center, first: Math.max(0, Math.ceil(center - 4 * tau)), last: Math.floor(center + 4 * tau) };
}

function burstMagnitude(data, support, frequency, sampleRate) {
    const { first, last, center, tau } = support;
    const inverseTauSquared = 1 / (tau * tau);
    const distance = first - center;
    let weight = Math.exp(-distance * distance * inverseTauSquared);
    let step = Math.exp(-(2 * distance + 1) * inverseTauSquared);
    const stepChange = Math.exp(-2 * inverseTauSquared);
    const angle = 2 * Math.PI * frequency / sampleRate;
    const rotateReal = Math.cos(angle), rotateImaginary = Math.sin(angle);
    let oscillatorReal = 1, oscillatorImaginary = 0, real = 0, imaginary = 0;
    // The omitted starting phase is common to the complex sum and cannot
    // change its magnitude. Recurrences avoid trig/exp calls per sample.
    for (let i = first; i <= last; i++) {
        const weighted = data[i] * weight;
        real += weighted * oscillatorReal;
        imaginary += weighted * oscillatorImaginary;
        const nextReal = oscillatorReal * rotateReal - oscillatorImaginary * rotateImaginary;
        oscillatorImaginary = oscillatorReal * rotateImaginary + oscillatorImaginary * rotateReal;
        oscillatorReal = nextReal;
        weight *= step;
        step *= stepChange;
    }
    return Math.hypot(real, imaginary);
}

export function analyzeBurstDecay(record, settings = {}) {
    assertRecord(record);
    const depthUnit = settings.depthUnit ?? 'cycles';
    if (depthUnit !== 'cycles' && depthUnit !== 'seconds') throw new RangeError('Invalid burst depth unit');
    const availableEnd = (record.data.length - 1 - record.onsetIndex) / record.sampleRate;
    const start = finiteSetting(settings, depthUnit === 'cycles' ? 'startCycles' : 'startSeconds', 0);
    const end = finiteSetting(settings, depthUnit === 'cycles' ? 'endCycles' : 'endSeconds',
        depthUnit === 'cycles' ? 30 : Math.min(0.1, availableEnd));
    const low = finiteSetting(settings, 'minFrequency', 20, 10);
    // Keep the upper half-power edge of the tone burst below Nyquist.
    const high = Math.min(finiteSetting(settings, 'maxFrequency', 20000, 10),
        record.sampleRate / 2 / 2 ** (BURST_BANDWIDTH / 2));
    if (end <= start || high <= low) throw new RangeError('Invalid burst analysis range');
    const frequencyCount = 96;
    const frequencies = Array.from({ length: frequencyCount }, (_, i) => low * (high / low) ** (i / (frequencyCount - 1)));
    let sliceCount = Math.min(64, Math.floor(finiteSetting(settings, 'maxSlices', 48, 2)));
    const minimumSlices = Math.min(16, sliceCount);
    let depths, work;
    // Preserve frequency density so ordinary resonances remain visible even at
    // high sample rates. Bound work by reducing temporal mesh density only;
    // neither Gaussian support nor the measured response is shortened.
    do {
        depths = Array.from({ length: sliceCount }, (_, i) => start + (end - start) * i / (sliceCount - 1));
        work = 0;
        for (const depth of depths) for (const frequency of frequencies) {
            const support = burstSupport(record, frequency, depthUnit === 'cycles' ? depth / frequency : depth);
            if (support) work += support.last - support.first + 1;
        }
        if (work <= BURST_SAMPLE_BUDGET) break;
        if (sliceCount > minimumSlices) sliceCount = Math.max(minimumSlices, Math.floor(sliceCount / 2));
        else throw new RangeError('Burst analysis exceeds supported size');
    } while (true);
    const scale = Number.isFinite(record.refScale) && record.refScale > 0 ? record.refScale : 1;
    let valid = false;
    const slices = depths.map(depth => ({ depth, levels: frequencies.map(frequency => {
        const support = burstSupport(record, frequency, depthUnit === 'cycles' ? depth / frequency : depth);
        if (!support) return null;
        const magnitude = burstMagnitude(record.data, support, frequency, record.sampleRate) / scale;
        if (!Number.isFinite(magnitude)) return null;
        valid = true;
        return 20 * Math.log10(Math.max(1e-15, magnitude));
    }) }));
    if (!valid) throw new RangeError('No observed burst response');
    return { mode: 'burst', depthUnit, frequencies, slices, referenceDb: 0,
        bandwidthOctaves: BURST_BANDWIDTH, evaluatedSamples: work };
}
