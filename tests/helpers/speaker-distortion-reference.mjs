// Float64 reference of the speaker distortion identification (plan-algorithm §2-§7).
// Everything is computed literally and in double precision: states by the section
// recursion, columns by a direct DFT or by the exact reductions of §5.4, per-take complex
// systems, ridge solves by plain Cholesky and the figures of §6-§7. It is written for
// clarity, not speed; a full 1376-column identification is far too slow here, so callers
// pass a subset of Gram columns where noted.
//
// Layouts: spectra X, Y and g are interleaved Float64Array(2 * 8001) over bins 0..8000 Hz
// (re, im); Pn is Float64Array(8001). Column and row vectors are interleaved over a list
// of row frequencies (`freqs`, even bins 36..8000 Hz). Matrices are row-major Float64Array.
import { resampleWindowedSinc } from '../../js/utils/measurement-dsp/resample.js';
import { BAND_EDGES, N_BANDS, POWER_LENGTH, REF_LENGTH, SCALES } from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';

export const N = 48000;
export const RMS = 0.1;
export const MAX_BIN = 8000;
export const ROW_COUNT = 3983;
export const DIRECT_TERMS = 990;
export const MODEL_TERMS = 1182;
export const LOW_HIGH_PEAK_BASE = 528;
export const SHORT_SECOND_BASE = 990;
export const LONG_SECOND_BASE = 1182;
export const MIC_COLUMN = 1374;
export const CARRIER_COLUMN = 1375;
export const TAP_HALF_LENGTH = Object.freeze({ short: 30, long: 120 });
export const LAMBDA_GRID = Object.freeze(Array.from({ length: 23 }, (_, i) => 10 ** ((i - 16) / 4)));
export const PENALTY_MU = 30;
export const MIC_RIDGE = 1e-6;
export const MIC_WARNING_DB = -19;
export const E_SCALE = 10 ** (-12 / 20);
export const SCALE_VALUES = Object.freeze(SCALES.map(entry => entry.s));

export const rowFrequency = r => 2 * (r + 18);
export const rowOf = f => f / 2 - 18;
export const ALL_ROWS = Int32Array.from({ length: ROW_COUNT }, (_, r) => rowFrequency(r));

// Corrector sections (plan-plugin §9.1): 16 low sections, then 6 high sections. State
// 2i is the peak state of section i, 2i + 1 its quadrature state, so states 0..31 are the
// low states a and 32..43 the high states 32 + c.
export const SECTIONS = Object.freeze([
    ...Array.from({ length: 16 }, (_, i) => Object.freeze({ f: 20 * 2 ** (i / 3), q: 2.15 })),
    ...[580, 1050, 1900, 3450, 6200, 7800].map(f => Object.freeze({ f, q: 1.4 }))
]);
export const STATE_COUNT = 44;
export const sectionOfState = state => state >> 1;

// Model terms in asset order (plan-plugin §9.2): [state a, state b] pairs. Terms
// 990..1181 are the second sum; they multiply the same states as terms 528..719.
export const TERMS = Object.freeze((() => {
    const terms = [];
    for (let a = 0; a < 32; a++) for (let b = a; b < 32; b++) terms.push([a, b]);
    for (let a = 0; a < 32; a++) for (let j = 0; j < 6; j++) terms.push([a, 32 + 2 * j]);
    for (let a = 0; a < 32; a++) for (let j = 0; j < 6; j++) terms.push([a, 33 + 2 * j]);
    for (let c = 0; c < 12; c++) for (let e = c; e < 12; e++) terms.push([32 + c, 32 + e]);
    for (let a = 0; a < 32; a++) for (let j = 0; j < 6; j++) terms.push([a, 32 + 2 * j]);
    return terms;
})());

/**
 * What Gram column `column` (0..1374) holds: a direct term, a second-sum term of one
 * length (its asset index and the direct term it rotates), or the microphone.
 */
export function gramColumnInfo(column) {
    if (column < DIRECT_TERMS) return { kind: 'direct', term: column };
    if (column < LONG_SECOND_BASE) {
        return { kind: 'second', length: 'short', term: column, source: column - SHORT_SECOND_BASE + LOW_HIGH_PEAK_BASE };
    }
    if (column < MIC_COLUMN) {
        const i = column - LONG_SECOND_BASE;
        return { kind: 'second', length: 'long', term: SHORT_SECOND_BASE + i, source: LOW_HIGH_PEAK_BASE + i };
    }
    if (column === MIC_COLUMN) return { kind: 'mic' };
    throw new RangeError('Invalid Gram column');
}

/** The Gram columns of length ℓ (J_S or J_Long, §5.6): model columns in asset order, microphone last. */
export function lengthColumns(length) {
    const second = length === 'short' ? SHORT_SECOND_BASE : LONG_SECOND_BASE;
    return Int32Array.from({ length: MODEL_TERMS + 1 }, (_, i) => (i < DIRECT_TERMS ? i
        : i < MODEL_TERMS ? second + i - DIRECT_TERMS : MIC_COLUMN));
}

// ---------------------------------------------------------------------------------- FFT

const COS_N = Float64Array.from({ length: N }, (_, k) => Math.cos(2 * Math.PI * k / N));
const SIN_N = Float64Array.from({ length: N }, (_, k) => Math.sin(2 * Math.PI * k / N));
const fftPlans = new Map();

function fftPlan(n) {
    let plan = fftPlans.get(n);
    if (plan) return plan;
    const factors = [];
    let rest = n;
    for (const p of [4, 2, 3, 5]) while (rest % p === 0) { factors.push(p); rest /= p; }
    if (rest !== 1) throw new RangeError('FFT size must factor into 2, 3 and 5');
    plan = {
        factors,
        cos: Float64Array.from({ length: n }, (_, k) => Math.cos(2 * Math.PI * k / n)),
        sin: Float64Array.from({ length: n }, (_, k) => Math.sin(2 * Math.PI * k / n)),
        tr: new Float64Array(5),
        ti: new Float64Array(5)
    };
    fftPlans.set(n, plan);
    return plan;
}

// Mixed-radix decimation in time: transform the p strided sub-sequences into consecutive
// blocks of `out`, then combine them in place with twiddles W_n^(rk) and a p-point DFT.
function fftStage(inRe, inIm, offset, stride, n, outRe, outIm, outOffset, plan, level, total) {
    if (n === 1) {
        outRe[outOffset] = inRe[offset];
        outIm[outOffset] = inIm[offset];
        return;
    }
    const p = plan.factors[level];
    const m = n / p;
    for (let r = 0; r < p; r++) {
        fftStage(inRe, inIm, offset + r * stride, stride * p, m, outRe, outIm, outOffset + r * m, plan, level + 1, total);
    }
    const { cos, sin, tr, ti } = plan;
    const step = total / n;
    const pStep = total / p;
    for (let k = 0; k < m; k++) {
        for (let r = 0; r < p; r++) {
            const index = outOffset + r * m + k;
            const t = r * k * step;
            const c = cos[t], s = sin[t];
            const xr = outRe[index], xi = outIm[index];
            tr[r] = xr * c + xi * s;
            ti[r] = xi * c - xr * s;
        }
        for (let q = 0; q < p; q++) {
            let sr = 0, si = 0;
            for (let r = 0; r < p; r++) {
                const t = ((r * q) % p) * pStep;
                const c = cos[t], s = sin[t];
                sr += tr[r] * c + ti[r] * s;
                si += ti[r] * c - tr[r] * s;
            }
            outRe[outOffset + k + q * m] = sr;
            outIm[outOffset + k + q * m] = si;
        }
    }
}

/** Unnormalized forward DFT Σ x[n]·e^(−j2πkn/n) of a complex sequence (length 2^a·3^b·5^c). */
export function fftComplex(re, im = new Float64Array(re.length)) {
    const n = re.length;
    const plan = fftPlan(n);
    const outRe = new Float64Array(n);
    const outIm = new Float64Array(n);
    fftStage(re, im, 0, 1, n, outRe, outIm, 0, plan, 0, n);
    return { re: outRe, im: outIm };
}

/** DFT(x)/N on bins 0..8000 of one 48 kHz period, interleaved. */
export function spectrum(x) {
    const { re, im } = fftComplex(Float64Array.from(x));
    const out = new Float64Array(2 * (MAX_BIN + 1));
    for (let k = 0; k <= MAX_BIN; k++) {
        out[2 * k] = re[k] / N;
        out[2 * k + 1] = im[k] / N;
    }
    return out;
}

/** One 48 kHz period x[n] = Σ_k X[k]·e^(+j2πkn/N) over the conjugate-symmetric spectrum of X (bins 0..8000). */
export function synthesize(X) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re[0] = X[0];
    for (let k = 1; k <= MAX_BIN; k++) {
        re[k] = X[2 * k];
        im[k] = -X[2 * k + 1];
        re[N - k] = X[2 * k];
        im[N - k] = X[2 * k + 1];
    }
    // x = conj(FFT(conj(Z))) and x is real.
    return fftComplex(re, im).re;
}

/** Direct 48000-point DFT(signal)[f]/N at the requested frequencies, interleaved. */
export function dftRows(signal, freqs) {
    const out = new Float64Array(2 * freqs.length);
    for (let r = 0; r < freqs.length; r++) {
        const f = freqs[r];
        let re = 0, im = 0, index = 0;
        for (let n = 0; n < N; n++) {
            re += signal[n] * COS_N[index];
            im -= signal[n] * SIN_N[index];
            index += f;
            if (index >= N) index -= N;
        }
        out[2 * r] = re / N;
        out[2 * r + 1] = im / N;
    }
    return out;
}

/** The 24000 fold (§5.4): DFT(p)[f]/N at even f from one 24000-point FFT of p[n] + p[n + 24000]. */
export function foldRows(signal, freqs) {
    const half = N / 2;
    const u = new Float64Array(half);
    for (let n = 0; n < half; n++) u[n] = signal[n] + signal[n + half];
    const { re, im } = fftComplex(u);
    const out = new Float64Array(2 * freqs.length);
    for (let r = 0; r < freqs.length; r++) {
        out[2 * r] = re[freqs[r] / 2] / N;
        out[2 * r + 1] = im[freqs[r] / 2] / N;
    }
    return out;
}

/** The low × low half-length form (§5.4) of DFT(low_a·low_b)[f]/N at even f; both states held. */
export function halfLengthRows(lowA, lowB, freqs) {
    const quarter = N / 4;
    const u = new Float64Array(quarter);
    for (let m = 0; m < quarter; m++) u[m] = lowA[2 * m] * lowB[2 * m] + lowA[2 * (m + quarter)] * lowB[2 * (m + quarter)];
    const { re, im } = fftComplex(u);
    const out = new Float64Array(2 * freqs.length);
    for (let r = 0; r < freqs.length; r++) {
        const k = freqs[r] / 2;
        // (1 + e^(−j2πk/24000)); k/24000 = 2k/48000.
        const index = (2 * k) % N;
        const fr = 1 + COS_N[index], fi = -SIN_N[index];
        out[2 * r] = (fr * re[k] - fi * im[k]) / N;
        out[2 * r + 1] = (fr * im[k] + fi * re[k]) / N;
    }
    return out;
}

// ---------------------------------------------------------------------------- §2 signals

/** Deterministic uniform [0, 1) generator of §2.1. */
export function mulberry32(state) {
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Whether seed `seed` gets the clip-and-restore iteration of §2.3. */
export const iteratesPhases = seed => seed !== 8 && seed !== 9;

/**
 * COMB drive of §2.2-§2.3 at unit (arbitrary) scale: { seed, X, excited }. Phases are
 * drawn for every present line before the Sweep Bandwidth drop.
 */
export function combDrive(seed, { lowHz = 20, highHz = 20000 } = {}) {
    const random = mulberry32(2600 + seed);
    const present = new Uint8Array(MAX_BIN + 1);
    for (let group = 0; group < 998; group++) {
        const size = group === 997 ? 2 : 4;
        const first = 21 + 8 * group;
        for (let i = 0; i < size; i++) present[first + 2 * i] = 1;
        present[first + 2 * Math.floor(random() * size)] = 0;
    }
    const phase = new Float64Array(MAX_BIN + 1);
    let lowPower = 0, highCount = 0;
    for (let k = 21; k < MAX_BIN; k += 2) {
        if (!present[k]) continue;
        phase[k] = 2 * Math.PI * random();
        if (k <= 499) lowPower += (k <= 120 ? 1 : 120 / k) ** 2;
        else highCount++;
    }
    const highAmplitude = Math.sqrt(lowPower / (4 * highCount));
    const excited = new Uint8Array(MAX_BIN + 1);
    const target = new Float64Array(MAX_BIN + 1);
    for (let k = 21; k < MAX_BIN; k += 2) {
        if (!present[k] || k < lowHz || k > highHz) continue;
        excited[k] = 1;
        target[k] = k <= 120 ? 1 : k <= 499 ? 120 / k : highAmplitude;
    }
    const X = new Float64Array(2 * (MAX_BIN + 1));
    for (let k = 0; k <= MAX_BIN; k++) {
        if (!excited[k]) continue;
        X[2 * k] = target[k] * Math.cos(phase[k]);
        X[2 * k + 1] = target[k] * Math.sin(phase[k]);
    }
    if (iteratesPhases(seed)) {
        for (let iteration = 0; iteration < 100; iteration++) {
            const x = synthesize(X);
            let peak = 0;
            for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(x[n]));
            const clip = 0.75 * peak;
            for (let n = 0; n < N; n++) x[n] = Math.min(clip, Math.max(-clip, x[n]));
            const clipped = spectrum(x);
            for (let k = 0; k <= MAX_BIN; k++) {
                if (!excited[k]) continue;
                const re = clipped[2 * k], im = clipped[2 * k + 1];
                const magnitude = Math.hypot(re, im);
                if (magnitude > 0) {
                    X[2 * k] = target[k] * re / magnitude;
                    X[2 * k + 1] = target[k] * im / magnitude;
                }
            }
        }
    }
    return { seed, X, excited };
}

const CHIRP_SECONDS = 0.25;
const GAP_SECONDS = 0.25;
const CHIRP_FADE = 480;
const resampleTo = (signal, fs) => (fs === N ? signal : Float64Array.from(resampleWindowedSinc(signal, N, fs)));

/**
 * Device-rate call of §2.4: chirp, gap and K + 2 periods of the drive, scaled so that the
 * peak of the K averaged periods equals `targetDbfs`. Returns the played samples, the
 * stored X (X_unit × the scale factor), the device-rate chirp and K.
 */
export function buildCall(drive, { targetDbfs, K = 7, fsDev = N, lowHz = 20, highHz = 20000 }) {
    const x = synthesize(drive.X);
    const chirpLength = CHIRP_SECONDS * N;
    const start = chirpLength + GAP_SECONDS * N;
    const total = start + (K + 2) * N;
    const periodic = new Float64Array(total);
    for (let i = 0; i < K + 2; i++) {
        for (let n = 0; n < N; n++) {
            const fade = i === 0 ? 0.5 - 0.5 * Math.cos(Math.PI * n / N)
                : i === K + 1 ? 0.5 + 0.5 * Math.cos(Math.PI * n / N) : 1;
            periodic[start + i * N + n] = x[n] * fade;
        }
    }
    const chirp = new Float64Array(total);
    const f1 = Math.max(100, lowHz), f2 = Math.min(8000, highHz);
    const logRatio = Math.log(f2 / f1);
    for (let n = 0; n < chirpLength; n++) {
        const t = n / N;
        const fade = n < CHIRP_FADE ? 0.5 - 0.5 * Math.cos(Math.PI * n / CHIRP_FADE)
            : n >= chirpLength - CHIRP_FADE ? 0.5 - 0.5 * Math.cos(Math.PI * (chirpLength - 1 - n) / CHIRP_FADE) : 1;
        chirp[n] = fade * Math.sin(2 * Math.PI * f1 * CHIRP_SECONDS / logRatio * (Math.exp(t * logRatio / CHIRP_SECONDS) - 1));
    }
    const periodicDev = resampleTo(periodic, fsDev);
    const chirpDev = resampleTo(chirp, fsDev);
    const peakOf = (signal, from, to) => {
        let peak = 0;
        for (let n = from; n < to; n++) peak = Math.max(peak, Math.abs(signal[n]));
        return peak;
    };
    const target = 10 ** (targetDbfs / 20);
    const factor = target / peakOf(periodicDev, Math.round(1.5 * fsDev), Math.round((1.5 + K) * fsDev));
    const chirpLengthDev = Math.round(CHIRP_SECONDS * fsDev);
    const chirpFactor = target * 10 ** (-2 / 20) / peakOf(chirpDev, 0, chirpLengthDev);
    const samples = new Float32Array(periodicDev.length);
    for (let n = 0; n < samples.length; n++) samples[n] = periodicDev[n] * factor + chirpDev[n] * chirpFactor;
    return {
        samples,
        X: drive.X.map(value => value * factor),
        chirp: Float64Array.from(samples.subarray(0, chirpLengthDev)),
        K,
        fsDev
    };
}

// ----------------------------------------------------------------------- §4 preprocessing

const nextPowerOfTwo = n => 2 ** Math.ceil(Math.log2(n));

/** §4.1-§4.3: latency from the chirp correlation, then the period mean Y and its noise Pn. */
export function analyzeCall(capture, { fsDev = N, K, chirp }) {
    const window = Math.round(1.5 * fsDev);
    const size = nextPowerOfTwo(window + chirp.length);
    const a = new Float64Array(size);
    const b = new Float64Array(size);
    a.set(capture.subarray(0, Math.min(capture.length, window + chirp.length)));
    b.set(chirp);
    const A = fftComplex(a);
    const B = fftComplex(b);
    // Correlation c[lag] = Σ a[lag + n]·b[n] = IDFT(A·conj(B)); the inverse via the conjugate trick.
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let k = 0; k < size; k++) {
        re[k] = A.re[k] * B.re[k] + A.im[k] * B.im[k];
        im[k] = -(A.im[k] * B.re[k] - A.re[k] * B.im[k]);
    }
    const correlation = fftComplex(re, im).re;
    let latency = 0;
    for (let lag = 1; lag < window; lag++) if (Math.abs(correlation[lag]) > Math.abs(correlation[latency])) latency = lag;
    const blockStart = latency + Math.round(0.5 * fsDev);
    let block = capture.subarray(blockStart, blockStart + Math.round((K + 2) * fsDev));
    if (fsDev !== N) block = resampleWindowedSinc(block, fsDev, N);
    const spectra = Array.from({ length: K }, (_, i) => spectrum(block.subarray(N * (1 + i), N * (2 + i))));
    const Y = new Float64Array(2 * (MAX_BIN + 1));
    for (const Yi of spectra) for (let i = 0; i < Y.length; i++) Y[i] += Yi[i] / K;
    const Pn = new Float64Array(MAX_BIN + 1);
    for (const Yi of spectra) {
        for (let k = 0; k <= MAX_BIN; k++) Pn[k] += (Yi[2 * k] - Y[2 * k]) ** 2 + (Yi[2 * k + 1] - Y[2 * k + 1]) ** 2;
    }
    for (let k = 0; k <= MAX_BIN; k++) Pn[k] /= K * (K - 1);
    return { latency, Y, Pn };
}

const wrapPhase = d => d - 2 * Math.PI * Math.ceil((d - Math.PI) / (2 * Math.PI));

/**
 * Linear response g of §4.5 from records { X, excited, Y, Pn } (the 12 (a) records), or
 * null when no bin is measured.
 */
export function estimateG(records) {
    const measured = [];
    for (let f = 0; f <= MAX_BIN; f++) {
        let nr = 0, ni = 0, den = 0;
        for (const { X, excited, Y, Pn } of records) {
            if (!excited[f] || !(Y[2 * f] ** 2 + Y[2 * f + 1] ** 2 >= 25 * Pn[f])) continue;
            const xr = X[2 * f], xi = X[2 * f + 1], yr = Y[2 * f], yi = Y[2 * f + 1];
            nr += xr * yr + xi * yi;
            ni += xr * yi - xi * yr;
            den += xr * xr + xi * xi;
        }
        if (den > 0) measured.push({ f, re: nr / den, im: ni / den });
    }
    if (!measured.length) return null;
    let phase = 0;
    measured.forEach((point, i) => {
        const angle = Math.atan2(point.im, point.re);
        phase = i === 0 ? angle : phase + wrapPhase(angle - measured[i - 1].angle);
        point.angle = angle;
        point.phase = phase;
        point.logMagnitude = Math.log(Math.hypot(point.re, point.im));
    });
    const g = new Float64Array(2 * (MAX_BIN + 1));
    let next = 0;
    for (let f = 0; f <= MAX_BIN; f++) {
        while (next < measured.length && measured[next].f < f) next++;
        let logMagnitude, phaseAt;
        if (next === 0 || next === measured.length || measured[next].f === f) {
            const point = measured[next === measured.length ? next - 1 : next];
            ({ logMagnitude, phase: phaseAt } = point);
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

/** Mains bins of §4.6: f ≤ 1001 Hz within 1 Hz of a multiple of 50 or 60 Hz. */
export function isMains(f) {
    if (f > 1001) return false;
    for (const base of [50, 60]) {
        const rest = f % base;
        if (rest <= 1 || base - rest <= 1) return true;
    }
    return false;
}

// Half-open [lo, hi), a range ending at 8000 Hz including 8000; `upper` clips to f < upper when below 8000.
const inRange = (f, lo, hi, upper = MAX_BIN) => {
    const top = upper < MAX_BIN && upper < hi ? upper : hi;
    return f >= lo && (f < top || (top === MAX_BIN && f === MAX_BIN));
};
const evenBins = (lo, hi, upper) => {
    const bins = [];
    for (let f = Math.ceil(lo) + (Math.ceil(lo) & 1); f <= MAX_BIN; f += 2) if (inRange(f, lo, hi, upper) && !isMains(f)) bins.push(f);
    return Int32Array.from(bins);
};
const bandRange = i => [BAND_EDGES[i], BAND_EDGES[i + 1]];

export const FIT_CLASS_RANGES = Object.freeze([[35, 100], [100, 400], [400, 2000], [2000, 8000]]);
export const SCORE_CLASS_RANGES = Object.freeze([[50, 100], [100, 400], [400, 2000]]);

/**
 * Even-bin sets of a channel at an Upper Limit (§4.6, §7.1): fit classes (clipped, empty
 * ones dropped), score classes C1-C3 (clipped, possibly empty), the unclipped even
 * 50 Hz-8 kHz set, the 50 chart bands, the microphone-warning set S (§7.7) and the penalty
 * rows Q (row indices).
 */
export function binSets(upperLimitHz = MAX_BIN) {
    const q = [];
    if (upperLimitHz < MAX_BIN) for (let r = 0; r < ROW_COUNT; r++) if (rowFrequency(r) >= upperLimitHz) q.push(r);
    return {
        upperLimitHz,
        fit: FIT_CLASS_RANGES.map(([lo, hi]) => evenBins(lo, hi, upperLimitHz)).filter(bins => bins.length),
        score: SCORE_CLASS_RANGES.map(([lo, hi]) => evenBins(lo, hi, upperLimitHz)),
        even8k: evenBins(50, MAX_BIN),
        bands: Array.from({ length: N_BANDS }, (_, i) => evenBins(...bandRange(i))),
        mic: evenBins(50, 2000),
        q: Int32Array.from(q)
    };
}

/** Non-excited, non-mains odd bins of one drive: the 50 Hz-8 kHz set and the chart bands. */
export function oddSets(excited) {
    const odd = (lo, hi) => {
        const bins = [];
        for (let f = Math.ceil(lo) + 1 - (Math.ceil(lo) & 1); f <= MAX_BIN; f += 2) if (inRange(f, lo, hi) && !excited[f] && !isMains(f)) bins.push(f);
        return Int32Array.from(bins);
    };
    return { odd8k: odd(50, MAX_BIN), bands: Array.from({ length: N_BANDS }, (_, i) => odd(...bandRange(i))) };
}

const power = (Y, f) => Y[2 * f] ** 2 + Y[2 * f + 1] ** 2;

/** Σ(|Y|² − Pn) and the limit variance Σ(2·p·Pn + Pn²) of a bin set over records { Y, Pn }. */
export function limitSums(records, bins) {
    let sum = 0, variance = 0;
    for (const { Y, Pn } of records) {
        for (const f of bins) {
            const excess = power(Y, f) - Pn[f];
            sum += excess;
            variance += 2 * Math.max(excess, 0) * Pn[f] + Pn[f] * Pn[f];
        }
    }
    return { sum, variance };
}

export function aboveLimit(records, bins) {
    if (!bins.length) return false;
    const { sum, variance } = limitSums(records, bins);
    return sum > 2 * Math.sqrt(variance);
}

/** Score classes C1-C3 active at L (§4.6): non-empty and above the limit over the (a) records pooled. */
export const activeClasses = (aRecords, bins) => bins.score.map(classBins => aboveLimit(aRecords, classBins));

/** `belowLimit` of §5.11. */
export function isBelowLimit(aRecords, bins, active) {
    let activePower = 0, allPower = 0;
    bins.score.forEach((classBins, c) => {
        let sum = 0;
        for (const { Y, Pn } of aRecords) for (const f of classBins) sum += Math.max(power(Y, f) - Pn[f], 0);
        sum /= aRecords.length;
        allPower += sum;
        if (active[c]) activePower += sum;
    });
    return !active.some(Boolean) || activePower < 0.5 * allPower;
}

/** Section activity of §4.6 from the lowest and highest excited line of the channel. */
export function activeSections(lowestHz, highestHz) {
    const third = 2 ** (1 / 3);
    return SECTIONS.map(({ f }) => f >= lowestHz / third && f <= highestHz * third);
}

/** Whether Gram column `column` uses a state of an inactive section (§5.7). */
export function columnInactive(column, sectionsActive) {
    const info = gramColumnInfo(column);
    if (info.kind === 'mic') return false;
    const [a, b] = TERMS[info.kind === 'direct' ? info.term : info.source];
    return !sectionsActive[sectionOfState(a)] || !sectionsActive[sectionOfState(b)];
}

// --------------------------------------------------------------------- §5 identification

/** iirpeak design of plan-plugin §9.1 at 48 kHz: b0, a1, a2 and the quadrature scale κq. */
export function sectionCoefficients({ f, q }) {
    const w0 = 2 * Math.PI * f / N;
    const beta = Math.tan(w0 / (2 * q));
    const G = 1 / (1 + beta);
    const a1 = -2 * G * Math.cos(w0);
    const a2 = 2 * G - 1;
    const re = 1 + a1 * Math.cos(w0) + a2 * Math.cos(2 * w0);
    const im = -a1 * Math.sin(w0) - a2 * Math.sin(2 * w0);
    return { b0: 1 - G, a1, a2, kq: Math.hypot(re, im) };
}

/** The 44 corrector states of §5.1 for one periodic 48 kHz period x (third of three periods; low states held). */
export function correctorStates(x) {
    const states = Array.from({ length: STATE_COUNT }, () => new Float64Array(N));
    SECTIONS.forEach((section, i) => {
        const { b0, a1, a2, kq } = sectionCoefficients(section);
        const peak = states[2 * i], quadrature = states[2 * i + 1];
        let v1 = 0, v2 = 0;
        for (let period = 0; period < 3; period++) {
            for (let n = 0; n < N; n++) {
                const v = x[n] / RMS - a1 * v1 - a2 * v2;
                if (period === 2) {
                    peak[n] = b0 * (v - v2);
                    quadrature[n] = kq * v1;
                }
                v2 = v1;
                v1 = v;
            }
        }
    });
    for (let a = 0; a < 32; a++) for (let n = 0; n < N; n += 2) states[a][n + 1] = states[a][n];
    return states;
}

/** Product signal p_j of model term j (asset order). */
export function termProduct(states, term) {
    const [a, b] = TERMS[term];
    const sa = states[a], sb = states[b];
    const p = new Float64Array(N);
    for (let n = 0; n < N; n++) p[n] = sa[n] * sb[n];
    return p;
}

function besselI0(x) {
    const h = x / 2;
    let sum = 1, term = 1;
    for (let k = 1; ; k++) {
        term *= (h / k) * (h / k);
        sum += term;
        if (term < 1e-17 * sum) return sum;
    }
}

const kaiser = (m, d) => besselI0(4.3 * Math.sqrt(1 - (m / d) ** 2)) / besselI0(4.3);

/** 90° taps h[m], m = −d…d (index m + d), of plan-plugin §9.4 at 48 kHz. */
export function ninetyTaps(d) {
    const taps = new Float64Array(2 * d + 1);
    for (let m = 1; m <= d; m += 2) {
        const h = -2 * kaiser(m, d) / (Math.PI * m);
        taps[d + m] = h;
        taps[d - m] = -h;
    }
    return taps;
}

/** Hi_ℓ(f) of §5.3 at each requested frequency (H_ℓ = j·Hi_ℓ). */
export function hiRows(d, freqs) {
    const out = new Float64Array(freqs.length);
    for (let r = 0; r < freqs.length; r++) {
        let sum = 0;
        for (let m = 1; m <= d; m += 2) sum += kaiser(m, d) * Math.sin(2 * Math.PI * freqs[r] * m / N) / m;
        out[r] = 4 / Math.PI * sum;
    }
    return out;
}

/** Circular convolution over the period with taps indexed m + d: y[n] = Σ_m h[m]·p[n − m]. */
export function circularFilter(signal, taps) {
    const d = (taps.length - 1) / 2;
    const out = new Float64Array(N);
    for (let m = -d; m <= d; m++) {
        const h = taps[m + d];
        if (h === 0) continue;
        for (let n = 0; n < N; n++) out[n] += h * signal[(n - m + N) % N];
    }
    return out;
}

/** Second-sum column from its direct column: (re, im) → (−Hi·im, Hi·re). */
export function rotateSecond(direct, hi) {
    const out = new Float64Array(direct.length);
    for (let r = 0; r < hi.length; r++) {
        out[2 * r] = -hi[r] * direct[2 * r + 1];
        out[2 * r + 1] = hi[r] * direct[2 * r];
    }
    return out;
}

/** Microphone column of §5.5: M (not divided by g) and the Gram column M/g on the rows. */
export function micColumn(drive, g, freqs, { direct = false } = {}) {
    const Z = new Float64Array(2 * (MAX_BIN + 1));
    for (let f = 0; f <= MAX_BIN; f++) {
        if (!drive.excited[f]) continue;
        Z[2 * f] = g[2 * f] * drive.X[2 * f] - g[2 * f + 1] * drive.X[2 * f + 1];
        Z[2 * f + 1] = g[2 * f] * drive.X[2 * f + 1] + g[2 * f + 1] * drive.X[2 * f];
    }
    const y = synthesize(Z);
    for (let n = 0; n < N; n++) y[n] *= y[n];
    const M = direct ? dftRows(y, freqs) : foldRows(y, freqs);
    const column = new Float64Array(M.length);
    for (let r = 0; r < freqs.length; r++) {
        const f = freqs[r];
        const gr = g[2 * f], gi = g[2 * f + 1], den = gr * gr + gi * gi;
        column[2 * r] = (M[2 * r] * gr + M[2 * r + 1] * gi) / den;
        column[2 * r + 1] = (M[2 * r + 1] * gr - M[2 * r] * gi) / den;
    }
    return { M, column };
}

/**
 * Gram columns `columns` (indices 0..1374) of one drive on the rows `freqs`, as
 * interleaved vectors. method 'direct' uses the direct DFT for every direct term;
 * 'fast' the half-length form for low × low and the 24000 fold otherwise. Second-sum
 * columns are rotated from their direct column. Also returns M when the microphone column
 * is requested.
 */
export function driveColumns(drive, g, { states, freqs = ALL_ROWS, columns, method = 'fast' }) {
    const directCache = new Map();
    const direct = term => {
        let column = directCache.get(term);
        if (!column) {
            const [a, b] = TERMS[term];
            column = method === 'direct' ? dftRows(termProduct(states, term), freqs)
                : b < 32 ? halfLengthRows(states[a], states[b], freqs)
                    : foldRows(termProduct(states, term), freqs);
            for (let i = 0; i < column.length; i++) column[i] *= RMS;
            directCache.set(term, column);
        }
        return column;
    };
    const hi = { short: null, long: null };
    let M = null;
    const out = Array.from(columns, column => {
        const info = gramColumnInfo(column);
        if (info.kind === 'direct') return direct(info.term);
        if (info.kind === 'second') {
            hi[info.length] ??= hiRows(TAP_HALF_LENGTH[info.length], freqs);
            return rotateSecond(direct(info.source), hi[info.length]);
        }
        const mic = micColumn(drive, g, freqs, { direct: method === 'direct' });
        M = mic.M;
        return mic.column;
    });
    return { columns: out, M };
}

/** Columns scaled by a factor (the (e) columns are the (d) columns × 10^(−12/20)). */
export const scaleColumns = (columns, factor) => columns.map(column => column.map(value => value * factor));

/**
 * Row weights of one (a) record (§5.6) on the rows of `freqs`: wp per row (0 outside the
 * fit classes above the limit in this record), wq² = μ/P_ref and P_ref.
 */
export function takeWeights(record, bins, freqs = ALL_ROWS) {
    const wpByFrequency = new Map();
    let pRef = 0;
    for (const classBins of bins.fit) {
        if (!aboveLimit([record], classBins)) continue;
        const sorted = Array.from(classBins, f => record.Pn[f]).sort((a, b) => a - b);
        const n = sorted.length;
        const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
        const beta = Array.from(classBins, f => 1 / Math.sqrt(Math.max(record.Pn[f], 0.25 * median)));
        let norm = 0;
        classBins.forEach((f, i) => { norm += beta[i] * beta[i] * power(record.Y, f); pRef += power(record.Y, f); });
        norm = Math.sqrt(norm);
        classBins.forEach((f, i) => wpByFrequency.set(f, beta[i] / norm));
    }
    return {
        wp: Float64Array.from(freqs, f => wpByFrequency.get(f) ?? 0),
        wq2: pRef > 0 ? PENALTY_MU / pRef : 0,
        pRef
    };
}

/** Penalty mask over `freqs`: rows of Q (f ≥ Upper Limit below 8 kHz). */
export const penaltyMask = (freqs, upperLimitHz) => Uint8Array.from(freqs, f => (upperLimitHz < MAX_BIN && f >= upperLimitHz ? 1 : 0));

/** Per-row seed sums of §5.6 for takes [{ record, wp, wq2 }]: Dd, u (interleaved) and yy. */
export function seedRowSums(takes, g, freqs, qMask) {
    const Dd = new Float64Array(freqs.length);
    const u = new Float64Array(2 * freqs.length);
    let yy = 0;
    for (const { record, wp, wq2 } of takes) {
        for (let r = 0; r < freqs.length; r++) {
            const f = freqs[r];
            const gr = g[2 * f], gi = g[2 * f + 1], g2 = gr * gr + gi * gi;
            const w2 = wp[r] * wp[r];
            const yr = record.Y[2 * f], yi = record.Y[2 * f + 1];
            Dd[r] += g2 * (w2 + (qMask[r] ? wq2 : 0));
            u[2 * r] += w2 * (gr * yr + gi * yi);
            u[2 * r + 1] += w2 * (gr * yi - gi * yr);
            yy += w2 * (yr * yr + yi * yi);
        }
    }
    return { Dd, u, yy };
}

const withPenaltyZero = (column, isMic, qMask) => {
    if (!isMic) return column;
    const out = Float64Array.from(column);
    for (let r = 0; r < qMask.length; r++) if (qMask[r]) { out[2 * r] = 0; out[2 * r + 1] = 0; }
    return out;
};

/**
 * One seed's Gram (§5.6) through the stacked real layout: C̃ = sqrt(Dd)·C° plus the rhs
 * carrier column u/Dd. Returns N (m × m), b (from the carrier row) and the full
 * (m + 1) × (m + 1) Gram including the carrier.
 */
export function seedGram(columns, micPosition, qMask, { Dd, u }) {
    const m = columns.length;
    const rows = Dd.length;
    const stacked = columns.map((column, j) => {
        const c = withPenaltyZero(column, j === micPosition, qMask);
        const v = new Float64Array(2 * rows);
        for (let r = 0; r < rows; r++) {
            const s = Math.sqrt(Dd[r]);
            v[r] = s * c[2 * r];
            v[rows + r] = s * c[2 * r + 1];
        }
        return v;
    });
    const carrier = new Float64Array(2 * rows);
    for (let r = 0; r < rows; r++) {
        if (!(Dd[r] > 0)) continue;
        const s = Math.sqrt(Dd[r]);
        carrier[r] = s * u[2 * r] / Dd[r];
        carrier[rows + r] = s * u[2 * r + 1] / Dd[r];
    }
    stacked.push(carrier);
    const n = m + 1;
    const gram = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
            const a = stacked[i], b = stacked[j];
            let sum = 0;
            for (let k = 0; k < a.length; k++) sum += a[k] * b[k];
            gram[i * n + j] = sum;
            gram[j * n + i] = sum;
        }
    }
    const N_ = new Float64Array(m * m);
    const b = new Float64Array(m);
    for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) N_[i * m + j] = gram[i * n + j];
        b[i] = gram[m * n + i];
    }
    return { N: N_, b, gram };
}

/**
 * Literal normal equations of per-take complex systems: A_t = diag(g·wp_t)·C on the rows
 * plus penalty rows wq_t·g·C° on Q, target wp_t·Y_t (zero on the penalty rows).
 * Returns Σ_t Re(A_tᴴA_t), Σ_t Re(A_tᴴ·target_t) and Σ_t |target_t|².
 */
export function literalNormal(columns, micPosition, freqs, g, qMask, takes) {
    const m = columns.length;
    const N_ = new Float64Array(m * m);
    const b = new Float64Array(m);
    let yy = 0;
    const ar = new Float64Array(m), ai = new Float64Array(m);
    const addRow = (scale, f, r, tr, ti, penalty) => {
        const gr = g[2 * f] * scale, gi = g[2 * f + 1] * scale;
        for (let j = 0; j < m; j++) {
            const zero = penalty && j === micPosition;
            const cr = zero ? 0 : columns[j][2 * r], ci = zero ? 0 : columns[j][2 * r + 1];
            ar[j] = gr * cr - gi * ci;
            ai[j] = gr * ci + gi * cr;
        }
        for (let i = 0; i < m; i++) {
            for (let j = 0; j < m; j++) N_[i * m + j] += ar[i] * ar[j] + ai[i] * ai[j];
            b[i] += ar[i] * tr + ai[i] * ti;
        }
        yy += tr * tr + ti * ti;
    };
    for (const { record, wp, wq2 } of takes) {
        for (let r = 0; r < freqs.length; r++) {
            const f = freqs[r];
            if (wp[r] !== 0) addRow(wp[r], f, r, wp[r] * record.Y[2 * f], wp[r] * record.Y[2 * f + 1], false);
            if (qMask[r] && wq2 > 0) addRow(Math.sqrt(wq2), f, r, 0, 0, true);
        }
    }
    return { N: N_, b, yy };
}

/** Sub-matrix and sub-vector on positions `J`. */
export function restrict(N_, b, J) {
    const m = b.length, n = J.length;
    const out = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = N_[J[i] * m + J[j]];
    return { N: out, b: Float64Array.from(J, j => b[j]) };
}

/** Zero the rows, columns and rhs entries of `positions` (inactive terms, §5.7). */
export function zeroPositions(N_, b, positions) {
    const m = b.length;
    for (const p of positions) {
        for (let k = 0; k < m; k++) { N_[p * m + k] = 0; N_[k * m + p] = 0; }
        b[p] = 0;
    }
}

/**
 * Ridge solve of §5.8 by plain Cholesky: λ on every diagonal except `micPosition`
 * (1e-6 there; −1 for none). Returns the weights, or null on a non-positive pivot or a
 * non-finite value.
 */
export function ridgeSolve(N_, b, lambda, micPosition) {
    const n = b.length;
    const scale = Float64Array.from({ length: n }, (_, j) => {
        const s = Math.sqrt(N_[j * n + j]);
        return s < 1e-12 ? 1e-12 : s;
    });
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let sum = N_[i * n + j] / (scale[i] * scale[j]) + (i === j ? (i === micPosition ? MIC_RIDGE : lambda) : 0);
            for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
            if (i === j) {
                if (!(sum > 0)) return null;
                L[i * n + i] = Math.sqrt(sum);
            } else {
                L[i * n + j] = sum / L[j * n + j];
            }
        }
    }
    const v = Float64Array.from(b, (value, j) => value / scale[j]);
    for (let i = 0; i < n; i++) {
        let sum = v[i];
        for (let k = 0; k < i; k++) sum -= L[i * n + k] * v[k];
        v[i] = sum / L[i * n + i];
    }
    for (let i = n - 1; i >= 0; i--) {
        let sum = v[i];
        for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * v[k];
        v[i] = sum / L[i * n + i];
    }
    const w = v.map((value, j) => value / scale[j]);
    return w.every(Number.isFinite) ? w : null;
}

/** Held-out quadratic E_s(w) = yy − 2·wᵀb + wᵀN·w (§5.9). */
export function heldOut(w, N_, b, yy) {
    const n = w.length;
    let quadratic = 0, linear = 0;
    for (let i = 0; i < n; i++) {
        linear += w[i] * b[i];
        let row = 0;
        for (let j = 0; j < n; j++) row += N_[i * n + j] * w[j];
        quadratic += w[i] * row;
    }
    return yy - 2 * linear + quadratic;
}

/** The per-bin form of the held-out sum: Σ_t (Σ_rows wp²·|Y − g·C·w|² + wq²·Σ_Q |g·C°·w|²). */
export function heldOutPerBin(w, columns, micPosition, freqs, g, qMask, takes) {
    let total = 0;
    for (let r = 0; r < freqs.length; r++) {
        const f = freqs[r];
        let cr = 0, ci = 0, pr = 0, pi = 0;
        for (let j = 0; j < columns.length; j++) {
            cr += w[j] * columns[j][2 * r];
            ci += w[j] * columns[j][2 * r + 1];
            if (j !== micPosition) { pr += w[j] * columns[j][2 * r]; pi += w[j] * columns[j][2 * r + 1]; }
        }
        const gr = g[2 * f], gi = g[2 * f + 1];
        const er = gr * cr - gi * ci, ei = gr * ci + gi * cr;
        const qr = gr * pr - gi * pi, qi = gr * pi + gi * pr;
        for (const { record, wp, wq2 } of takes) {
            total += wp[r] * wp[r] * ((record.Y[2 * f] - er) ** 2 + (record.Y[2 * f + 1] - ei) ** 2);
            if (qMask[r]) total += wq2 * (qr * qr + qi * qi);
        }
    }
    return total;
}

const addInto = (target, source, sign = 1) => { for (let i = 0; i < target.length; i++) target[i] += sign * source[i]; };

/** Totals N_T, b_T, yy_T over seed systems [{ N, b, yy }], summed in seed order. */
export function totalSystem(seeds) {
    const N_ = new Float64Array(seeds[0].N.length);
    const b = new Float64Array(seeds[0].b.length);
    let yy = 0;
    for (const seed of seeds) { addInto(N_, seed.N); addInto(b, seed.b); yy += seed.yy; }
    return { N: N_, b, yy };
}

/** Fold s of §5.6: N_T − N_s, b_T − b_s. */
export function foldSystem(total, seed) {
    const N_ = Float64Array.from(total.N);
    const b = Float64Array.from(total.b);
    addInto(N_, seed.N, -1);
    addInto(b, seed.b, -1);
    return { N: N_, b };
}

/**
 * λ choice and final fit of §5.8-§5.9 for one length, from the per-seed systems restricted
 * to its columns. Returns λ*, its grid index, the held-out curve, the fold weights at λ*
 * (one per seed) and the final weights; null weights mark a failed solve.
 */
export function fitLength(seeds, micPosition) {
    const total = totalSystem(seeds);
    const folds = seeds.map(seed => foldSystem(total, seed));
    const solutions = folds.map(fold => LAMBDA_GRID.map(lambda => ridgeSolve(fold.N, fold.b, lambda, micPosition)));
    const curve = LAMBDA_GRID.map((_, k) => seeds.reduce((sum, seed, s) => {
        const w = solutions[s][k];
        return w ? sum + heldOut(w, seed.N, seed.b, seed.yy) : NaN;
    }, 0));
    let best = -1;
    curve.forEach((value, k) => { if (Number.isFinite(value) && (best < 0 || value <= curve[best])) best = k; });
    if (best < 0) return { lambda: null, index: -1, curve, foldWeights: null, weights: null };
    return {
        lambda: LAMBDA_GRID[best],
        index: best,
        curve,
        foldWeights: solutions.map(row => row[best]),
        weights: ridgeSolve(total.N, total.b, LAMBDA_GRID[best], micPosition)
    };
}

/**
 * Asset-order model weights (1182) and the microphone weight of length ℓ from a solution
 * over the Gram columns `columns` (other columns are 0).
 */
export function expandWeights(columns, solution, length) {
    const weights = new Float64Array(MODEL_TERMS);
    let micWeight = 0;
    columns.forEach((column, i) => {
        const info = gramColumnInfo(column);
        if (info.kind === 'mic') micWeight = solution[i];
        else if (info.kind === 'direct') weights[info.term] = solution[i];
        else if (info.length === length) weights[info.term] = solution[i];
    });
    return { weights, micWeight };
}

/** p_dir and p_2 of §5.10 for asset-order weights w (1182). */
export function predictionSignals(states, w) {
    const direct = new Float64Array(N);
    const second = new Float64Array(N);
    for (let j = 0; j < MODEL_TERMS; j++) {
        if (w[j] === 0) continue;
        const [a, b] = TERMS[j];
        const target = j < DIRECT_TERMS ? direct : second;
        const sa = states[a], sb = states[b], weight = RMS * w[j];
        for (let n = 0; n < N; n++) target[n] += weight * sa[n] * sb[n];
    }
    return { direct, second };
}

/** Time-domain prediction of §5.10: P = g·(DFT(p_dir) + H_ℓ·DFT(p_2))/N on `freqs`. */
export function predictRows(states, w, length, g, freqs = ALL_ROWS) {
    const { direct, second } = predictionSignals(states, w);
    const D = foldRows(direct, freqs);
    const S = rotateSecond(foldRows(second, freqs), hiRows(TAP_HALF_LENGTH[length], freqs));
    const P = new Float64Array(D.length);
    for (let r = 0; r < freqs.length; r++) {
        const f = freqs[r];
        const zr = D[2 * r] + S[2 * r], zi = D[2 * r + 1] + S[2 * r + 1];
        P[2 * r] = g[2 * f] * zr - g[2 * f + 1] * zi;
        P[2 * r + 1] = g[2 * f] * zi + g[2 * f + 1] * zr;
    }
    return P;
}

/** g·C·w from columns (the column product the prediction must equal). */
export function columnProduct(columns, w, g, freqs) {
    const out = new Float64Array(2 * freqs.length);
    for (let r = 0; r < freqs.length; r++) {
        let cr = 0, ci = 0;
        for (let j = 0; j < columns.length; j++) { cr += w[j] * columns[j][2 * r]; ci += w[j] * columns[j][2 * r + 1]; }
        const f = freqs[r];
        out[2 * r] = g[2 * f] * cr - g[2 * f + 1] * ci;
        out[2 * r + 1] = g[2 * f] * ci + g[2 * f + 1] * cr;
    }
    return out;
}

/** Corrected period of §3.5: x′ = x − s·(p_dir + h_ℓ ⊛ p_2), circular over the period. */
export function correctedPeriod(x, w, length, s = 1) {
    const { direct, second } = predictionSignals(correctorStates(x), w);
    const filtered = circularFilter(second, ninetyTaps(TAP_HALF_LENGTH[length]));
    return Float64Array.from(x, (value, n) => value - s * (direct[n] + filtered[n]));
}

// ----------------------------------------------------------------------------- §6-§7 figures
//
// A scored record ("entry") is { Y, Pn, excited, P, Mw }: P and Mw interleaved over all
// rows (ALL_ROWS), or null for a length without a fit (then Ya = Y).

const residual = (entry, f, s) => {
    let yr = entry.Y[2 * f], yi = entry.Y[2 * f + 1];
    if (entry.P && (f & 1) === 0 && f >= 36) {
        const r = rowOf(f);
        yr -= entry.Mw[2 * r] + s * entry.P[2 * r];
        yi -= entry.Mw[2 * r + 1] + s * entry.P[2 * r + 1];
    }
    return yr * yr + yi * yi - entry.Pn[f];
};

/** E_t(s; B): floored per bin. */
export function sumE(entry, s, bins) {
    let sum = 0;
    for (const f of bins) sum += Math.max(residual(entry, f, s), 0);
    return sum;
}

/** U_t(s; B): unfloored. */
export function sumU(entry, s, bins) {
    let sum = 0;
    for (const f of bins) sum += residual(entry, f, s);
    return sum;
}

const db = (num, den) => (den > 0 && num >= 0 && Number.isFinite(num / den) ? 10 * Math.log10(num / den) : null);

export function median(values) {
    const v = values.filter(value => value !== null).sort((a, b) => a - b);
    const n = v.length;
    if (!n) return null;
    return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

/**
 * power[ℓ][R][s] of §7.2 (55 values). `perTake`: R = L, where a record contributes to a
 * class only when the class is above the limit in that record.
 */
export function powerVector(entries, s, bins, active, { perTake = false } = {}) {
    const out = new Float64Array(POWER_LENGTH);
    for (let i = 0; i < N_BANDS; i++) for (const entry of entries) out[i] += sumU(entry, s, bins.bands[i]);
    let any = false;
    for (let c = 0; c < 3; c++) {
        if (!active[c]) { out[50 + c] = NaN; continue; }
        for (const entry of entries) if (!perTake || aboveLimit([entry], bins.score[c])) out[50 + c] += sumE(entry, s, bins.score[c]);
        out[53] += out[50 + c];
        any = true;
    }
    if (!any) out[53] = NaN;
    for (const entry of entries) out[54] += sumE(entry, s, bins.even8k);
    return out;
}

/**
 * Fold figures of §7.3 for one fold's takes at scale s: [C1, C2, C3, even all, total,
 * even 50 Hz-8 kHz], null where the fold has no value.
 */
export function foldFigures(takes, s, bins, active) {
    const values = [0, 1, 2].map(c => {
        if (!active[c]) return null;
        const contributing = takes.filter(entry => aboveLimit([entry], bins.score[c]));
        if (!contributing.length) return null;
        return db(contributing.reduce((sum, entry) => sum + sumE(entry, s, bins.score[c]), 0),
            contributing.reduce((sum, entry) => sum + sumE(entry, 0, bins.score[c]), 0));
    });
    let num = 0, den = 0, anyClass = false;
    for (const entry of takes) {
        for (let c = 0; c < 3; c++) {
            if (!active[c] || !aboveLimit([entry], bins.score[c])) continue;
            anyClass = true;
            num += sumE(entry, s, bins.score[c]);
            den += sumE(entry, 0, bins.score[c]);
        }
    }
    values.push(anyClass ? db(num, den) : null);
    let odd = 0, even = 0, even0 = 0;
    for (const entry of takes) {
        odd += sumE({ ...entry, P: null }, 0, oddSets(entry.excited).odd8k);
        even += sumE(entry, s, bins.even8k);
        even0 += sumE(entry, 0, bins.even8k);
    }
    values.push(db(odd + even, odd + even0), db(even, even0));
    return values;
}

/** figL[ℓ] (5 scales × 6 values, fold medians) and "worst" of §7.3; folds = [[take entries]...]. */
export function figuresAtL(folds, bins, active) {
    const perScale = SCALE_VALUES.map(s => folds.map(takes => foldFigures(takes, s, bins, active)));
    const figL = perScale.map(perFold => Array.from({ length: 6 }, (_, k) => median(perFold.map(values => values[k]))));
    let worst = null;
    for (const values of perScale[1]) {
        for (let c = 0; c < 3; c++) if (values[c] !== null && (worst === null || values[c] > worst.value)) worst = { value: values[c], classIndex: c };
    }
    return { figL, worst };
}

/** Class figure of §7.4 from power: index 50..54 → 10·log10(power[s][i]/power[0][i]). */
export const powerFigure = (powerAtScale, powerMeasured, index) => db(powerAtScale[index], powerMeasured[index]);

/** ref[R] of §7.5 (204 values) from records { Y, Pn, excited }. */
export function referenceSums(records, bins) {
    const ref = new Float64Array(REF_LENGTH);
    const excitedIn = (excited, lo, hi) => {
        const out = [];
        for (let f = 1; f <= MAX_BIN; f++) if (excited[f] && inRange(f, lo, hi)) out.push(f);
        return out;
    };
    const variance = (record, f) => 2 * Math.max(power(record.Y, f) - record.Pn[f], 0) * record.Pn[f] + record.Pn[f] ** 2;
    for (const record of records) {
        const odd = oddSets(record.excited);
        for (let i = 0; i <= N_BANDS; i++) {
            const [lo, hi] = i < N_BANDS ? bandRange(i) : [50, MAX_BIN];
            for (const f of excitedIn(record.excited, lo, hi)) ref[i] += power(record.Y, f);
            const oddBins = i < N_BANDS ? odd.bands[i] : odd.odd8k;
            const evenBins_ = i < N_BANDS ? bins.bands[i] : bins.even8k;
            for (const f of oddBins) {
                const excess = power(record.Y, f) - record.Pn[f];
                ref[51 + i] += i < N_BANDS ? excess : Math.max(excess, 0);
                ref[153 + i] += variance(record, f);
            }
            for (const f of evenBins_) ref[102 + i] += variance(record, f);
        }
    }
    return ref;
}

/** Repeatability ceiling of §7.6 per score class: seeds = [[recordA, recordB]...]. */
export function repeatabilityCeiling(seeds, bins) {
    return bins.score.map(classBins => median(seeds.filter(([A, B]) => aboveLimit([A], classBins) && aboveLimit([B], classBins))
        .map(([A, B]) => {
            let diff = 0, sum = 0;
            for (const f of classBins) {
                diff += Math.max((A.Y[2 * f] - B.Y[2 * f]) ** 2 + (A.Y[2 * f + 1] - B.Y[2 * f + 1]) ** 2 - A.Pn[f] - B.Pn[f], 0);
                sum += Math.max(power(A.Y, f) - A.Pn[f], 0) + Math.max(power(B.Y, f) - B.Pn[f], 0);
            }
            return db(diff / 2, sum / 2);
        })));
}

/** share_ℓ of §7.7: micColumns = the six M_s on all rows, aRecords the 12 (a) records. */
export function micShare(micWeight, micColumns, aRecords, bins) {
    let num = 0, den = 0;
    for (const M of micColumns) for (const f of bins.mic) num += M[2 * rowOf(f)] ** 2 + M[2 * rowOf(f) + 1] ** 2;
    for (const record of aRecords) for (const f of bins.mic) den += Math.max(power(record.Y, f) - record.Pn[f], 0);
    return db(2 * micWeight * micWeight * num, den);
}

/**
 * On/off rule of §6 at s = +1. figL: the predicted fold medians at s = +1; worst its
 * worst; checkFig the measured figures or null; powerL6 / powerPeaks: power[ℓ][R] by scale.
 */
export function onOffRule({ failure = null, figL, worst, checkFig = null, powerL6, powerPeaks }) {
    if (failure) return { on: false, reason: failure };
    const figures = checkFig ? checkFig.fig : figL;
    if (!(figures[3] !== null && figures[3] <= -2)) return { on: false, reason: 'littleGain' };
    const worstValue = checkFig
        ? Math.max(...checkFig.fig.slice(0, 3).filter(value => value !== null), -Infinity)
        : worst ? worst.value : -Infinity;
    if (worstValue > 1) return { on: false, reason: 'worseInCheck' };
    const l6 = powerFigure(powerL6[1], powerL6[0], 53);
    if (l6 !== null && l6 > 0) return { on: false, reason: 'worseAtLowerVolume' };
    const peaks = powerFigure(powerPeaks[1], powerPeaks[0], 53);
    if (peaks !== null && peaks > 0) return { on: false, reason: 'worseAtLoudPeaks' };
    return { on: true, reason: null };
}

/** Measured figures of §7.8 from the plain and corrected records { Y, Pn, excited }. */
export function checkFigures(plain, corrected, bins, active) {
    const raw = record => ({ ...record, P: null });
    const p = raw(plain), q = raw(corrected);
    const classes = [0, 1, 2].map(c => (active[c] && aboveLimit([plain], bins.score[c])
        ? db(sumE(q, 0, bins.score[c]), sumE(p, 0, bins.score[c])) : null));
    let num = 0, den = 0, any = false;
    classes.forEach((value, c) => {
        if (value === null) return;
        any = true;
        num += sumE(q, 0, bins.score[c]);
        den += sumE(p, 0, bins.score[c]);
    });
    const oddOf = record => sumE(record, 0, oddSets(record.excited).odd8k);
    const excitedPower = record => {
        let sum = 0;
        for (let f = 50; f <= MAX_BIN; f++) if (record.excited[f]) sum += power(record.Y, f);
        return sum;
    };
    const Op = oddOf(p), Oq = oddOf(q), Ep = sumE(p, 0, bins.even8k), Eq = sumE(q, 0, bins.even8k);
    const Xp = excitedPower(p), Xq = excitedPower(q);
    const ref = referenceSums([corrected], bins);
    const bands = powerVector([q], 0, bins, [false, false, false]);
    const bandSums = new Float32Array(150);
    for (let i = 0; i < N_BANDS; i++) {
        bandSums[i] = bands[i];
        bandSums[50 + i] = ref[i];
        bandSums[100 + i] = ref[102 + i];
    }
    return {
        fig: [...classes, any ? db(num, den) : null, db(Oq + Eq, Op + Ep), db(Eq, Ep)],
        levels: {
            totalBefore: db(Op + Ep, Xp), totalAfter: db(Oq + Eq, Xq),
            evenBefore: db(Ep, Xp), evenAfter: db(Eq, Xq)
        },
        bandSums
    };
}

/** §7.9: channels = [{ short: { on, checkFig, figL }, long: {...} }] (figL at s = +1, 6 values). */
export function recommendedLength(channels) {
    const mean = length => channels.reduce((sum, channel) => {
        const { on, checkFig, figL } = channel[length];
        const value = checkFig ? checkFig.fig[5] : figL ? figL[5] : null;
        return sum + (on && value !== null ? -value : 0);
    }, 0) / channels.length;
    return mean('long') >= mean('short') + 1 ? 'long' : 'short';
}

/**
 * Amplifier change estimator of §7.10 on one record { Y, Pn } of drive { X, excited }
 * with the stored weights of ℓ: returns { a, b, se, z } or null when it cannot be formed.
 */
export function amplifierEstimate(record, drive, w, length) {
    const g = estimateG([{ ...record, X: drive.X, excited: drive.excited }]);
    if (!g) return null;
    const states = correctorStates(synthesize(drive.X));
    const T = predictRows(states, w, length, g, ALL_ROWS);
    const { M } = micColumn(drive, g, ALL_ROWS);
    let tt = 0, mm = 0, n = 0;
    let tmr = 0, tmi = 0, tyr = 0, tyi = 0, myr = 0, myi = 0;
    const used = [];
    for (let r = 0; r < ROW_COUNT; r++) {
        const f = rowFrequency(r);
        if (isMains(f) || !(record.Pn[f] > 0)) continue;
        const v = 1 / record.Pn[f];
        const Tr = T[2 * r], Ti = T[2 * r + 1], Mr = M[2 * r], Mi = M[2 * r + 1];
        const Yr = record.Y[2 * f], Yi = record.Y[2 * f + 1];
        tt += v * (Tr * Tr + Ti * Ti);
        mm += v * (Mr * Mr + Mi * Mi);
        tmr += v * (Tr * Mr + Ti * Mi); tmi += v * (Tr * Mi - Ti * Mr);
        tyr += v * (Tr * Yr + Ti * Yi); tyi += v * (Tr * Yi - Ti * Yr);
        myr += v * (Mr * Yr + Mi * Yi); myi += v * (Mr * Yi - Mi * Yr);
        used.push(r);
        n++;
    }
    const tm2 = tmr * tmr + tmi * tmi;
    const denominator = tt - tm2 / mm;
    // tm·my
    const pr = tmr * myr - tmi * myi;
    const a = (tyr - pr / mm) / denominator;
    // b = (my − a·conj(tm))/mm
    const br = (myr - a * tmr) / mm, bi = (myi + a * tmi) / mm;
    let residualSum = 0;
    for (const r of used) {
        const f = rowFrequency(r);
        const er = record.Y[2 * f] - a * T[2 * r] - (br * M[2 * r] - bi * M[2 * r + 1]);
        const ei = record.Y[2 * f + 1] - a * T[2 * r + 1] - (br * M[2 * r + 1] + bi * M[2 * r]);
        residualSum += (er * er + ei * ei) / record.Pn[f];
    }
    const se = Math.sqrt(residualSum / (n - 3) / (2 * denominator));
    return { a, b: [br, bi], se, z: a / se };
}

// -------------------------------------------------------------------- composed channel fit

/**
 * Identification and predicted figures of one channel (§4.5-§7.7) in float64.
 *
 * calls: the 19 records { group, seed, take, Y, Pn } of §3.1; drives: { [seed]: { X, excited } }
 * for seeds 1..9 (X stored, level-scaled; the (e) record uses drive 7 and the prediction
 * × 10^(−12/20)). `columns` limits the Gram columns (default all 0..1374): a full fit is
 * far too slow in JS, so tests pass a subset. The microphone column must be included.
 */
export function identifyChannel({ calls, drives, upperLimitHz = MAX_BIN, columns = Int32Array.from({ length: MIC_COLUMN + 1 }, (_, i) => i) }) {
    const withDrive = call => ({ ...call, X: drives[call.seed].X, excited: drives[call.seed].excited });
    const records = calls.map(withDrive);
    const aRecords = records.filter(record => record.group === 'a');
    const bins = binSets(upperLimitHz);
    const active = activeClasses(aRecords, bins);
    const g = estimateG(aRecords);
    const result = { g, bins, active, lengths: {} };
    const failure = !g ? 'noFit' : isBelowLimit(aRecords, bins, active) ? 'belowLimit' : null;
    let lowest = MAX_BIN, highest = 0;
    for (let seed = 1; seed <= 6; seed++) {
        drives[seed].excited.forEach((on, f) => { if (on) { lowest = Math.min(lowest, f); highest = Math.max(highest, f); } });
    }
    const sectionsActive = activeSections(lowest, highest);
    const statesOf = new Map();
    const states = seed => {
        if (!statesOf.has(seed)) statesOf.set(seed, correctorStates(synthesize(drives[seed].X)));
        return statesOf.get(seed);
    };
    const qMask = penaltyMask(ALL_ROWS, upperLimitHz);
    const micPosition = Array.prototype.indexOf.call(columns, MIC_COLUMN);
    const inactive = [];
    columns.forEach((column, i) => { if (columnInactive(column, sectionsActive)) inactive.push(i); });
    const seedSystems = [];
    const micColumns = [];
    if (!failure) {
        for (let seed = 1; seed <= 6; seed++) {
            const takes = aRecords.filter(record => record.seed === seed)
                .map(record => ({ record, ...takeWeights(record, bins) }));
            const { columns: seedColumns, M } = driveColumns(drives[seed], g, { states: states(seed), columns });
            const sums = seedRowSums(takes, g, ALL_ROWS, qMask);
            const { N: N_, b } = seedGram(seedColumns, micPosition, qMask, sums);
            zeroPositions(N_, b, inactive);
            seedSystems.push({ N: N_, b, yy: sums.yy });
            micColumns.push(M);
        }
    }
    const predictionOf = (seed, w, micWeight, length, scale = 1) => {
        const P = predictRows(states(seed), w, length, g);
        const { M } = micColumn(drives[seed], g, ALL_ROWS);
        return { P: P.map(value => value * scale), Mw: M.map(value => value * micWeight * scale) };
    };
    for (const length of ['short', 'long']) {
        const J = [];
        columns.forEach((column, i) => {
            const info = gramColumnInfo(column);
            if (info.kind !== 'second' || info.length === length) J.push(i);
        });
        const lengthMic = J.indexOf(micPosition);
        let fit = null, lengthFailure = failure;
        if (!failure) {
            fit = fitLength(seedSystems.map(system => ({ ...restrict(system.N, system.b, J), yy: system.yy })), lengthMic);
            if (!fit.weights || fit.foldWeights.some(w => !w)) lengthFailure = 'noFit';
        }
        const lengthColumnsList = J.map(i => columns[i]);
        const entriesFor = (set, weightsOf) => records.filter(record => set.includes(record.group)).map(record => {
            if (lengthFailure) return { ...record, P: null, Mw: null };
            const { weights, micWeight } = expandWeights(lengthColumnsList, weightsOf(record), length);
            const driveSeed = record.group === 'e' ? 7 : record.seed;
            return { ...record, ...predictionOf(driveSeed, weights, micWeight, length, record.group === 'e' ? E_SCALE : 1) };
        });
        const foldIndex = record => record.seed - 1;
        const aEntries = entriesFor(['a'], record => fit.foldWeights[foldIndex(record)]);
        const finalOf = () => fit.weights;
        const sets = { L: aEntries, 'L-6': entriesFor(['d'], finalOf), 'L-12': entriesFor(['e'], finalOf), peaks: entriesFor(['f'], finalOf) };
        const scales = lengthFailure ? [0] : SCALE_VALUES;
        const powerOf = Object.fromEntries(Object.entries(sets).map(([set, entries]) => [set,
            scales.map(s => powerVector(entries, s, bins, active, { perTake: set === 'L' }))]));
        const folds = [1, 2, 3, 4, 5, 6].map(seed => aEntries.filter(entry => entry.seed === seed));
        const { figL, worst } = lengthFailure ? { figL: null, worst: null } : figuresAtL(folds, bins, active);
        const final = lengthFailure ? null : expandWeights(lengthColumnsList, fit.weights, length);
        const rule = lengthFailure ? { on: false, reason: lengthFailure }
            : onOffRule({ figL: figL[1], worst, powerL6: powerOf['L-6'], powerPeaks: powerOf.peaks });
        result.lengths[length] = {
            ...rule,
            lambda: fit ? fit.lambda : null,
            curve: fit ? fit.curve : null,
            weights: final ? final.weights : null,
            micWeight: final ? final.micWeight : null,
            figL,
            worst,
            power: powerOf,
            micShare: final ? micShare(final.micWeight, micColumns, aRecords, bins) : null
        };
    }
    result.ref = Object.fromEntries([['L', ['a']], ['L-6', ['d']], ['L-12', ['e']], ['peaks', ['f']]]
        .map(([set, groups]) => [set, referenceSums(records.filter(record => groups.includes(record.group)), bins)]));
    result.ceiling = repeatabilityCeiling([1, 2, 3, 4, 5, 6].map(seed => ['A', 'B']
        .map(take => aRecords.find(record => record.seed === seed && record.take === take))), bins);
    result.micDistortionWarning = ['short', 'long'].some(length => {
        const share = result.lengths[length].micShare;
        return share !== null && share > MIC_WARNING_DB;
    });
    return result;
}
