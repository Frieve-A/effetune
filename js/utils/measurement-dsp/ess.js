import FFT from './fft.js';
import { analyzeImpulseResponse } from './analysis.js';
import { applyInterfaceCalibration } from './interface-calibration.js';

const MAX_FFT = 2 ** 23;

function sweepEnvelope(index, length, fadeSamples) {
    if (index < fadeSamples) return 0.5 - 0.5 * Math.cos(Math.PI * index / fadeSamples);
    if (index >= length - fadeSamples) return 0.5 - 0.5 * Math.cos(Math.PI * (length - 1 - index) / fadeSamples);
    return 1;
}

function sweepPhase(index, sweep) {
    return 2 * Math.PI * sweep.startFrequency * sweep.sweepConstant *
        Math.expm1(index / (sweep.sampleRate * sweep.sweepConstant));
}

function referenceWindow(response, sweep, entry) {
    const start = sweep.length - 1 - Math.round(sweep.sweepConstant * Math.log(entry.order) * sweep.sampleRate) - entry.onsetIndex;
    const data = new Float32Array(entry.data.length);
    if (start >= 0 && start < response.length) data.set(response.subarray(start, start + data.length));
    return data;
}

function removeFiniteReference(measured, reference, onsetIndex, riseSamples) {
    const size = 2 ** Math.ceil(Math.log2(measured.length));
    // Match the finite separation edges before division. A hard crop turns
    // small boundary differences into inverse-filter ringing.
    const a = transform(measured, size, riseSamples);
    const b = transform(reference, size, riseSamples);
    let referencePower = 0;
    for (let i = 0; i < size; i++) referencePower = Math.max(referencePower, b.real[i] ** 2 + b.imag[i] ** 2);
    // Regularize only the inverse of the excitation, not the measured harmonic amplitudes.
    const floor = referencePower * 1e-12;
    if (!(floor > 0)) throw new RangeError('Empty ESS reference');
    for (let i = 0; i < size; i++) {
        const denominator = b.real[i] ** 2 + b.imag[i] ** 2 + floor;
        const real = (a.real[i] * b.real[i] + a.imag[i] * b.imag[i]) / denominator;
        a.imag[i] = (a.imag[i] * b.real[i] - a.real[i] * b.imag[i]) / denominator;
        a.real[i] = real;
    }
    new FFT(size).inverseTransform(a.real, a.imag, a.real, a.imag);
    return Float32Array.from({ length: measured.length }, (_, i) => a.real[(i - onsetIndex + size) % size]);
}

function transform(samples, size, riseSamples = 0) {
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    real.set(samples);
    for (let i = 0; i < riseSamples; i++) real[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / riseSamples);
    new FFT(size).transform(real, imag, real, imag);
    return { real, imag };
}

export function convolveLinear(signal, filter) {
    const length = signal.length + filter.length - 1;
    const size = 2 ** Math.ceil(Math.log2(length));
    if (size > MAX_FFT) throw new RangeError('ESS analysis exceeds supported capture length');
    const a = transform(signal, size);
    const b = transform(filter, size);
    for (let i = 0; i < size; i++) {
        const real = a.real[i] * b.real[i] - a.imag[i] * b.imag[i];
        a.imag[i] = a.real[i] * b.imag[i] + a.imag[i] * b.real[i];
        a.real[i] = real;
    }
    new FFT(size).inverseTransform(a.real, a.imag, a.real, a.imag);
    return Float32Array.from(a.real.subarray(0, length));
}

export function createEssSignal({ length = 131072, sampleRate = 48000, startFrequency = 20, endFrequency = 20000 } = {}) {
    if (!Number.isSafeInteger(length) || length < 1024 || length > 2 ** 20 ||
        !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000 ||
        !Number.isFinite(startFrequency) || !Number.isFinite(endFrequency) ||
        startFrequency <= 0 || endFrequency <= startFrequency || endFrequency >= sampleRate / 2) {
        throw new RangeError('Invalid ESS excitation');
    }
    // At least 100 ms between H3 and H2 leaves a useful, adjustable separation window.
    const minimumLength = Math.ceil(0.1 * Math.log(endFrequency / startFrequency) / Math.log(1.5) * sampleRate);
    length = Math.max(length, minimumLength);
    if (length > 2 ** 20) throw new RangeError('ESS duration exceeds supported length');
    const durationSeconds = length / sampleRate;
    const sweepConstant = durationSeconds / Math.log(endFrequency / startFrequency);
    const signal = new Float32Array(length);
    const inverseFilter = new Float32Array(length);
    const fadeSamples = Math.min(Math.round(0.005 * sampleRate), Math.floor(length / 100));
    for (let i = 0; i < length; i++) {
        signal[i] = Math.sin(sweepPhase(i, { sampleRate, startFrequency, sweepConstant })) *
            sweepEnvelope(i, length, fadeSamples);
    }
    for (let i = 0; i < length; i++) inverseFilter[i] = signal[length - 1 - i] * Math.exp(-i / (sampleRate * sweepConstant));
    // Stationary-phase normalization gives unit transfer gain, independent of sweep duration and band.
    const scale = 4 * endFrequency / (sampleRate * sampleRate * sweepConstant);
    for (let i = 0; i < length; i++) inverseFilter[i] *= scale;
    return {
        method: 'ess', signal, inverseFilter, length, sampleRate, sweepConstant,
        startFrequency, endFrequency, durationSeconds, fadeSamples,
        tailSamples: Math.ceil(2.5 * sampleRate), maxOrder: 10
    };
}

export function createEssCapturePlan(sweep, repetitions) {
    if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 16) throw new RangeError('Invalid ESS repetitions');
    return { repeatCount: repetitions, intervalSamples: sweep.length + sweep.tailSamples,
        playbackSamples: repetitions * (sweep.length + sweep.tailSamples) };
}

function peakIndex(data, start, end) {
    let position = start;
    for (let i = start + 1; i < end; i++) if (Math.abs(data[i]) > Math.abs(data[position])) position = i;
    return position;
}

export function analyzeEssRecording(recording, sweep, {
    repetitions = 1, playbackOffsetSamples = Math.round(sweep.sampleRate * 0.55),
    outputTimeReference = 'unknown', levelDb = 0, overloaded = false, calibration = null
} = {}) {
    if (!(recording instanceof Float32Array) || !recording.every(Number.isFinite) || !Number.isFinite(levelDb) ||
        !Number.isSafeInteger(playbackOffsetSamples) || playbackOffsetSamples < 0) throw new TypeError('Invalid ESS capture');
    const sampleRate = sweep.sampleRate;
    const plan = createEssCapturePlan(sweep, repetitions);
    const reasons = new Set();
    if (overloaded || recording.some(sample => Math.abs(sample) >= 0.999)) reasons.add('clipping');
    const referenceGain = 10 ** (levelDb / 20);
    if (!Number.isFinite(referenceGain) || referenceGain <= 0) throw new RangeError('Invalid ESS reference gain');
    const pre = Math.round(Math.min(0.025, sweep.sweepConstant * Math.log(4 / 3) / 3) * sampleRate);
    const harmonicGap = Math.round(sweep.sweepConstant * Math.log(2) * sampleRate);
    const validMinFrequency = sweep.startFrequency * Math.exp(sweep.fadeSamples / (sampleRate * sweep.sweepConstant));
    const validMaxFrequency = sweep.endFrequency * Math.exp(-sweep.fadeSamples / (sampleRate * sweep.sweepConstant));
    // H1 and H2 share a boundary halfway between their centers. Keep the stable
    // strongest-peak time reference while retaining earlier linear arrivals.
    const linearPre = validMaxFrequency / 2 > validMinFrequency ? Math.floor(harmonicGap / 2) : pre;
    const orders = Array.from({ length: sweep.maxOrder }, (_, index) => index + 1).map(order => {
        // Higher orders keep their short windows so the existing sweep duration
        // still supports a 20 ms analysis window through H10.
        const orderPre = order === 1 ? linearPre : order <= 3 ? pre : Math.round(0.002 * sampleRate);
        let post = order === 1 ? Math.round(1.5 * sampleRate)
            : Math.floor(sweep.sweepConstant * Math.log(order / (order - 1)) * sampleRate) - orderPre * 2;
        if (order === 2) post = Math.min(post, harmonicGap - linearPre);
        // Only the constant-amplitude excitation interval supports harmonic ratios.
        const orderMaxFrequency = validMaxFrequency / order;
        const supported = order === 1 || orderMaxFrequency > validMinFrequency;
        return { order, data: new Float32Array(supported ? orderPre + post : 2), onsetIndex: supported ? orderPre : 0,
            validMinFrequency, validMaxFrequency: orderMaxFrequency };
    });
    if (orders[1].validMaxFrequency <= orders[1].validMinFrequency) reasons.add('insufficient-harmonic-band');
    let firstPeak = null;
    let firstResponse = null;
    let latency = null;
    for (let repeat = 0; repeat < repetitions; repeat++) {
        const offset = playbackOffsetSamples + repeat * plan.intervalSamples;
        if (offset + sweep.length + Math.round(2 * sampleRate) > recording.length) {
            throw new RangeError('Incomplete ESS capture');
        }
        const capture = recording.subarray(offset, Math.min(recording.length, offset + plan.intervalSamples));
        const response = convolveLinear(capture, sweep.inverseFilter);
        const referenceIndex = sweep.length - 1;
        const peak = peakIndex(response, referenceIndex, referenceIndex + Math.round(sampleRate));
        if (!(Math.abs(response[peak]) > 1e-8)) throw new RangeError('No usable ESS response');
        // Compare repeated sweeps over the same band. Within one sweep, frequency-dependent
        // group delay cannot be distinguished from clock mismatch without a known path.
        if (firstPeak === null) {
            firstPeak = peak;
            firstResponse = response;
            latency = peak - referenceIndex;
        } else if (Math.abs(peak - firstPeak) > 2) reasons.add('clock-drift');
        for (const entry of orders) {
            if (entry.order > 1 && entry.validMaxFrequency <= entry.validMinFrequency) continue;
            const center = peak - Math.round(sweep.sweepConstant * Math.log(entry.order) * sampleRate);
            const start = center - entry.onsetIndex;
            if (start < 0 || start + entry.data.length > response.length) throw new RangeError('Incomplete ESS separation');
            for (let i = 0; i < entry.data.length; i++) {
                const value = response[start + i] / referenceGain;
                if (!Number.isFinite(value)) throw new RangeError('Non-finite ESS response');
                entry.data[i] += value / repetitions;
            }
        }
    }
    // Repetitions must agree after alignment: missing blocks and unstable paths invalidate harmonic ratios.
    if (repetitions > 1) {
        const linear = orders[0];
        let difference = 0;
        let energy = 0;
        for (let i = 0; i < linear.data.length; i++) {
            const value = firstResponse[firstPeak - linear.onsetIndex + i] / referenceGain;
            difference += (value - linear.data[i]) ** 2;
            energy += value * value;
        }
        if (difference > energy * 0.01) reasons.add('inconsistent-capture');
    }
    const linear = orders[0];
    let linearEnergy = 0;
    let unresolvedTail = 0;
    const supportedHarmonics = orders.slice(1).filter(entry => entry.validMaxFrequency > entry.validMinFrequency);
    const separationBefore = supportedHarmonics.length
        ? Math.min(...supportedHarmonics.map(entry => entry.onsetIndex)) : linear.onsetIndex;
    const separationAfter = supportedHarmonics.length
        ? Math.min(...supportedHarmonics.map(entry => entry.data.length - entry.onsetIndex)) : linear.data.length - linear.onsetIndex;
    for (let i = 0; i < linear.data.length; i++) {
        linearEnergy += linear.data[i] ** 2;
        const time = i - linear.onsetIndex;
        if (time < -separationBefore || time >= separationAfter) unresolvedTail += linear.data[i] ** 2;
    }
    if (unresolvedTail > linearEnergy * 0.01) reasons.add('overlapping-tail');
    const finiteReference = convolveLinear(sweep.signal, sweep.inverseFilter);
    linear.referenceData = referenceWindow(finiteReference, sweep, linear);
    const correctedLinear = removeFiniteReference(linear.data, linear.referenceData, linear.onsetIndex, pre);
    // Predict the finite fundamental response through the recovered linear path before
    // cutting any harmonic windows. This preserves convolution across window edges.
    const predictedFundamental = convolveLinear(finiteReference, correctedLinear);
    for (const entry of orders.slice(1)) {
        entry.referenceData = referenceWindow(predictedFundamental.subarray(linear.onsetIndex), sweep, entry);
        if (entry.validMaxFrequency <= entry.validMinFrequency) {
            entry.harmonicReferenceData = new Float32Array(entry.data.length);
            continue;
        }
        // Unit harmonic references include the actual fade envelope and phase. A
        // short analysis window therefore cannot change a known harmonic's gain.
        const harmonicSignal = Float32Array.from(sweep.signal, (_, i) => {
            const phase = sweepPhase(i, sweep);
            const harmonic = entry.order === 2 ? -Math.cos(2 * phase)
                : entry.order === 3 ? -Math.sin(3 * phase)
                    : Math.sin(entry.order * phase + (1 - entry.order) * Math.PI / 2);
            return harmonic * sweepEnvelope(i, sweep.length, sweep.fadeSamples) ** entry.order;
        });
        entry.harmonicReferenceData = referenceWindow(convolveLinear(harmonicSignal, sweep.inverseFilter), sweep, entry);
    }
    let peakAmplitude = 0;
    for (const sample of correctedLinear) peakAmplitude = Math.max(peakAmplitude, Math.abs(sample));
    const harmonicAnalysis = {
        version: 2, method: 'ess', sampleRate, reference: 'unit-input', calibration: 'uncorrected-system',
        excitation: { startFrequency: sweep.startFrequency, endFrequency: sweep.endFrequency,
            durationSeconds: sweep.durationSeconds, levelDb, sweepSamples: sweep.length },
        quality: { valid: reasons.size === 0, reasons: [...reasons] }, orders
    };
    const result = { data: correctedLinear, sampleRate, onsetIndex: linearPre, prerollSamples: linearPre,
        trimStartSamples: outputTimeReference === 'audio-context' ? latency - linearPre : null,
        outputTimeReference, refScale: 1, peakDb: 20 * Math.log10(peakAmplitude), irValid: true,
        acquisitionMethod: 'ess', harmonicAnalysis };
    if (calibration) Object.assign(result, applyInterfaceCalibration(result, calibration, {
        sampleRate, minFrequency: sweep.startFrequency, maxFrequency: sweep.endFrequency,
        outputLength: result.data.length, prerollSamples: linearPre
    }));
    result.frequencyResponse = analyzeImpulseResponse(result, {
        minFrequency: linear.validMinFrequency, maxFrequency: linear.validMaxFrequency, window: 'tukey',
        riseSeconds: Math.min(0.025, result.onsetIndex / sampleRate), smoothing: 0.005
    }).frequencyResponse;
    return result;
}
