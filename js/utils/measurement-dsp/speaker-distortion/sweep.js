// Swept-sine rows of the speaker distortion fit and the single-tone harmonic views.
// A stored sweep record (diagnosis-analysis.js) holds per SWEEP_FREQUENCIES point and harmonic order
// n (2 and 3) the electrical order-n transfer t = Hn(f)/H1(n·f), its noise and gRatio = |H1(n·f)/H1(f)|.
// The model's single-tone response at that point is a complex r (κ·d(f)·w of an even length, the odd
// block's third harmonic for n = 3), so the acoustic harmonic relative to the fundamental is
// gRatio·|t| measured, gRatio·|r| from the model alone and gRatio·|t − r| with the correction playing.
import { CLASSES, SWEEP_FREQUENCIES } from './constants.js';
import { FIT_CLASS_RANGES, medianOf } from './preprocess.js';

const COUNT = SWEEP_FREQUENCIES.length;
// Swept-sine weight relative to the multitone (a) records of a fit class.
const ALPHA = 1;
// Half width in grid points of the median that smooths the noise.
const NOISE_SPAN = 3;
// Noise floor of the row weights as a share of the class median noise power.
const NOISE_FLOOR_SHARE = 0.25;
// On/off rule: a 1/3-octave band counts when its measured or expected harmonic is this far above
// the noise, and the correction is worse for single tones when it raises a counted band by more
// than the margin. The fit holds every counted band within the margin (constrainedSweepFit).
const RULE_SNR_DB = 6;
const RULE_MARGIN_DB = 1;
// Band centres 50 Hz·2^(k/3), k = −4…18 (19.8 Hz to 3.2 kHz).
const RULE_BANDS = Array.from({ length: 23 }, (_, i) => 50 * 2 ** ((i - 4) / 3));
// Rule band of each grid point, −1 above the last band.
const BAND_OF = Int8Array.from(SWEEP_FREQUENCIES, f => RULE_BANDS.findIndex(c => f >= c * 2 ** (-1 / 6) && f < c * 2 ** (1 / 6)));
// Refits of constrainedSweepFit at most.
const CONSTRAINT_REFITS = 30;

// Record fields of harmonic order n.
const ORDER_FIELDS = Object.freeze({
    2: ['teRe', 'teIm', 'noise', 'gRatio'],
    3: ['t3Re', 't3Im', 'noise3', 'gRatio3']
});
const orderOf = (sweep, n) => {
    const [re, im, noise, gRatio] = ORDER_FIELDS[n].map(key => sweep[key]);
    return { re, im, noise, gRatio };
};
const isObserved = (t, k) => t.noise[k] > 0;

/** Single-tone gain κ of the swept-sine record: half the sweep's peak amplitude. */
export const sweepKappa = levelDbfs => 10 ** (levelDbfs / 20) / 2;

/**
 * Order-n swept-sine rows { w2, tRe, tIm } (Float64Array(SWEEP_FREQUENCIES.length) each): LS weight ω²
 * and target t of each point (model the single-tone response: κ·d(f_k) for n = 2). An observed point
 * gets a row when n·f lies in a fit class below `upperLimitHz`; per fit class (by n·f) each row
 * weighs the inverse acoustic noise power (median-smoothed over ±3 points, floored at a quarter of
 * the class median), and the class is normalised so its target energy carries the weight of
 * `recordCount` multitone records. An unobserved point gets target 0 and the weight of the nearest
 * observed point by index, so the model stays silent where the record cannot see. `bandWeights`
 * (per RULE_BANDS, constrainedSweepFit) scale the weights of each band's points.
 */
export function sweepRows(sweep, recordCount, upperLimitHz, n = 2, bandWeights = null) {
    const w2 = observedWeights(sweep, recordCount, upperLimitHz, n);
    const t = orderOf(sweep, n);
    const tRe = new Float64Array(COUNT), tIm = new Float64Array(COUNT);
    const observed = [];
    for (let k = 0; k < COUNT; k++) {
        if (!isObserved(t, k)) continue;
        tRe[k] = t.re[k];
        tIm[k] = t.im[k];
        observed.push(k);
    }
    // `before` is the last observed point at or before k (the first one below it), `after` the next.
    for (let k = 0, i = 0; k < COUNT && observed.length; k++) {
        while (i + 1 < observed.length && observed[i + 1] <= k) i++;
        const before = observed[i], after = observed[i + 1];
        if (before === k) continue;
        w2[k] = w2[after !== undefined && before < k && after - k < k - before ? after : before];
    }
    if (bandWeights) for (let k = 0; k < COUNT; k++) if (BAND_OF[k] >= 0) w2[k] *= bandWeights[BAND_OF[k]];
    return { w2, tRe, tIm };
}

// Row weights ω² of the observed points of sweepRows (0 elsewhere).
function observedWeights(sweep, recordCount, upperLimitHz, n) {
    const t = orderOf(sweep, n);
    const noise = new Float64Array(COUNT);
    for (let k = 0; k < COUNT; k++) {
        if (!isObserved(t, k)) continue;
        const span = [];
        for (let j = k - NOISE_SPAN; j <= k + NOISE_SPAN; j++) {
            if (j >= 0 && j < COUNT && isObserved(t, j)) span.push(t.noise[j] * t.gRatio[j]);
        }
        noise[k] = medianOf(span);
    }
    const w2 = new Float64Array(COUNT);
    for (const [lo, hi] of FIT_CLASS_RANGES) {
        const members = [];
        for (let k = 0; k < COUNT; k++) {
            const fn = n * SWEEP_FREQUENCIES[k];
            if (isObserved(t, k) && fn >= lo && fn < hi && fn < upperLimitHz) members.push(k);
        }
        if (!members.length) continue;
        const floor = NOISE_FLOOR_SHARE * medianOf(members.map(k => noise[k] * noise[k]));
        let energy = 0;
        for (const k of members) {
            const n2 = noise[k] * noise[k];
            const g2 = t.gRatio[k] * t.gRatio[k];
            // Acoustic weight 1/n² on the electrical residual scales by gRatio².
            w2[k] = g2 / (n2 > floor ? n2 : floor);
            energy += w2[k] * (t.re[k] * t.re[k] + t.im[k] * t.im[k]);
        }
        if (!(energy > 0)) {
            for (const k of members) w2[k] = 0;
            continue;
        }
        for (const k of members) w2[k] *= ALPHA * recordCount / energy;
    }
    return w2;
}

const db = value => (value > 0 && Number.isFinite(value) ? 20 * Math.log10(value) : null);

// Single-tone order-n harmonic view (sweepH2View, sweepH3View).
function harmonicView(sweep, response, n) {
    const t = orderOf(sweep, n);
    const view = { frequencies: [...SWEEP_FREQUENCIES], model: [], expected: [], measured: [], noise: [] };
    for (let k = 0; k < COUNT; k++) {
        const observed = isObserved(t, k);
        const g = t.gRatio[k];
        const re = t.re[k], im = t.im[k];
        const rRe = response ? response[2 * k] : 0, rIm = response ? response[2 * k + 1] : 0;
        view.measured.push(observed ? db(g * Math.hypot(re, im)) : null);
        view.noise.push(observed ? db(g * t.noise[k]) : null);
        view.model.push(observed && response ? db(g * Math.hypot(rRe, rIm)) : null);
        view.expected.push(observed && response ? db(g * Math.hypot(re - rRe, im - rIm)) : null);
    }
    return view;
}

/**
 * Single-tone second harmonic in dB re the fundamental (acoustic) at SWEEP_FREQUENCIES:
 * { frequencies, model, expected, measured, noise }, each an array with null where the point is not
 * observed; `model` (the corrector alone) and `expected` (measured with the correction playing) are
 * null throughout without a `response` (Float32Array(2 × SWEEP_FREQUENCIES.length), κ·d·w as re, im
 * per point).
 */
export const sweepH2View = (sweep, response) => harmonicView(sweep, response, 2);

/**
 * Single-tone third harmonic in dB re the fundamental, as sweepH2View with `response` the odd block's
 * single-tone third-harmonic response (odd.sweepResponse).
 */
export const sweepH3View = (sweep, response) => harmonicView(sweep, response, 3);

/**
 * Static (waveshaper) share of the single-tone 2nd and 3rd harmonic at SWEEP_FREQUENCIES, in dB:
 * { frequencies, positive, negative, upper, lower, noise }. `positive` and `negative` are the gains at the
 * tone's positive and negative peak relative to small signals, from the in-phase parts of t2 and t3;
 * `upper` and `lower` bound them as if all of |t2| and |t3| were static; `noise` is the half-width of the
 * band around 0 dB that the noise allows. All six are null where either order is unobserved or a ratio of
 * the formulas is not positive. `map[k]` holds the gain at each instantaneous level of `levels` (−1 to 1 of
 * the peak; the peaks are ±1) from the same in-phase parts, null where it is not positive, or is null with
 * the six.
 */
export function sweepStaticView(sweep, levels = []) {
    const t2 = orderOf(sweep, 2), t3 = orderOf(sweep, 3);
    const view = { frequencies: [...SWEEP_FREQUENCIES], positive: [], negative: [], upper: [], lower: [], noise: [], map: [] };
    for (let k = 0; k < COUNT; k++) {
        const r2 = t2.re[k], r3 = t3.re[k];
        const m2 = Math.hypot(r2, t2.im[k]), m3 = Math.hypot(r3, t3.im[k]);
        // Output over input of the static curve x + a2·x² + a3·x³ at level u of a tone, re the small-signal gain:
        // a single tone of peak 1 has t2 = a2/2 and t3 = a3/4 over the fundamental 1 + 3·a3/4.
        const gain = u => db((1 - 3 * r3 + 2 * r2 * u + 4 * r3 * u * u) / (1 - 3 * r3));
        const values = isObserved(t2, k) && isObserved(t3, k) ? [
            gain(1),
            gain(-1),
            db((1 + m3 + 2 * m2) / (1 - 3 * m3)),
            db((1 - m3 - 2 * m2) / (1 + 3 * m3)),
            db(1 + Math.hypot(2 * t2.noise[k], 4 * t3.noise[k]))
        ] : [null];
        // With positive denominators a positive finite ratio (db not null) means a positive numerator too.
        const valid = values.every(value => value !== null) && 1 - 3 * r3 > 0 && 1 - 3 * m3 > 0;
        view.positive.push(valid ? values[0] : null);
        view.negative.push(valid ? values[1] : null);
        view.upper.push(valid ? values[2] : null);
        view.lower.push(valid ? values[3] : null);
        view.noise.push(valid ? values[4] : null);
        view.map.push(valid ? levels.map(gain) : null);
    }
    return view;
}

/**
 * Rise in dB of the expected over the measured order-n harmonic in each 1/3-octave band of the
 * fundamental (RULE_BANDS) over its observed points: an array with null for a band that does not
 * count (neither its measured nor its expected RMS is at least 6 dB above the noise).
 */
export function sweepBandRises(sweep, response, n = 2) {
    const t = orderOf(sweep, n);
    const sums = RULE_BANDS.map(() => ({ measured: 0, expected: 0, noise: 0 }));
    for (let k = 0; k < COUNT; k++) {
        if (BAND_OF[k] < 0 || !isObserved(t, k)) continue;
        const sum = sums[BAND_OF[k]];
        const g2 = t.gRatio[k] * t.gRatio[k];
        const re = t.re[k], im = t.im[k];
        const dRe = re - response[2 * k], dIm = im - response[2 * k + 1];
        sum.measured += g2 * (re * re + im * im);
        sum.expected += g2 * (dRe * dRe + dIm * dIm);
        sum.noise += g2 * t.noise[k] * t.noise[k];
    }
    const floor = 10 ** (RULE_SNR_DB / 10);
    return sums.map(({ measured, expected, noise }) => (measured > 0 && noise > 0 &&
        (measured >= floor * noise || expected >= floor * noise) ? 10 * Math.log10(expected / measured) : null));
}

/**
 * Worst rise over the counted bands of sweepBandRises: { centreHz, riseDb } of the band with the
 * largest rise, or null when no band counts.
 */
export function sweepWorstRise(sweep, response, n = 2) {
    let worst = null;
    sweepBandRises(sweep, response, n).forEach((riseDb, b) => {
        if (riseDb !== null && (worst === null || riseDb > worst.riseDb)) worst = { centreHz: RULE_BANDS[b], riseDb };
    });
    return worst;
}

/**
 * Fit under the single-tone constraint. `fit(bandWeights)` fits with the order-n swept-sine rows
 * weighted per rule band (sweepRows) and returns { responses, ... } with the single-tone responses
 * of its fits; while a response raises a counted band by more than the rule margin, the weights of
 * those bands grow by the excess power ratio (at least doubling) and the fit runs again, at most
 * CONSTRAINT_REFITS times. Returns the last fit; without a `sweep` record the only fit, unweighted.
 */
export async function constrainedSweepFit(sweep, n, fit) {
    if (!sweep) return fit(null);
    const bandWeights = new Float64Array(RULE_BANDS.length).fill(1);
    for (let refit = 0; ; refit++) {
        const result = await fit(bandWeights);
        if (refit === CONSTRAINT_REFITS) return result;
        const rises = result.responses.map(response => sweepBandRises(sweep, response, n));
        let raised = false;
        for (let b = 0; b < RULE_BANDS.length; b++) {
            const excess = Math.max(...rises.map(bands => bands[b] ?? -Infinity)) - RULE_MARGIN_DB;
            if (!(excess > 0)) continue;
            bandWeights[b] *= Math.max(2, 10 ** (excess / 10));
            raised = true;
        }
        if (!raised) return result;
    }
}

/** True when the correction raises a counted order-n band (sweepWorstRise) by more than 1 dB. */
export function worseForSingleTones(sweep, response, n) {
    const worst = sweepWorstRise(sweep, response, n);
    return Boolean(worst && worst.riseDb > RULE_MARGIN_DB);
}

/**
 * On/off rule check of one even length: the CLASSES key of the band centre (c1-c3, c1 also below
 * 50 Hz, above 2 kHz even8k) when the correction raises a counted band by more than 1 dB, otherwise null.
 */
export function singleToneWorseClass(sweep, response) {
    const worst = sweepWorstRise(sweep, response);
    if (!worst || !(worst.riseDb > RULE_MARGIN_DB)) return null;
    return (CLASSES.slice(0, 3).find(entry => worst.centreHz < entry.hi) ?? CLASSES[5]).key;
}
