/**
 * Group Delay PEQ filter design.
 *
 * Builds a finite-length all-pass FIR whose group delay follows the sum of up to
 * five parametric band shapes. The magnitude response stays flat, so the filter
 * changes only the excess phase of the signal. Alternating projection between the
 * length constraint and the unit-magnitude constraint turns the ideal (infinitely
 * long) all-pass into a filter of the requested tap count.
 *
 * The design pipeline is shared with Group Delay EQ; only the target curve differs:
 * instead of interpolating fifteen fixed sliders it adds the analytic shape of each
 * enabled band.
 */
import FFT from '../utils/measurement-dsp/fft.js';

export const GROUP_DELAY_PEQ_BAND_COUNT = 5;
export const GROUP_DELAY_PEQ_TYPES = Object.freeze(['pk', 'ls', 'hs', 'fl']);
export const GROUP_DELAY_PEQ_TAPS_CHOICES = Object.freeze([4096, 8192, 16384, 32768]);
export const GROUP_DELAY_PEQ_FREQUENCY_RANGE = Object.freeze({ minimum: 20, maximum: 20000 });
export const GROUP_DELAY_PEQ_Q_RANGE = Object.freeze({ minimum: 0.1, maximum: 100 });

const DESIGN_ITERATIONS = 12;
const SPECTRUM_OVERSAMPLING = 2;
const GUARD_DIVISOR = 16;
const RESPONSE_POINTS = 128;
const RESPONSE_LOW_FREQUENCY = 20;
const RESPONSE_HIGH_FREQUENCY = 20000;
/** Plot range of the plugin graph; the response grid is measured over it. */
const RESPONSE_GRID_LOW_FREQUENCY = 10;
const RESPONSE_GRID_HIGH_FREQUENCY = 40000;
const MAGNITUDE_EPSILON = 1e-12;
/**
 * Below this Q the second order group delay is monotonic and its extremum sits on
 * the DC plateau; above it the extremum is the bump near the band frequency.
 * The threshold is the real-solution condition of u^2 + 2u + (1/Q^2 - 3) = 0.
 */
const FILTER_GD_MONOTONIC_Q = 1 / Math.sqrt(3);
const LOG_OF_FOUR = Math.log(4);

/**
 * Group delay of a second order section (denominator s^2 + (w0/Q)s + w0^2) in
 * seconds. The numerator (low-pass, high-pass or band-pass) does not matter.
 * At DC the value is 1 / (Q * w0), which the expression returns without a branch.
 */
function secondOrderGroupDelay(frequency, band) {
    const omega = 2 * Math.PI * frequency;
    const omegaSquared = omega * omega;
    const centre = band.angularFrequency;
    const centreSquared = centre * centre;
    const difference = centreSquared - omegaSquared;
    const damping = centre * omega / band.q;
    return (centre / band.q) * (omegaSquared + centreSquared) /
        (difference * difference + damping * damping);
}

/**
 * Frequency of the second order group delay extremum over [0, Nyquist], in closed
 * form. A numeric scan must not be used: at high Q the bump is far narrower than
 * any practical scan grid, and missing it would break the |curve| <= |d| invariant
 * that the marker placement, the auto scale and the +/-limit clip rely on.
 */
function filterGdExtremumFrequency(band, nyquist) {
    if (band.q <= FILTER_GD_MONOTONIC_Q) return 0;
    const extremum = Math.sqrt(4 - 1 / (band.q * band.q)) - 1;
    const frequency = band.frequency * Math.sqrt(extremum);
    return frequency > nyquist ? nyquist : frequency;
}

/**
 * Per-type target shapes, in milliseconds. This table is the single place where the
 * band types live; it maps one to one onto the type table of the design plan.
 * `prepare` caches the per-band constants so that evaluating tens of thousands of
 * spectrum bins stays cheap; `shape` is evaluated with the held frequency.
 */
const BAND_SHAPES = Object.freeze({
    /** Peak: d * bell(x), a log2-axis Gaussian whose full width at half maximum is BW. */
    pk: {
        prepare(band) {
            const bandwidth = (2 / Math.LN2) * Math.asinh(1 / (2 * band.q));
            band.bellScale = 2 / bandwidth;
        },
        shape(frequency, band) {
            const position = band.bellScale * (Math.log2(frequency) - band.logFrequency);
            return band.delayMs * Math.exp(-Math.LN2 * position * position);
        }
    },
    /** Low Shelf: d * sh(x) = d / (1 + 4^(Q*x)); d at low frequencies, d/2 at f_i, 0 up high. */
    ls: {
        prepare(band) {
            band.shelfSlope = band.q * LOG_OF_FOUR;
        },
        shape(frequency, band) {
            const position = Math.log2(frequency) - band.logFrequency;
            return band.delayMs / (1 + Math.exp(band.shelfSlope * position));
        }
    },
    /** High Shelf: d * sh(-x), the mirror image of Low Shelf (tau_hs = d - tau_ls). */
    hs: {
        prepare(band) {
            band.shelfSlope = band.q * LOG_OF_FOUR;
        },
        shape(frequency, band) {
            const position = band.logFrequency - Math.log2(frequency);
            return band.delayMs / (1 + Math.exp(band.shelfSlope * position));
        }
    },
    /** Filter GD: d * tau2(f) / max_f tau2, so the curve extremum equals d. */
    fl: {
        prepare(band, nyquist) {
            band.angularFrequency = 2 * Math.PI * band.frequency;
            const extremum = filterGdExtremumFrequency(band, nyquist);
            band.filterGdNormalization = 1 / secondOrderGroupDelay(extremum, band);
        },
        shape(frequency, band) {
            return band.delayMs * secondOrderGroupDelay(frequency, band) * band.filterGdNormalization;
        }
    }
});

function clampNumber(value, minimum, maximum) {
    if (value < minimum) return minimum;
    if (value > maximum) return maximum;
    return value;
}

/**
 * Validate the band list, clamp each delay into the tap budget and cache the
 * per-type constants. A disabled band contributes to nothing at all - neither to the
 * sum nor to the clamp flag - so it leaves the loop before anything is evaluated.
 * Enabled bands that ask for no delay are dropped from the sum only; their delay has
 * already been judged against the limit by then.
 */
function normalizeBands(bands, taps, sampleRate) {
    const limitSamples = taps / 2 - taps / GUARD_DIVISOR;
    // Rounded down to the 0.1 ms delay step so that the limit quoted by the design is
    // the same number the plugin offers as the delay input maximum.
    const limitMs = Math.floor(limitSamples * 1000 / sampleRate * 10) / 10;
    const nyquist = sampleRate / 2;
    const entries = Array.isArray(bands) ? bands : [];
    const prepared = [];
    let clamped = false;
    for (const entry of entries) {
        if (entry?.enabled === false) continue;
        const type = GROUP_DELAY_PEQ_TYPES.includes(entry?.type) ? entry.type : GROUP_DELAY_PEQ_TYPES[0];
        const requestedFrequency = Number(entry?.frequency);
        const frequency = clampNumber(
            Number.isFinite(requestedFrequency) ? requestedFrequency : GROUP_DELAY_PEQ_FREQUENCY_RANGE.minimum,
            GROUP_DELAY_PEQ_FREQUENCY_RANGE.minimum,
            GROUP_DELAY_PEQ_FREQUENCY_RANGE.maximum
        );
        const requestedQ = Number(entry?.q);
        const q = clampNumber(
            Number.isFinite(requestedQ) ? requestedQ : 0.7,
            GROUP_DELAY_PEQ_Q_RANGE.minimum,
            GROUP_DELAY_PEQ_Q_RANGE.maximum
        );
        const requestedDelay = Number(entry?.delayMs);
        const delay = Number.isFinite(requestedDelay) ? requestedDelay : 0;
        const bounded = clampNumber(delay, -limitMs, limitMs);
        if (bounded !== delay) clamped = true;
        if (bounded === 0) continue;
        const band = { type, frequency, delayMs: bounded, q, logFrequency: Math.log2(frequency) };
        BAND_SHAPES[type].prepare(band, nyquist);
        prepared.push(band);
    }
    return { bands: prepared, clamped, limitMs };
}

/**
 * Target group delay in milliseconds as a continuous function of frequency.
 *
 * Evaluation order (see the design plan): the per-type shapes are summed at the
 * held frequency max(f, 20 Hz), the sum is clipped to +/-limitMs, and the result is
 * faded to zero before Nyquist so the spectrum stays consistent with a real impulse
 * response. The hold keeps curve(0) finite - the phase integral starts at bin 0 -
 * and every type flattens towards DC anyway, so it does not bend the shapes.
 */
function createTargetCurve(bands, sampleRate, limitMs, clipState) {
    const nyquist = sampleRate / 2;
    const fadeEnd = Math.min(RESPONSE_HIGH_FREQUENCY, nyquist * 0.9);
    const fadeStart = fadeEnd * 0.9;
    return frequency => {
        if (frequency >= fadeEnd) return 0;
        const held = frequency > RESPONSE_LOW_FREQUENCY ? frequency : RESPONSE_LOW_FREQUENCY;
        let value = 0;
        for (const band of bands) value += BAND_SHAPES[band.type].shape(held, band);
        if (value > limitMs) {
            value = limitMs;
            clipState.clamped = true;
        } else if (value < -limitMs) {
            value = -limitMs;
            clipState.clamped = true;
        }
        if (frequency > fadeStart) {
            value *= 0.5 + 0.5 * Math.cos(Math.PI * (frequency - fadeStart) / (fadeEnd - fadeStart));
        }
        return value;
    };
}

/**
 * Frequency grid shared by the design result and the plugin graph.
 *
 * It spans the plot range rather than the design band so the realized curve reaches
 * both edges of the graph instead of stopping inside it. The top is still capped at
 * 0.45 fs: above that there is nothing to measure, and the curve ends where the
 * measurement does.
 */
export function groupDelayPeqResponseFrequencies(sampleRate) {
    const highest = Math.min(RESPONSE_GRID_HIGH_FREQUENCY, sampleRate * 0.45);
    const frequencies = new Float64Array(RESPONSE_POINTS);
    const ratio = Math.log10(highest / RESPONSE_GRID_LOW_FREQUENCY) / (RESPONSE_POINTS - 1);
    for (let point = 0; point < RESPONSE_POINTS; point += 1) {
        frequencies[point] = RESPONSE_GRID_LOW_FREQUENCY * 10 ** (ratio * point);
    }
    return frequencies;
}

/**
 * Target group delay of the given settings, in milliseconds. Without `frequencies`
 * the response grid is used; the plugin graph passes its own drawing grid.
 */
export function groupDelayPeqTargetMs({ bands, taps = 16384, sampleRate = 48000, frequencies }) {
    const normalized = normalizeBands(bands, taps, sampleRate);
    const curve = createTargetCurve(normalized.bands, sampleRate, normalized.limitMs, { clamped: false });
    const grid = frequencies || groupDelayPeqResponseFrequencies(sampleRate);
    const values = new Float64Array(grid.length);
    for (let point = 0; point < grid.length; point += 1) values[point] = curve(grid[point]);
    return values;
}

/**
 * Ideal all-pass spectrum: a constant bulk delay plus the requested deviation.
 * `clampState` is filled in while the bins are evaluated, so read it afterwards.
 */
export function buildTargetSpectrum({ bands, taps, sampleRate, size }) {
    const normalized = normalizeBands(bands, taps, sampleRate);
    const clampState = { clamped: normalized.clamped };
    const bulkDelaySamples = taps / 2;
    const curve = createTargetCurve(normalized.bands, sampleRate, normalized.limitMs, clampState);
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
    return { real, imag, clampState, limitMs: normalized.limitMs, bulkDelaySamples, targetCurve: curve };
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
export function designGroupDelayPeqFilter({
    bands = [],
    taps = 16384,
    sampleRate = 48000,
    iterations = DESIGN_ITERATIONS
} = {}) {
    if (!GROUP_DELAY_PEQ_TAPS_CHOICES.includes(taps)) {
        throw new RangeError('Group Delay PEQ tap count is unsupported');
    }
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
        throw new RangeError('Group Delay PEQ sample rate is invalid');
    }
    const size = taps * SPECTRUM_OVERSAMPLING;
    const fft = new FFT(size);
    const target = buildTargetSpectrum({ bands, taps, sampleRate, size });

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

    const frequencies = groupDelayPeqResponseFrequencies(sampleRate);
    const targetMs = new Float64Array(frequencies.length);
    const realizedMs = new Float64Array(frequencies.length);
    const millisecondsPerSample = 1000 / sampleRate;
    let rippleDb = 0;
    for (let point = 0; point < frequencies.length; point += 1) {
        const frequency = frequencies[point];
        targetMs[point] = target.targetCurve(frequency);
        realizedMs[point] = (sampleAtFrequency(delaySamples, frequency, size, sampleRate) -
            target.bulkDelaySamples) * millisecondsPerSample;
        // Ripple stays a statement about the design band, so the grid points the
        // graph adds outside it are drawn but not counted.
        if (frequency < RESPONSE_LOW_FREQUENCY || frequency > RESPONSE_HIGH_FREQUENCY) continue;
        const deviation = sampleAtFrequency(magnitudeDb, frequency, size, sampleRate);
        const absolute = deviation < 0 ? -deviation : deviation;
        if (absolute > rippleDb) rippleDb = absolute;
    }

    return {
        bulkDelaySamples: target.bulkDelaySamples,
        clamped: target.clampState.clamped,
        limitMs: target.limitMs,
        rippleDb,
        response: { frequencies, targetMs, realizedMs }
    };
}
