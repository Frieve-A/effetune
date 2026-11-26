import FFT from './fft.js';
import { analyzeImpulseResponse } from './analysis.js';
import { applyInterfaceCalibration } from './interface-calibration.js';
import { MIN_KEPT_SHARE } from './recording-gaps.js';
import { MAX_CLOCK_OFFSET, clockRatio, correctClock } from './clock-drift.js';
import { resampleWindowedSinc } from './resample.js';

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

// At least 100 ms between H3 and H2 leaves a useful, adjustable separation window.
const essMinimumLength = (sampleRate, startFrequency, endFrequency) =>
    Math.ceil(0.1 * Math.log(endFrequency / startFrequency) / Math.log(1.5) * sampleRate);
const essTailSamples = sampleRate => Math.ceil(2.5 * sampleRate);

/** Seconds one sweep of createEssSignal with these options plays, its decay tail included. */
export function essPlaybackSeconds({ length, sampleRate, startFrequency, endFrequency }) {
    const minimumLength = essMinimumLength(sampleRate, startFrequency, endFrequency);
    return ((length > minimumLength ? length : minimumLength) + essTailSamples(sampleRate)) / sampleRate;
}

export function createEssSignal({ length = 131072, sampleRate = 48000, startFrequency = 20, endFrequency = 20000 } = {}) {
    if (!Number.isSafeInteger(length) || length < 1024 || length > 2 ** 20 ||
        !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000 ||
        !Number.isFinite(startFrequency) || !Number.isFinite(endFrequency) ||
        startFrequency <= 0 || endFrequency <= startFrequency || endFrequency >= sampleRate / 2) {
        throw new RangeError('Invalid ESS excitation');
    }
    length = Math.max(length, essMinimumLength(sampleRate, startFrequency, endFrequency));
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
        tailSamples: essTailSamples(sampleRate), maxOrder: 10
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

const PEAK_OVERSAMPLING = 32;

function peakCorrelation({ response, peak }) {
    // The peak height must be independent of whether the arrival falls between samples.
    const radius = 96;
    const oversampling = PEAK_OVERSAMPLING;
    const fine = resampleWindowedSinc(response.subarray(peak - radius, peak + radius + 1), 1, oversampling);
    return Math.abs(fine[peakIndex(fine, (radius - 1) * oversampling, (radius + 1) * oversampling + 1)]);
}

// Delay (samples, below one) of response b behind response a, each read from its integer peak: the slope
// of their cross-spectrum phase weighted by its magnitude. Up to a quarter of the sample rate the phase
// of a sub-sample delay cannot wrap.
function fractionalDelay(a, peakA, b, peakB, sampleRate, minFrequency, maxFrequency) {
    const size = 2 ** Math.ceil(Math.log2(0.1 * sampleRate));
    const lead = size >> 2;
    const A = transform(a.subarray(peakA - lead, peakA - lead + size), size);
    const B = transform(b.subarray(peakB - lead, peakB - lead + size), size);
    const last = Math.min(size >> 2, Math.floor(maxFrequency * size / sampleRate));
    let numerator = 0;
    let denominator = 0;
    for (let k = Math.ceil(minFrequency * size / sampleRate); k <= last; k++) {
        const real = B.real[k] * A.real[k] + B.imag[k] * A.imag[k];
        const imag = B.imag[k] * A.real[k] - B.real[k] * A.imag[k];
        const weight = Math.sqrt(real * real + imag * imag);
        const omega = 2 * Math.PI * k / size;
        numerator += weight * omega * Math.atan2(imag, real);
        denominator += weight * omega * omega;
    }
    return denominator > 0 ? -numerator / denominator : 0;
}

// A repetition whose capture lost or inserted samples, or was disturbed by noise, differs from the
// others far more than their noise does. Repetitions are compared in pairs and bands: a pair's residual
// in a band is half their difference (each one's deviation from the pair's mean) relative to the
// repetition's own energy there. A band's limit is CONSISTENT_RESIDUAL; with three or more repetitions
// it is raised to OUTLIER_FACTOR times the band's closest pair, which shows this measurement's own
// noise. A repetition is kept when at least half of the others stay within the limit in every band,
// so repetitions disturbed alike cannot vouch for each other. Three or more repetitions are compared
// in octave bands, where a slip shows in the octaves it moved. Two repetitions give no noise estimate,
// so they are compared over the whole valid band as one band.
const OUTLIER_FACTOR = 10;
const CONSISTENT_RESIDUAL = 0.01;

function consistentRepetitions(windows, sampleRate, minFrequency, maxFrequency) {
    const count = windows.length;
    if (count < 2) return { kept: [0], excess: [0] };
    const size = 2 ** Math.ceil(Math.log2(windows[0].length));
    const spectra = windows.map(window => transform(window, size));
    const bands = [];
    const step = count > 2 ? 2 : Infinity;
    for (let low = minFrequency; low < maxFrequency; low *= step) {
        bands.push([Math.ceil(low * size / sampleRate), Math.ceil(Math.min(step * low, maxFrequency) * size / sampleRate)]);
    }
    const bandSums = term => bands.map(([from, to]) => {
        let sum = 0;
        for (let k = from; k < to; k++) sum += term(k);
        return sum;
    });
    const energy = spectra.map(({ real, imag }) => bandSums(k => real[k] ** 2 + imag[k] ** 2));
    // relative[r][s][b]: the pair's difference in band b relative to repetition r's energy there.
    const relative = spectra.map(() => new Array(count).fill(null));
    for (let r = 0; r < count; r++) {
        for (let s = r + 1; s < count; s++) {
            const a = spectra[r], b = spectra[s];
            const difference = bandSums(k => ((a.real[k] - b.real[k]) ** 2 + (a.imag[k] - b.imag[k]) ** 2) / 4);
            relative[r][s] = difference.map((value, band) => (value > 0 ? value / energy[r][band] : 0));
            relative[s][r] = difference.map((value, band) => (value > 0 ? value / energy[s][band] : 0));
        }
    }
    const limits = bands.map((_, band) => Math.max(CONSISTENT_RESIDUAL, count > 2
        ? OUTLIER_FACTOR * Math.min(...relative.flatMap(row => row.flatMap(pair => (pair ? [pair[band]] : []))))
        : 0));
    // excess[r]: the largest band residual relative to the band's limit, against the closest half of the others.
    const half = Math.ceil((count - 1) / 2) - 1;
    const excess = relative.map(row => row.flatMap(pair =>
        (pair ? [Math.max(...pair.map((value, band) => value / limits[band]))] : [])).sort((x, y) => x - y)[half]);
    return { kept: excess.flatMap((value, r) => (value <= 1 ? [r] : [])), excess };
}

export function analyzeEssRecording(recording, sweep, {
    repetitions = 1, playbackOffsetSamples = Math.round(sweep.sampleRate * 0.55),
    outputTimeReference = 'unknown', levelDb = 0, overloaded = false, calibration = null,
    detectClipping = true, fixedLatencySamples
} = {}) {
    if (!(recording instanceof Float32Array) || !recording.every(Number.isFinite) || !Number.isFinite(levelDb) ||
        !Number.isSafeInteger(playbackOffsetSamples) || playbackOffsetSamples < 0 ||
        (fixedLatencySamples !== undefined && (!Number.isSafeInteger(fixedLatencySamples) || fixedLatencySamples < 0))) {
        throw new TypeError('Invalid ESS capture');
    }
    const sampleRate = sweep.sampleRate;
    const plan = createEssCapturePlan(sweep, repetitions);
    const reasons = new Set();
    // Offline floating-point pipelines can exceed full scale without an ADC clipping.
    if (overloaded || (detectClipping && recording.some(sample => Math.abs(sample) >= 0.999))) reasons.add('clipping');
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
    const referenceIndex = sweep.length - 1;
    // A known path latency replaces the peak search, so silent or noise-only captures stay aligned.
    const fixed = fixedLatencySamples !== undefined;
    const minimumTail = Math.round(2 * sampleRate);
    const lookBehindLimit = Math.max(0, sweep.tailSamples - minimumTail);
    const locate = (source, lookForEarlyArrivals = false) => {
        const found = [];
        for (let repeat = 0; repeat < repetitions; repeat++) {
            const elapsed = repeat * plan.intervalSamples;
            const offset = playbackOffsetSamples + elapsed;
            if (offset + sweep.length + minimumTail > source.length) {
                throw new RangeError('Incomplete ESS capture');
            }
            // A slow recording clock can place the next sweep before its nominal start.
            // Borrow only the end of the previous decay tail during the clock estimate.
            const lookBehind = lookForEarlyArrivals && repeat > 0
                ? Math.min(lookBehindLimit, Math.ceil((elapsed + sweep.length) * MAX_CLOCK_OFFSET)) : 0;
            const capture = source.subarray(offset - lookBehind, Math.min(source.length, offset + plan.intervalSamples));
            const response = convolveLinear(capture, sweep.inverseFilter);
            const nominalPeak = referenceIndex + lookBehind;
            const peak = fixed ? referenceIndex + fixedLatencySamples
                : peakIndex(response, referenceIndex, nominalPeak + Math.round(sampleRate));
            if (fixed || Math.abs(response[peak]) > 1e-8) {
                found.push({ response, peak, repeat, latency: peak - nominalPeak });
            }
        }
        return found;
    };
    const estimateClock = !fixed && repetitions > 1 && lookBehindLimit > 0;
    const clockCaptures = locate(recording, estimateClock);
    let captures;
    if (!fixed && clockCaptures.length > 1) {
        // The peak spacing of repeated sweeps gives the clock ratio; after resampling the
        // recording onto the playback clock, the sweeps and their harmonic windows line up again.
        const steps = clockCaptures.slice(1).map((capture, index) => {
            const previous = clockCaptures[index];
            const delay = capture.latency - previous.latency + fractionalDelay(previous.response, previous.peak,
                capture.response, capture.peak, sampleRate, validMinFrequency, validMaxFrequency);
            return delay / (capture.repeat - previous.repeat);
        });
        // With one measured spacing, an integer shift is also consistent with a sample slip.
        // Test the full spacing before dividing by any missing repetitions.
        const spacing = steps[0] * (clockCaptures[1].repeat - clockCaptures[0].repeat);
        const hasClockEvidence = steps.length > 1 || Math.abs(spacing - Math.round(spacing)) >= 2 / PEAK_OVERSAMPLING;
        const corrected = hasClockEvidence ? correctClock(recording, clockRatio(steps, plan.intervalSamples),
            playbackOffsetSamples, { wideband: sweep.endFrequency > 0.45 * sampleRate }) : null;
        if (corrected) {
            const aligned = locate(corrected);
            // A single spacing change could be a slip between the sweeps. Require stronger
            // correlation with the reference sweep after changing the time scale of the signal itself.
            const first = clockCaptures[0];
            const candidate = aligned[0];
            if (steps.length > 1 || (candidate?.repeat === first.repeat &&
                peakCorrelation(candidate) > peakCorrelation(first) * 1.0001)) {
                captures = aligned;
            }
        }
    }
    // Without clock correction, use the original isolated sweep windows for the measurement.
    captures ??= estimateClock ? locate(recording) : clockCaptures;
    if (!captures.length) throw new RangeError('No usable ESS response');
    const linear = orders[0];
    const { kept, excess } = consistentRepetitions(captures.map(({ response, peak }) => {
        const start = peak - linear.onsetIndex;
        if (start < 0 || start + linear.data.length > response.length) throw new RangeError('Incomplete ESS separation');
        return response.subarray(start, start + linear.data.length);
    }), sampleRate, validMinFrequency, validMaxFrequency);
    const recordingGaps = kept.length === repetitions ? null
        : kept.length < MIN_KEPT_SHARE * repetitions ? 'interrupted' : 'corrected';
    // When no repetition agrees with enough others, none is more trustworthy, so all of them are averaged.
    const used = kept.length ? kept.map(index => captures[index]) : captures;
    if (recordingGaps) {
        console.info('ESS repetitions kept: ' + kept.length + ' of ' + repetitions +
            ', difference from the closest half of the others over the limit, per aligned repetition: ' +
            excess.map(value => value.toFixed(2)).join(', '));
    }
    if (recordingGaps === 'interrupted') reasons.add('inconsistent-capture');
    const latencies = used.map(({ latency }) => latency);
    // Repeated sweeps that still disagree after the clock correction lost or inserted samples, or
    // drifted beyond a clock tolerance. Within one sweep, frequency-dependent group delay cannot be
    // distinguished from clock mismatch without a known path.
    if (Math.max(...latencies) - Math.min(...latencies) > 2) reasons.add('clock-drift');
    // Lost or inserted samples shift everything recorded after them, so the earliest kept repetition
    // is the least exposed one.
    const latency = latencies[0];
    for (const { response, peak } of used) {
        for (const entry of orders) {
            if (entry.order > 1 && entry.validMaxFrequency <= entry.validMinFrequency) continue;
            const center = peak - Math.round(sweep.sweepConstant * Math.log(entry.order) * sampleRate);
            const start = center - entry.onsetIndex;
            if (start < 0 || start + entry.data.length > response.length) throw new RangeError('Incomplete ESS separation');
            for (let i = 0; i < entry.data.length; i++) {
                const value = response[start + i] / referenceGain;
                if (!Number.isFinite(value)) throw new RangeError('Non-finite ESS response');
                entry.data[i] += value / used.length;
            }
        }
    }
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
        acquisitionMethod: 'ess', harmonicAnalysis, ...(recordingGaps ? { recordingGaps } : {}) };
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
