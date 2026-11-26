// Preprocessing of the speaker distortion identification:
// alignment, period averaging, linear response, bin classes and row weights. Pure JS, so the
// level check can run outside the worker pool.
import FFT from '../fft.js';
import { clockRatio, correctClock } from '../clock-drift.js';
import { resampleWindowedSinc } from '../resample.js';
import { MIN_KEPT_SHARE } from '../recording-gaps.js';
import { correlationPeak, fractionalLag, segmentLag } from '../segment-lag.js';
import { BAND_EDGES, N_BANDS } from './constants.js';
import { MAX_BIN, N, SPECTRUM_BINS, combLines } from './signals.js';

export const ROW_COUNT = 3983;
export const rowFrequency = r => 2 * (r + 18);
export const PENALTY_MU = 30;

// ------------------------------------------------------------------- 48000-point DFT

// Bluestein: X[k] = w*_k · Σ_n (x_n·w*_n)·w_(k−n), w_m = e^(jπm²/N), as a power-of-two convolution.
const BLUESTEIN_SIZE = 131072;
let bluestein = null;

function bluesteinTables() {
    if (bluestein) return bluestein;
    const fft = new FFT(BLUESTEIN_SIZE);
    const chirpRe = new Float64Array(N);
    const chirpIm = new Float64Array(N);
    for (let n = 0; n < N; n++) {
        const angle = Math.PI * ((n * n) % (2 * N)) / N;
        chirpRe[n] = Math.cos(angle);
        chirpIm[n] = Math.sin(angle);
    }
    const re = new Float64Array(BLUESTEIN_SIZE);
    const im = new Float64Array(BLUESTEIN_SIZE);
    for (let n = 0; n < N; n++) {
        re[n] = chirpRe[n];
        im[n] = chirpIm[n];
        if (n > 0) {
            re[BLUESTEIN_SIZE - n] = chirpRe[n];
            im[BLUESTEIN_SIZE - n] = chirpIm[n];
        }
    }
    const filterRe = new Float64Array(BLUESTEIN_SIZE);
    const filterIm = new Float64Array(BLUESTEIN_SIZE);
    fft.transform(filterRe, filterIm, re, im);
    bluestein = {
        fft, chirpRe, chirpIm, filterRe, filterIm,
        re: new Float64Array(BLUESTEIN_SIZE), im: new Float64Array(BLUESTEIN_SIZE),
        outRe: new Float64Array(BLUESTEIN_SIZE), outIm: new Float64Array(BLUESTEIN_SIZE)
    };
    return bluestein;
}

/**
 * DFT/N on bins 0..8000 of two real 48 kHz periods at once (`b` may be null): interleaved
 * Float64Array(16002) each.
 */
function periodSpectra(a, b) {
    const t = bluesteinTables();
    const { fft, chirpRe, chirpIm, re, im, outRe, outIm, filterRe, filterIm } = t;
    re.fill(0);
    im.fill(0);
    for (let n = 0; n < N; n++) {
        const xr = a[n];
        const xi = b ? b[n] : 0;
        re[n] = xr * chirpRe[n] + xi * chirpIm[n];
        im[n] = xi * chirpRe[n] - xr * chirpIm[n];
    }
    fft.transform(outRe, outIm, re, im);
    for (let k = 0; k < BLUESTEIN_SIZE; k++) {
        const pr = outRe[k] * filterRe[k] - outIm[k] * filterIm[k];
        const pi = outRe[k] * filterIm[k] + outIm[k] * filterRe[k];
        re[k] = pr;
        im[k] = pi;
    }
    fft.inverseTransform(outRe, outIm, re, im);
    // Z[k] = w*_k · conv[k]; the two real spectra follow from Z[k] and conj(Z[N − k]).
    const z = k => {
        const cr = chirpRe[k];
        const ci = chirpIm[k];
        return [(outRe[k] * cr + outIm[k] * ci) / N, (outIm[k] * cr - outRe[k] * ci) / N];
    };
    const A = new Float64Array(2 * SPECTRUM_BINS);
    const B = b ? new Float64Array(2 * SPECTRUM_BINS) : null;
    for (let k = 0; k < SPECTRUM_BINS; k++) {
        const [zr, zi] = z(k);
        if (!b) {
            A[2 * k] = zr;
            A[2 * k + 1] = zi;
            continue;
        }
        const [mr, mi] = z(k === 0 ? 0 : N - k);
        A[2 * k] = 0.5 * (zr + mr);
        A[2 * k + 1] = 0.5 * (zi - mi);
        B[2 * k] = 0.5 * (zi + mi);
        B[2 * k + 1] = 0.5 * (mr - zr);
    }
    return [A, B];
}

/** DFT/N on bins 0..8000 of one real 48 kHz period, interleaved. */
export const periodSpectrum = period => periodSpectra(period, null)[0];

// ------------------------------------------------------------------ analysis

const nextPowerOfTwo = n => 2 ** Math.ceil(Math.log2(n));

/** Latency: the lag below 1.5 s with the largest |correlation| with the call's chirp. */
export function findLatency(capture, chirp, fsDev) {
    const window = Math.round(1.5 * fsDev);
    const size = nextPowerOfTwo(window + chirp.length);
    const fft = new FFT(size);
    const a = new Float64Array(size);
    const b = new Float64Array(size);
    a.set(capture.subarray(0, window + chirp.length < capture.length ? window + chirp.length : capture.length));
    b.set(chirp);
    const zero = new Float64Array(size);
    const aRe = new Float64Array(size), aIm = new Float64Array(size);
    const bRe = new Float64Array(size), bIm = new Float64Array(size);
    fft.transform(aRe, aIm, a, zero);
    fft.transform(bRe, bIm, b, zero);
    // c[lag] = Σ a[lag + n]·b[n] = IDFT(A·conj(B)).
    for (let k = 0; k < size; k++) {
        const re = aRe[k] * bRe[k] + aIm[k] * bIm[k];
        const im = aIm[k] * bRe[k] - aRe[k] * bIm[k];
        aRe[k] = re;
        aIm[k] = im;
    }
    fft.inverseTransform(bRe, bIm, aRe, aIm);
    let latency = 0;
    let best = -1;
    for (let lag = 0; lag < window; lag++) {
        const value = bRe[lag] < 0 ? -bRe[lag] : bRe[lag];
        if (value > best) {
            best = value;
            latency = lag;
        }
    }
    return latency;
}

// Period mean (float64, interleaved) and its noise Pn (Float32Array(8001)) of K ≥ 2 period spectra.
function averagePeriods(spectra) {
    const K = spectra.length;
    const mean = new Float64Array(2 * SPECTRUM_BINS);
    for (const Yi of spectra) for (let i = 0; i < mean.length; i++) mean[i] += Yi[i];
    for (let i = 0; i < mean.length; i++) mean[i] /= K;
    const noise = new Float64Array(SPECTRUM_BINS);
    for (const Yi of spectra) {
        for (let k = 0; k < SPECTRUM_BINS; k++) {
            const dr = Yi[2 * k] - mean[2 * k];
            const di = Yi[2 * k + 1] - mean[2 * k + 1];
            noise[k] += dr * dr + di * di;
        }
    }
    const Pn = new Float32Array(SPECTRUM_BINS);
    for (let k = 0; k < SPECTRUM_BINS; k++) Pn[k] = noise[k] / (K * (K - 1));
    return { mean, Pn };
}

/**
 * Latency from the chirp, then the period mean Y = mean of DFT/N over the K periods
 * after the faded-in one (interleaved Float32Array(16002)) and its noise Pn (Float32Array(8001)),
 * both accumulated in float64. With the call's `seed` and `bandwidth`, a capture whose periods drift
 * apart by a steady step is first resampled onto the playback clock, and the periods are realigned
 * against capture time slips (see realignPeriods); `X` (the drive spectrum) and `reference` (the
 * channel's reference peak, null for none) also align the whole capture.
 */
export function analyzeCall(capture, { fsDev, K, chirp, seed = null, bandwidth = null, X = null, reference = null }) {
    const periodsOf = source => {
        const latency = findLatency(source, chirp, fsDev);
        const blockStart = latency + Math.round(0.5 * fsDev);
        const block48 = fsDev === N
            ? source.subarray(blockStart, blockStart + (K + 2) * N)
            : resampleWindowedSinc(source.subarray(blockStart, blockStart + Math.round((K + 2) * fsDev)), fsDev, N);
        const block = new Float64Array((K + 2) * N);
        block.set(block48.subarray(0, block.length));
        const period = i => block.subarray(N * (1 + i), N * (2 + i));
        const spectra = [];
        for (let i = 0; i < K; i += 2) spectra.push(...periodSpectra(period(i), i + 1 < K ? period(i + 1) : null));
        if (spectra.length > K) spectra.pop();
        return { latency, spectra };
    };
    let { latency, spectra } = periodsOf(capture);
    if (seed === null) {
        const { mean, Pn } = averagePeriods(spectra);
        return { latency, Y: Float32Array.from(mean), Pn };
    }
    const { lines, weights } = lagLines(seed, bandwidth);
    // A recording clock that differs from the playback clock delays each period by the same step
    // behind the one before it; resampling onto the playback clock from the chirp keeps them in place,
    // and the chirp is located again since the mismatch also stretched it.
    const steps = spectra.slice(1).map((S, i) => fractionalLag(S, spectra[i], lines, weights, fsDev));
    const corrected = correctClock(capture, clockRatio(steps, fsDev), latency);
    if (corrected) ({ latency, spectra } = periodsOf(corrected));
    const { mean, Pn, ...realigned } = realignPeriods(spectra, { fsDev, lines, weights, X, reference });
    return { latency, Y: Float32Array.from(mean), Pn, ...realigned };
}

// ------------------------------------------------------------- slip-tolerant averaging

// The recording of a call may jump in time between periods. Each period's lag against the periods
// of the majority lag is estimated by cross-correlation on the excited lines, the periods are
// realigned by a phase ramp (exact for periodic content), and the periods a jump corrupts are left out.
const SAME_LAG = 2; // device samples: lags this close count as the same lag
/** Whole-capture offset (device samples) up to which a capture counts as aligned: 0.25 ms. */
export const offsetTolerance = fsDev => Math.round(0.00025 * fsDev);
const HEIGHT_FLOOR = 0.95; // correlation height (1 for identical periods) below which a period is dropped
const OUTLIER_FACTOR = 10;
const LAG_LOW_HZ = 50;

// Spectrum S of a period delayed by `shift` device samples, advanced back: S·e^(+j2πf·shift/fsDev).
function advanced(S, shift, fsDev) {
    if (shift === 0) return S;
    const out = new Float64Array(S.length);
    for (let f = 0; f < SPECTRUM_BINS; f++) {
        const angle = 2 * Math.PI * ((f * shift) % fsDev) / fsDev;
        const c = Math.cos(angle), s = Math.sin(angle);
        out[2 * f] = S[2 * f] * c - S[2 * f + 1] * s;
        out[2 * f + 1] = S[2 * f] * s + S[2 * f + 1] * c;
    }
    return out;
}

// Lag lines of a call: its excited lines from 50 Hz without mains, weighted by 1/|X|² (the
// correlation of the transfer functions).
function lagLines(seed, bandwidth) {
    const { excited, target } = combLines(seed, bandwidth);
    const lines = [];
    for (let f = LAG_LOW_HZ; f <= MAX_BIN; f++) if (excited[f] && !isMains(f)) lines.push(f);
    const weights = new Float64Array(SPECTRUM_BINS);
    for (const f of lines) weights[f] = 1 / (target[f] * target[f]);
    return { lines, weights };
}

/**
 * Mean and noise of the K period spectra of a call, robust to capture time slips:
 * { mean, Pn, periods, gaps, peak, lags, dropped }.
 * - lags: each period's lag (device samples) against the mean of the periods whose lags agree with the
 *   majority within SAME_LAG, from the largest positive cross-correlation peak on the excited lines
 *   from 50 Hz, weighted by 1/|X|² (the correlation of the transfer functions).
 * - peak: { offset, sign } of the majority's impulse response within ±0.25 s (null without `X`): its
 *   largest magnitude, or with the channel's `reference` peak its largest value of the reference's sign,
 *   since a response can hold lobes of either sign close together. When the offset differs from the
 *   reference offset by more than 0.25 ms, every period is shifted by the difference as well.
 * - A period is dropped when its correlation height is below HEIGHT_FLOOR, when its lag differs from a
 *   neighbour's (a jump within or between the two), or when its realigned window would reach outside
 *   the steady periods. Only when periods were dropped, a remaining period whose deviation from the mean
 *   exceeds OUTLIER_FACTOR × the median is dropped too.
 * - periods: the number averaged (Pn is the noise of that mean); gaps: null for an untouched capture,
 *   'corrected' when periods were realigned or dropped, 'interrupted' when fewer than MIN_KEPT_SHARE of
 *   the periods remain. A capture without slips is averaged exactly as without this step.
 */
function realignPeriods(spectra, { fsDev, lines, weights, X, reference }) {
    const K = spectra.length;
    const meanOf = indices => {
        const R = new Float64Array(2 * SPECTRUM_BINS);
        for (const i of indices) {
            for (const f of lines) {
                R[2 * f] += spectra[i][2 * f] / indices.length;
                R[2 * f + 1] += spectra[i][2 * f + 1] / indices.length;
            }
        }
        return R;
    };
    const lagsAgainst = R => spectra.map(S => segmentLag(S, R, lines, weights, fsDev));
    const all = spectra.map((_, i) => i);
    const first = lagsAgainst(meanOf(all)).map(row => row.lag);
    let majority = null;
    for (const t of first) {
        const members = all.filter(i => Math.abs(first[i] - t) <= SAME_LAG);
        if (!majority || members.length > majority.members.length ||
            (members.length === majority.members.length && Math.abs(t) < Math.abs(majority.t))) majority = { t, members };
    }
    const majorityMean = meanOf(majority.members);
    const rows = lagsAgainst(majorityMean);
    const tolerance = offsetTolerance(fsDev);
    let peak = null;
    let shiftAll = 0;
    if (X) {
        const H = new Float64Array(2 * lines.length);
        lines.forEach((f, j) => {
            const xr = X[2 * f], xi = X[2 * f + 1], d = xr * xr + xi * xi;
            H[2 * j] = (majorityMean[2 * f] * xr + majorityMean[2 * f + 1] * xi) / d;
            H[2 * j + 1] = (majorityMean[2 * f + 1] * xr - majorityMean[2 * f] * xi) / d;
        });
        const { t, value } = correlationPeak(H, lines, fsDev, { within: Math.floor(fsDev / 4), sign: reference?.sign ?? 0 });
        peak = { offset: t, sign: value < 0 ? -1 : 1 };
        if (reference && Math.abs(t - reference.offset) > tolerance) shiftAll = t - reference.offset;
    }
    const lags = rows.map(row => row.lag);
    const shifts = lags.map(lag => lag + shiftAll);
    let kept = all.filter(i => rows[i].height >= HEIGHT_FLOOR &&
        !(i > 0 && Math.abs(lags[i] - lags[i - 1]) > SAME_LAG) &&
        !(i < K - 1 && Math.abs(lags[i + 1] - lags[i]) > SAME_LAG) &&
        // Window i holds steady period 1 + i; delayed by `shift`, it starts `shift` earlier in the call.
        shifts[i] <= i * fsDev + tolerance && shifts[i] >= -(K - 1 - i) * fsDev - tolerance);
    const result = (averaged, gaps) => ({
        ...averaged, gaps, peak, lags, dropped: all.filter(i => !kept.includes(i))
    });
    if (kept.length === K && shifts.every(shift => shift === 0)) {
        return result({ ...averagePeriods(spectra), periods: K }, null);
    }
    const gapsOf = count => (count < MIN_KEPT_SHARE * K ? 'interrupted' : 'corrected');
    if (kept.length < 2) return result({ ...averagePeriods(spectra), periods: K }, gapsOf(kept.length));
    let aligned = kept.map(i => advanced(spectra[i], shifts[i], fsDev));
    let averaged = averagePeriods(aligned);
    if (kept.length < K) {
        // Only in a capture that already lost periods: corruption that shows no lag change.
        const deviation = aligned.map(S => {
            let sum = 0;
            for (let f = LAG_LOW_HZ; f <= MAX_BIN; f++) {
                const dr = S[2 * f] - averaged.mean[2 * f], di = S[2 * f + 1] - averaged.mean[2 * f + 1];
                sum += dr * dr + di * di;
            }
            return sum;
        });
        const limit = OUTLIER_FACTOR * medianOf(deviation);
        const ok = deviation.map(d => d <= limit);
        if (ok.includes(false) && ok.filter(Boolean).length >= 2) {
            kept = kept.filter((_, j) => ok[j]);
            aligned = aligned.filter((_, j) => ok[j]);
            averaged = averagePeriods(aligned);
        }
    }
    return result({ ...averaged, periods: kept.length }, gapsOf(kept.length));
}

// --------------------------------------------------------------------- response g

const power = (Y, f) => Y[2 * f] * Y[2 * f] + Y[2 * f + 1] * Y[2 * f + 1];
const wrapPhase = d => d - 2 * Math.PI * Math.ceil((d - Math.PI) / (2 * Math.PI));

/** Whether bin f of a record is measured: excited and |Y|² ≥ 25·Pn. */
export const isMeasured = (record, excited, f) => excited[f] === 1 && power(record.Y, f) >= 25 * record.Pn[f];

/**
 * Linear response g (interleaved Float64Array(16002)) from records { X, excited, Y, Pn },
 * or null when no bin is measured.
 */
export function estimateG(records) {
    const measured = [];
    for (let f = 0; f <= MAX_BIN; f++) {
        let nr = 0, ni = 0, den = 0;
        for (const record of records) {
            if (!isMeasured(record, record.excited, f)) continue;
            const { X, Y } = record;
            const xr = X[2 * f], xi = X[2 * f + 1], yr = Y[2 * f], yi = Y[2 * f + 1];
            nr += xr * yr + xi * yi;
            ni += xr * yi - xi * yr;
            den += xr * xr + xi * xi;
        }
        if (den > 0) measured.push({ f, re: nr / den, im: ni / den });
    }
    if (!measured.length) return null;
    let phase = 0;
    let previous = 0;
    for (let i = 0; i < measured.length; i++) {
        const point = measured[i];
        const angle = Math.atan2(point.im, point.re);
        phase = i === 0 ? angle : phase + wrapPhase(angle - previous);
        previous = angle;
        point.phase = phase;
        point.logMagnitude = 0.5 * Math.log(point.re * point.re + point.im * point.im);
    }
    const g = new Float64Array(2 * SPECTRUM_BINS);
    let next = 0;
    for (let f = 0; f <= MAX_BIN; f++) {
        while (next < measured.length && measured[next].f < f) next++;
        let logMagnitude, phaseAt;
        if (next === 0 || next === measured.length || measured[next].f === f) {
            ({ logMagnitude, phase: phaseAt } = measured[next === measured.length ? next - 1 : next]);
        } else {
            const lo = measured[next - 1], hi = measured[next];
            const t = (f - lo.f) / (hi.f - lo.f);
            logMagnitude = lo.logMagnitude + t * (hi.logMagnitude - lo.logMagnitude);
            phaseAt = lo.phase + t * (hi.phase - lo.phase);
        }
        const magnitude = Math.exp(logMagnitude);
        g[2 * f] = magnitude * Math.cos(phaseAt);
        g[2 * f + 1] = magnitude * Math.sin(phaseAt);
    }
    return g;
}

// ------------------------------------------------------------------------- bins

/** Mains bins: f ≤ 1001 Hz within 1 Hz of a multiple of 50 or 60 Hz. */
export function isMains(f) {
    if (f > 1001) return false;
    const rest50 = f % 50;
    const rest60 = f % 60;
    return rest50 <= 1 || rest50 >= 49 || rest60 <= 1 || rest60 >= 59;
}

// Half-open [lo, hi); a range ending at 8000 Hz includes 8000; `upper` clips to f < upper below 8000.
const inRange = (f, lo, hi, upper = MAX_BIN) => {
    const top = upper < MAX_BIN && upper < hi ? upper : hi;
    return f >= lo && (f < top || (top === MAX_BIN && f === MAX_BIN));
};
// Integer bins of one parity in [lo, hi) (the chart band edges are not integers).
const binsOfParity = (lo, hi, parity, keep) => {
    const bins = [];
    const first = Math.ceil(lo);
    for (let f = first + ((first + parity) & 1); f <= MAX_BIN; f += 2) if (inRange(f, lo, hi) && keep(f)) bins.push(f);
    return Int32Array.from(bins);
};
const evenBins = (lo, hi, upper = MAX_BIN) => binsOfParity(lo, hi, 0, f => !isMains(f) && inRange(f, lo, hi, upper));

export const FIT_CLASS_RANGES = Object.freeze([[35, 100], [100, 400], [400, 2000], [2000, 8000]]);
export const SCORE_CLASS_RANGES = Object.freeze([[50, 100], [100, 400], [400, 2000]]);

/**
 * Even-bin sets of a channel at an Upper Limit: fit classes (clipped, empty ones
 * dropped), score classes C1-C3 (clipped, possibly empty), the unclipped even 50 Hz-8 kHz set,
 * the 50 chart bands, the microphone set S and qRow, the first row of Q (3983 when empty).
 */
export function binSets(upperLimitHz) {
    let qRow = ROW_COUNT;
    if (upperLimitHz < MAX_BIN) {
        for (let r = 0; r < ROW_COUNT; r++) {
            if (rowFrequency(r) >= upperLimitHz) {
                qRow = r;
                break;
            }
        }
    }
    return {
        upperLimitHz,
        fit: FIT_CLASS_RANGES.map(([lo, hi]) => evenBins(lo, hi, upperLimitHz)).filter(bins => bins.length),
        score: SCORE_CLASS_RANGES.map(([lo, hi]) => evenBins(lo, hi, upperLimitHz)),
        even8k: evenBins(50, MAX_BIN),
        bands: Array.from({ length: N_BANDS }, (_, i) => evenBins(BAND_EDGES[i], BAND_EDGES[i + 1])),
        mic: evenBins(50, 2000),
        qRow
    };
}

/** Non-excited, non-mains odd bins of one drive: the 50 Hz-8 kHz set and the chart bands. */
export function oddSets(excited) {
    const odd = (lo, hi) => binsOfParity(lo, hi, 1, f => !excited[f] && !isMains(f));
    return {
        odd8k: odd(50, MAX_BIN),
        bands: Array.from({ length: N_BANDS }, (_, i) => odd(BAND_EDGES[i], BAND_EDGES[i + 1]))
    };
}

/** Σ(|Y|² − Pn) and the limit variance Σ(2·max(excess, 0)·Pn + Pn²) of a bin set over records. */
export function limitSums(records, bins) {
    let sum = 0;
    let variance = 0;
    for (const { Y, Pn } of records) {
        for (const f of bins) {
            const excess = power(Y, f) - Pn[f];
            sum += excess;
            variance += 2 * (excess > 0 ? excess : 0) * Pn[f] + Pn[f] * Pn[f];
        }
    }
    return { sum, variance };
}

/** Whether a non-empty bin set is above the measurement limit over the records. */
export function aboveLimit(records, bins) {
    if (!bins.length) return false;
    const { sum, variance } = limitSums(records, bins);
    return sum > 2 * Math.sqrt(variance);
}

/** Score classes C1-C3 active at L: non-empty and above the limit over the (a) records pooled. */
export const activeClasses = (aRecords, bins) => bins.score.map(classBins => aboveLimit(aRecords, classBins));

/** Whether no score class is active or the active classes hold under half of the mean distortion power of all classes. */
export function isBelowLimit(aRecords, bins, active) {
    let activePower = 0;
    let allPower = 0;
    bins.score.forEach((classBins, c) => {
        let sum = 0;
        for (const { Y, Pn } of aRecords) {
            for (const f of classBins) {
                const excess = power(Y, f) - Pn[f];
                if (excess > 0) sum += excess;
            }
        }
        sum /= aRecords.length;
        allPower += sum;
        if (active[c]) activePower += sum;
    });
    return !active.some(Boolean) || activePower < 0.5 * allPower;
}

// --------------------------------------------------------------- section activity

// Corrector section centres: 16 low, then 6 high. State 2i is the peak
// state of section i, 2i + 1 its quadrature state.
const SECTION_HZ = [...Array.from({ length: 16 }, (_, i) => 20 * 2 ** (i / 3)), 580, 1050, 1900, 3450, 6200, 7800];

// States [a, b] of the model terms in asset order; terms 990..1181 are the
// second sum on the states of terms 528..719.
const TERM_STATES = (() => {
    const terms = [];
    for (let a = 0; a < 32; a++) for (let b = a; b < 32; b++) terms.push([a, b]);
    for (let a = 0; a < 32; a++) for (let j = 0; j < 6; j++) terms.push([a, 32 + 2 * j]);
    for (let a = 0; a < 32; a++) for (let j = 0; j < 6; j++) terms.push([a, 33 + 2 * j]);
    for (let c = 0; c < 12; c++) for (let e = c; e < 12; e++) terms.push([32 + c, 32 + e]);
    return terms;
})();
const DIRECT_TERMS = 990;
const SECOND_SOURCE = 528;
const SECOND_COUNT = 192;
const MIC_COLUMN = 1374;

/**
 * TERM_MASK (Uint8Array(1376)): 1 for a Gram column whose two states belong to active
 * sections, judged from the lowest and highest excited line of the channel; the microphone
 * column is always on and the carrier column 0.
 */
export function termMask(lowestHz, highestHz) {
    const third = 2 ** (1 / 3);
    const active = SECTION_HZ.map(f => f >= lowestHz / third && f <= highestHz * third);
    const on = ([a, b]) => (active[a >> 1] && active[b >> 1] ? 1 : 0);
    const mask = new Uint8Array(MIC_COLUMN + 2);
    for (let c = 0; c < DIRECT_TERMS; c++) mask[c] = on(TERM_STATES[c]);
    for (let i = 0; i < SECOND_COUNT; i++) {
        const value = on(TERM_STATES[SECOND_SOURCE + i]);
        mask[DIRECT_TERMS + i] = value;
        mask[DIRECT_TERMS + SECOND_COUNT + i] = value;
    }
    mask[MIC_COLUMN] = 1;
    return mask;
}

/** Lowest and highest excited line over the drives' excitation masks. */
export function excitedRange(excitedMasks) {
    let lowest = Infinity;
    let highest = -Infinity;
    for (const excited of excitedMasks) {
        for (let f = 0; f <= MAX_BIN; f++) {
            if (!excited[f]) continue;
            if (f < lowest) lowest = f;
            if (f > highest) highest = f;
        }
    }
    return [lowest, highest];
}

// ------------------------------------------------------------------ row weights

export const medianOf = values => {
    const sorted = Float64Array.from(values).sort();
    const n = sorted.length;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};

/**
 * Row weights of one (a) record: wp per row (Float64Array(3983), 0 outside the fit classes) and
 * wq² = μ/P_ref with P_ref the power of the fit classes above the limit in this record (wq² is 0 when
 * P_ref is 0). A class below the limit keeps its rows: they show that the distortion there is small.
 */
export function takeWeights(record, bins) {
    const wp = new Float64Array(ROW_COUNT);
    let pRef = 0;
    for (const classBins of bins.fit) {
        const above = aboveLimit([record], classBins);
        const floor = 0.25 * medianOf(Array.from(classBins, f => record.Pn[f]));
        let norm = 0;
        for (const f of classBins) {
            const p = power(record.Y, f);
            const pn = record.Pn[f] > floor ? record.Pn[f] : floor;
            norm += p / pn;
            if (above) pRef += p;
        }
        norm = Math.sqrt(norm);
        for (const f of classBins) {
            const pn = record.Pn[f] > floor ? record.Pn[f] : floor;
            wp[f / 2 - 18] = 1 / Math.sqrt(pn) / norm;
        }
    }
    return { wp, wq2: pRef > 0 ? PENALTY_MU / pRef : 0 };
}

/**
 * Per-row seed sums for the two takes [{ record, wp, wq2 }] of a seed: ROWW = sqrt(Dd),
 * CARRIER = u/Dd (interleaved, 0 where Dd is 0) and yy.
 */
export function seedRows(takes, g, qRow) {
    const Dd = new Float64Array(ROW_COUNT);
    const u = new Float64Array(2 * ROW_COUNT);
    let yy = 0;
    for (const { record, wp, wq2 } of takes) {
        for (let r = 0; r < ROW_COUNT; r++) {
            const f = rowFrequency(r);
            const gr = g[2 * f], gi = g[2 * f + 1];
            const w2 = wp[r] * wp[r];
            const yr = record.Y[2 * f], yi = record.Y[2 * f + 1];
            Dd[r] += (gr * gr + gi * gi) * (w2 + (r >= qRow ? wq2 : 0));
            u[2 * r] += w2 * (gr * yr + gi * yi);
            u[2 * r + 1] += w2 * (gr * yi - gi * yr);
            yy += w2 * (yr * yr + yi * yi);
        }
    }
    const rowWeight = new Float64Array(ROW_COUNT);
    const carrier = new Float64Array(2 * ROW_COUNT);
    for (let r = 0; r < ROW_COUNT; r++) {
        if (!(Dd[r] > 0)) continue;
        rowWeight[r] = Math.sqrt(Dd[r]);
        carrier[2 * r] = u[2 * r] / Dd[r];
        carrier[2 * r + 1] = u[2 * r + 1] / Dd[r];
    }
    return { rowWeight, carrier, yy };
}
