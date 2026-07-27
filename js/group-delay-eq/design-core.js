/**
 * Group Delay EQ filter design.
 *
 * Builds a finite-length all-pass FIR whose group delay follows per-band targets.
 * The magnitude response stays flat, so the filter changes only the excess phase
 * of the signal. Alternating projection between the length constraint and the
 * unit-magnitude constraint turns the ideal (infinitely long) all-pass into a
 * filter of the requested tap count.
 */
import FFT from '../utils/measurement-dsp/fft.js';

export const GROUP_DELAY_EQ_BANDS = Object.freeze([
    25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000
]);
export const GROUP_DELAY_EQ_TAPS_CHOICES = Object.freeze([4096, 8192, 16384, 32768]);

const DESIGN_ITERATIONS = 12;
const SPECTRUM_OVERSAMPLING = 2;
const GUARD_DIVISOR = 16;
const RESPONSE_POINTS = 128;
const RESPONSE_LOW_FREQUENCY = 20;
const RESPONSE_HIGH_FREQUENCY = 20000;
const MAGNITUDE_EPSILON = 1e-12;

/**
 * Fritsch-Carlson slopes; the shape-preserving choice keeps the interpolated
 * delay curve free of overshoot between slider positions.
 */
function monotoneSlopes(positions, values) {
    const count = positions.length;
    const slopes = new Float64Array(count);
    const secants = new Float64Array(count - 1);
    for (let index = 0; index < count - 1; index += 1) {
        secants[index] = (values[index + 1] - values[index]) / (positions[index + 1] - positions[index]);
    }
    slopes[0] = secants[0];
    slopes[count - 1] = secants[count - 2];
    for (let index = 1; index < count - 1; index += 1) {
        const previous = secants[index - 1];
        const next = secants[index];
        if (previous * next <= 0) continue;
        const leftWidth = positions[index] - positions[index - 1];
        const rightWidth = positions[index + 1] - positions[index];
        const leftWeight = 2 * rightWidth + leftWidth;
        const rightWeight = rightWidth + 2 * leftWidth;
        slopes[index] = (leftWeight + rightWeight) / (leftWeight / previous + rightWeight / next);
    }
    return slopes;
}

function clampDelays(delaysMs, taps, sampleRate) {
    const limitSamples = taps / 2 - taps / GUARD_DIVISOR;
    const limitMs = limitSamples * 1000 / sampleRate;
    const clampedMs = new Float64Array(GROUP_DELAY_EQ_BANDS.length);
    let clamped = false;
    for (let band = 0; band < clampedMs.length; band += 1) {
        const requested = Number(delaysMs?.[band]);
        const value = Number.isFinite(requested) ? requested : 0;
        const bounded = value > limitMs ? limitMs : value < -limitMs ? -limitMs : value;
        if (bounded !== value) clamped = true;
        clampedMs[band] = bounded;
    }
    return { clampedMs, clamped, limitMs };
}

/**
 * Target group delay in milliseconds as a continuous function of frequency.
 * Values are held below the lowest band and faded to zero before Nyquist so the
 * spectrum stays consistent with a real impulse response.
 */
function createTargetCurve(delaysMs, sampleRate) {
    const bandCount = GROUP_DELAY_EQ_BANDS.length;
    const positions = new Float64Array(bandCount);
    const values = new Float64Array(bandCount);
    for (let band = 0; band < bandCount; band += 1) {
        positions[band] = Math.log10(GROUP_DELAY_EQ_BANDS[band]);
        values[band] = delaysMs[band];
    }
    const slopes = monotoneSlopes(positions, values);
    const nyquist = sampleRate / 2;
    const fadeEnd = Math.min(RESPONSE_HIGH_FREQUENCY, nyquist * 0.9);
    const fadeStart = Math.min(GROUP_DELAY_EQ_BANDS[bandCount - 1], fadeEnd * 0.9);
    return frequency => {
        if (frequency >= fadeEnd) return 0;
        let value;
        if (frequency <= GROUP_DELAY_EQ_BANDS[0]) {
            value = values[0];
        } else if (frequency >= GROUP_DELAY_EQ_BANDS[bandCount - 1]) {
            value = values[bandCount - 1];
        } else {
            const position = Math.log10(frequency);
            let segment = 0;
            while (segment < bandCount - 2 && position > positions[segment + 1]) segment += 1;
            const width = positions[segment + 1] - positions[segment];
            const ratio = (position - positions[segment]) / width;
            const squared = ratio * ratio;
            const cubed = squared * ratio;
            value = (2 * cubed - 3 * squared + 1) * values[segment] +
                (cubed - 2 * squared + ratio) * width * slopes[segment] +
                (-2 * cubed + 3 * squared) * values[segment + 1] +
                (cubed - squared) * width * slopes[segment + 1];
        }
        if (frequency > fadeStart) {
            value *= 0.5 + 0.5 * Math.cos(Math.PI * (frequency - fadeStart) / (fadeEnd - fadeStart));
        }
        return value;
    };
}

/**
 * Frequency grid shared by the design result and the plugin graph.
 */
export function groupDelayResponseFrequencies(sampleRate) {
    const highest = Math.min(RESPONSE_HIGH_FREQUENCY, sampleRate * 0.45);
    const frequencies = new Float64Array(RESPONSE_POINTS);
    const ratio = Math.log10(highest / RESPONSE_LOW_FREQUENCY) / (RESPONSE_POINTS - 1);
    for (let point = 0; point < RESPONSE_POINTS; point += 1) {
        frequencies[point] = RESPONSE_LOW_FREQUENCY * 10 ** (ratio * point);
    }
    return frequencies;
}

/**
 * Target group delay of the given settings, in milliseconds, on the response grid.
 */
export function groupDelayTargetMs({ delaysMs, taps, sampleRate, frequencies }) {
    const { clampedMs } = clampDelays(delaysMs, taps, sampleRate);
    const curve = createTargetCurve(clampedMs, sampleRate);
    const grid = frequencies || groupDelayResponseFrequencies(sampleRate);
    const values = new Float64Array(grid.length);
    for (let point = 0; point < grid.length; point += 1) values[point] = curve(grid[point]);
    return values;
}

/**
 * Ideal all-pass spectrum: a constant bulk delay plus the requested deviation.
 */
export function buildTargetSpectrum({ delaysMs, taps, sampleRate, size }) {
    const { clampedMs, clamped, limitMs } = clampDelays(delaysMs, taps, sampleRate);
    const bulkDelaySamples = taps / 2;
    const curve = createTargetCurve(clampedMs, sampleRate);
    const samplesPerMillisecond = sampleRate / 1000;
    const bins = size / 2 + 1;
    const real = new Float64Array(bins);
    const imag = new Float64Array(bins);
    const step = 2 * Math.PI / size;
    let deviationPhase = 0;
    let previous = curve(0) * samplesPerMillisecond;
    real[0] = 1;
    for (let bin = 1; bin < bins; bin += 1) {
        const deviation = curve(bin * sampleRate / size) * samplesPerMillisecond;
        deviationPhase += 0.5 * (previous + deviation) * step;
        previous = deviation;
        const phase = -(step * bin * bulkDelaySamples + deviationPhase);
        real[bin] = Math.cos(phase);
        imag[bin] = Math.sin(phase);
    }
    // The Nyquist bin of a real sequence has no imaginary part.
    real[bins - 1] = real[bins - 1] < 0 ? -1 : 1;
    imag[bins - 1] = 0;
    return { real, imag, clampedMs, clamped, limitMs, bulkDelaySamples, targetCurve: curve };
}

function sampleAtFrequency(values, frequency, size, sampleRate) {
    const position = frequency * size / sampleRate;
    const lower = Math.floor(position);
    const upper = lower + 1;
    if (upper >= values.length) return values[values.length - 1];
    return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

/**
 * Design the all-pass FIR and measure what the finite tap count actually realizes.
 */
export function designGroupDelayFilter({
    delaysMs = [],
    taps = 16384,
    sampleRate = 48000,
    iterations = DESIGN_ITERATIONS
} = {}) {
    if (!GROUP_DELAY_EQ_TAPS_CHOICES.includes(taps)) {
        throw new RangeError('Group Delay EQ tap count is unsupported');
    }
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
        throw new RangeError('Group Delay EQ sample rate is invalid');
    }
    const size = taps * SPECTRUM_OVERSAMPLING;
    const fft = new FFT(size);
    const target = buildTargetSpectrum({ delaysMs, taps, sampleRate, size });

    let impulse = fft.inverseRealTransform(target.real, target.imag);
    let spectrum = null;
    for (let pass = 0; pass < iterations; pass += 1) {
        impulse.fill(0, taps);
        spectrum = fft.realTransform(impulse);
        let converged = true;
        for (let bin = 0; bin < spectrum.real.length; bin += 1) {
            const real = spectrum.real[bin];
            const imag = spectrum.imag[bin];
            const magnitude = Math.sqrt(real * real + imag * imag);
            if (magnitude < MAGNITUDE_EPSILON) continue;
            if (magnitude > 1.0001 || magnitude < 0.9999) converged = false;
            spectrum.real[bin] = real / magnitude;
            spectrum.imag[bin] = imag / magnitude;
        }
        if (converged) break;
        impulse = fft.inverseRealTransform(spectrum.real, spectrum.imag);
    }
    impulse.fill(0, taps);

    const ir = new Float32Array(taps);
    for (let index = 0; index < taps; index += 1) ir[index] = impulse[index];

    return { ir, ...measureResponse(ir, target, size, sampleRate, fft) };
}

/**
 * Realized magnitude ripple and group delay of the designed filter.
 * Group delay uses the ratio of the ramp-weighted transform, which needs no
 * phase unwrapping.
 */
function measureResponse(ir, target, size, sampleRate, fft) {
    const impulse = new Float64Array(size);
    const ramped = new Float64Array(size);
    for (let index = 0; index < ir.length; index += 1) {
        impulse[index] = ir[index];
        ramped[index] = ir[index] * index;
    }
    const spectrum = fft.realTransform(impulse);
    const rampedSpectrum = fft.realTransform(ramped);
    const bins = spectrum.real.length;
    const magnitudeDb = new Float64Array(bins);
    const delaySamples = new Float64Array(bins);
    for (let bin = 0; bin < bins; bin += 1) {
        const real = spectrum.real[bin];
        const imag = spectrum.imag[bin];
        const power = real * real + imag * imag;
        magnitudeDb[bin] = 10 * Math.log10(power > MAGNITUDE_EPSILON ? power : MAGNITUDE_EPSILON);
        delaySamples[bin] = power > MAGNITUDE_EPSILON
            ? (rampedSpectrum.real[bin] * real + rampedSpectrum.imag[bin] * imag) / power
            : target.bulkDelaySamples;
    }

    const frequencies = groupDelayResponseFrequencies(sampleRate);
    const targetMs = new Float64Array(frequencies.length);
    const realizedMs = new Float64Array(frequencies.length);
    const millisecondsPerSample = 1000 / sampleRate;
    let rippleDb = 0;
    for (let point = 0; point < frequencies.length; point += 1) {
        const frequency = frequencies[point];
        targetMs[point] = target.targetCurve(frequency);
        realizedMs[point] = (sampleAtFrequency(delaySamples, frequency, size, sampleRate) -
            target.bulkDelaySamples) * millisecondsPerSample;
        const deviation = sampleAtFrequency(magnitudeDb, frequency, size, sampleRate);
        const absolute = deviation < 0 ? -deviation : deviation;
        if (absolute > rippleDb) rippleDb = absolute;
    }

    return {
        bulkDelaySamples: target.bulkDelaySamples,
        clamped: target.clamped,
        limitMs: target.limitMs,
        rippleDb,
        response: { frequencies, targetMs, realizedMs }
    };
}
