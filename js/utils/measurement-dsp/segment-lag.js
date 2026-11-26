// Integer lag between two recorded segments of the same periodic content, from their spectra.
import FFT from './fft.js';

const GRID = 65536;
let tables = null;

/**
 * Peak over integer lags t in [−period/2, period/2) of Re Σ_j C_j·e^(j2π·f_j·t/period), with C interleaved
 * complex per line and f_j = lines[j] in cycles per period (below GRID/2): the largest value of sign·value
 * (sign 0: the largest magnitude), with `within` only over |t| ≤ within. Coarse on a GRID-point grid of the
 * period, then exact around the grid peak. Returns { t, value }.
 */
export function correlationPeak(C, lines, period, { within = null, sign = 1 } = {}) {
    if (!tables) {
        tables = {
            fft: new FFT(GRID), re: new Float64Array(GRID), im: new Float64Array(GRID),
            outRe: new Float64Array(GRID), outIm: new Float64Array(GRID)
        };
    }
    const { fft, re, im, outRe, outIm } = tables;
    re.fill(0);
    im.fill(0);
    lines.forEach((f, j) => {
        re[f] = C[2 * j];
        im[f] = C[2 * j + 1];
    });
    fft.inverseTransform(outRe, outIm, re, im);
    const score = value => (sign !== 0 ? sign * value : value < 0 ? -value : value);
    const reach = within === null ? GRID / 2 : Math.floor(within * GRID / period);
    let coarse = 0;
    for (let m = -reach; m < reach; m++) {
        if (score(outRe[(m + GRID) % GRID]) > score(outRe[(coarse + GRID) % GRID])) coarse = m;
    }
    const center = Math.round(coarse * period / GRID);
    const radius = Math.ceil(period / GRID) + 1;
    let best = { t: center, value: -Infinity };
    for (let t = center - radius; t <= center + radius; t++) {
        if (within !== null && (t < -within || t > within)) continue;
        let value = 0;
        lines.forEach((f, j) => {
            const angle = 2 * Math.PI * ((f * t) % period) / period;
            value += C[2 * j] * Math.cos(angle) - C[2 * j + 1] * Math.sin(angle);
        });
        if (best.value === -Infinity || score(value) > score(best.value)) best = { t, value };
    }
    const half = period / 2;
    best.t = best.t >= half ? best.t - period : best.t < -half ? best.t + period : best.t;
    return best;
}

/**
 * Lag of segment S behind reference segment R (samples, the largest positive cross-correlation peak)
 * and the correlation height there (1 for S identical to R). S and R are interleaved complex spectra of
 * one period of `period` samples indexed by bin; only `lines` count, each weighted by weights[f].
 * Returns { lag, height }.
 */
export function segmentLag(S, R, lines, weights, period) {
    const C = new Float64Array(2 * lines.length);
    let norm = 0;
    lines.forEach((f, j) => {
        const w = weights[f];
        const sr = S[2 * f], si = S[2 * f + 1], rr = R[2 * f], ri = R[2 * f + 1];
        C[2 * j] = w * (sr * rr + si * ri);
        C[2 * j + 1] = w * (si * rr - sr * ri);
        norm += w * (rr * rr + ri * ri);
    });
    const { t, value } = correlationPeak(C, lines, period);
    return { lag: t, height: value / norm };
}

/**
 * Lag of S behind R as segmentLag finds it, refined below a sample by the weighted least-squares phase
 * slope of the cross spectrum over `lines` once the integer lag is removed.
 */
export function fractionalLag(S, R, lines, weights, period) {
    const { lag } = segmentLag(S, R, lines, weights, period);
    let slope = 0;
    let norm = 0;
    for (const f of lines) {
        const sr = S[2 * f], si = S[2 * f + 1], rr = R[2 * f], ri = R[2 * f + 1];
        const cr = sr * rr + si * ri, ci = si * rr - sr * ri;
        // S = R·e^(−j2πf·delay/period): advance the cross spectrum by the integer lag.
        const angle = 2 * Math.PI * ((f * lag) % period) / period;
        const c = Math.cos(angle), s = Math.sin(angle);
        const re = cr * c - ci * s, im = cr * s + ci * c;
        const weight = weights[f] * Math.hypot(re, im);
        slope += weight * f * Math.atan2(im, re);
        norm += weight * f * f;
    }
    return norm > 0 ? lag - period * slope / (2 * Math.PI * norm) : lag;
}
