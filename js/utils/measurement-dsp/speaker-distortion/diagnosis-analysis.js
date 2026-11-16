// Diagnosis block of one channel: multitone band sums per set,
// silence and hum, and the swept-sine harmonic band sums; and the channel's swept-sine record.
import { analyzeDistortion, harmonicTransfers } from '../analysis.js';
import { analyzeEssRecording, createEssSignal } from '../ess.js';
import { resampleWindowedSinc } from '../resample.js';
import { BAND_EDGES, N_BANDS, SWEEP_FREQUENCIES } from './constants.js';
import { binSets, isMains, oddSets, periodSpectrum } from './preprocess.js';
import { MAX_BIN, N, combLines } from './signals.js';

const SET_GROUPS = { a: 'L', d: 'L-6', e: 'L-12', f: 'peaks' };
const HUM_LIMIT_HZ = 1000;
const HUM_FLOOR_SPAN = 20;
const ESS_ORDERS = 10;
const ESS_SETTINGS = { harmonicLimit: ESS_ORDERS, maxOrder: 3, minFrequency: 20, maxFrequency: 8500 };
// Window of the swept-sine record, capped by the separated harmonic responses. At low fundamentals the
// second-order response of a swept sine spreads ahead of its onset, so a shorter lead-in biases H2 there.
const SWEEP_WINDOW = { beforeSeconds: 0.01, afterSeconds: 0.04 };

const power = (Y, f) => Y[2 * f] * Y[2 * f] + Y[2 * f + 1] * Y[2 * f + 1];
const sumOver = (bins, value) => {
    let sum = 0;
    for (const f of bins) sum += value(f);
    return sum;
};

// Integer bins of band i in [e_i, e_{i+1}); the last band includes 8000 Hz.
const inBand = (f, i) => f >= BAND_EDGES[i] && (f < BAND_EDGES[i + 1] || (i === N_BANDS - 1 && f === BAND_EDGES[N_BANDS]));
const bandBins = Array.from({ length: N_BANDS }, (_, i) => {
    const bins = [];
    for (let f = Math.ceil(BAND_EDGES[i]); f <= MAX_BIN; f++) if (inBand(f, i) && !isMains(f)) bins.push(f);
    return bins;
});

function multitoneSets(calls, bandwidth) {
    const even = binSets(MAX_BIN).bands;
    const sets = {};
    for (const [group, key] of Object.entries(SET_GROUPS)) {
        const members = calls.filter(call => call.group === group);
        const set = { ev: new Float32Array(N_BANDS), evPn: new Float32Array(N_BANDS), odPn: new Float32Array(N_BANDS),
            noise: new Float32Array(N_BANDS) };
        const sums = { ev: new Float64Array(N_BANDS), evPn: new Float64Array(N_BANDS), odPn: new Float64Array(N_BANDS),
            noise: new Float64Array(N_BANDS) };
        for (const { seed, K, Y, Pn } of members) {
            const odd = oddSets(combLines(seed, bandwidth).excited).bands;
            for (let i = 0; i < N_BANDS; i++) {
                sums.ev[i] += sumOver(even[i], f => power(Y, f) - Pn[f]);
                sums.evPn[i] += sumOver(even[i], f => Pn[f]);
                sums.odPn[i] += sumOver(odd[i], f => Pn[f]);
                sums.noise[i] += K * sumOver(bandBins[i], f => Pn[f]);
            }
        }
        for (const name of Object.keys(set)) {
            for (let i = 0; i < N_BANDS; i++) set[name][i] = members.length ? sums[name][i] / members.length : 0;
        }
        sets[key] = set;
    }
    return sets;
}

function excitedCounts(seed, bandwidth) {
    const excited = combLines(seed, bandwidth).excited;
    const nx = new Uint16Array(N_BANDS);
    for (let i = 0; i < N_BANDS; i++) {
        for (let f = Math.ceil(BAND_EDGES[i]); f <= MAX_BIN; f++) if (inBand(f, i) && excited[f]) nx[i]++;
    }
    return nx;
}

// Mean |S_p|² on the 1 Hz grid over the whole 48 kHz periods of the silence capture.
function silencePower(silence, rateHz) {
    const at48 = rateHz === N ? silence : resampleWindowedSinc(silence, rateHz, N);
    const periods = Math.floor(at48.length / N);
    const mean = new Float64Array(MAX_BIN + 1);
    for (let p = 0; p < periods; p++) {
        const S = periodSpectrum(Float64Array.from(at48.subarray(p * N, (p + 1) * N)));
        for (let f = 0; f <= MAX_BIN; f++) mean[f] += power(S, f) / periods;
    }
    return mean;
}

const nearMains = f => {
    const r50 = f % 50, r60 = f % 60;
    return r50 <= 2 || r50 >= 48 || r60 <= 2 || r60 >= 58;
};

function humExcess(mean, f0) {
    const count = Math.floor(HUM_LIMIT_HZ / f0);
    const out = new Float32Array(count);
    for (let h = 1; h <= count; h++) {
        const c = h * f0;
        const peak = mean[c - 1] > mean[c] ? (mean[c - 1] > mean[c + 1] ? mean[c - 1] : mean[c + 1])
            : (mean[c] > mean[c + 1] ? mean[c] : mean[c + 1]);
        const floor = [];
        for (let f = c - HUM_FLOOR_SPAN; f <= c + HUM_FLOOR_SPAN; f++) if (f > 0 && !nearMains(f)) floor.push(mean[f]);
        floor.sort((x, y) => x - y);
        const median = floor.length % 2 ? floor[floor.length >> 1]
            : (floor[floor.length / 2 - 1] + floor[floor.length / 2]) / 2;
        out[h - 1] = median > 0 && peak > 0 ? 10 * Math.log10(peak / median) : 0;
    }
    return out;
}

const valid = value => Number.isFinite(value) && value > 0;

// Harmonic analysis of the silence capture with the sweep's latency and level, or null.
function silenceAnalysis(silence, sweep, latency, levelDb) {
    try {
        return analyzeEssRecording(silence, sweep, {
            playbackOffsetSamples: 0, fixedLatencySamples: latency, levelDb, detectClipping: false
        }).harmonicAnalysis;
    } catch (error) {
        console.warn('Speaker distortion diagnosis: the silence capture has no harmonic analysis.', error);
        return null;
    }
}

// |N_n(f)| of a silence harmonic analysis, or null when no ratio is observed.
function noiseHarmonics(analysis) {
    if (!analysis) return null;
    try {
        const result = analyzeDistortion(analysis, ESS_SETTINGS);
        return result.series.map(entry => entry.ratios.map((ratio, i) =>
            (ratio !== null && Number.isFinite(result.fundamentals[i]) ? ratio * result.fundamentals[i] : 0)));
    } catch (error) {
        console.warn('Speaker distortion diagnosis: no noise harmonics in the silence capture.', error);
        return null;
    }
}

const magnitude = c => Math.hypot(c[0], c[1]);

// SWEEP_WINDOW within the span the orders up to `order` of `analysis` leave around their onsets.
function sweepWindow({ orders, sampleRate }, order) {
    const entries = orders.slice(0, order);
    const before = Math.min(...entries.map(entry => entry.onsetIndex)) / sampleRate;
    const after = Math.min(...entries.map(entry => entry.data.length - entry.onsetIndex)) / sampleRate;
    return { beforeSeconds: Math.min(SWEEP_WINDOW.beforeSeconds, before), afterSeconds: Math.min(SWEEP_WINDOW.afterSeconds, after) };
}

// Electrical order-n transfer H_n(f)/H1(n·f) of the essL capture at SWEEP_FREQUENCIES, with its noise
// |N_n(f)|/|H1(n·f)| from the silence capture and |H1(n·f)/H1(f)|; NaN where a point is not observed.
// Each order uses the window its own harmonic separation allows.
function orderTransfers(sweepAnalysis, noiseAnalysis, n) {
    const window = sweepWindow(sweepAnalysis, n);
    const key = `h${n}`;
    const at = harmonicTransfers(sweepAnalysis, SWEEP_FREQUENCIES, window, n);
    const multiple = harmonicTransfers(sweepAnalysis, SWEEP_FREQUENCIES.map(f => n * f), window, n);
    const noise = harmonicTransfers(noiseAnalysis, SWEEP_FREQUENCIES, window, n);
    const count = SWEEP_FREQUENCIES.length;
    const out = { re: new Float32Array(count), im: new Float32Array(count), noise: new Float32Array(count), gRatio: new Float32Array(count) };
    for (let k = 0; k < count; k++) {
        const h1 = at[k].h1, hn = at[k][key];
        const g = multiple[k].h1, nn = noise[k][key];
        const d = g ? g[0] * g[0] + g[1] * g[1] : 0;
        const level = nn && d > 0 ? magnitude(nn) / Math.sqrt(d) : NaN;
        if (!h1 || !hn || !(level > 0) || !Number.isFinite(level)) {
            out.re[k] = out.im[k] = out.noise[k] = out.gRatio[k] = NaN;
            continue;
        }
        out.re[k] = (hn[0] * g[0] + hn[1] * g[1]) / d;
        out.im[k] = (hn[1] * g[0] - hn[0] * g[1]) / d;
        out.noise[k] = level;
        out.gRatio[k] = Math.sqrt(d) / magnitude(h1);
    }
    return out;
}

/**
 * Swept-sine record of the essL capture at SWEEP_FREQUENCIES: the electrical second-order transfer
 * t_e = H2(f)/H1(2f) (teRe, teIm), its noise |N2(f)|/|H1(2f)| and gRatio = |H1(2f)/H1(f)|, and the
 * third-order counterparts t3 = H3(f)/H1(3f) (t3Re, t3Im), noise3 and gRatio3 = |H1(3f)/H1(f)|, the
 * noise from the silence capture and NaN where a point is not observed (each order independently);
 * or null without a silence analysis.
 */
function sweepRecord(sweepAnalysis, noiseAnalysis, levelDbfs) {
    if (!noiseAnalysis) return null;
    try {
        const second = orderTransfers(sweepAnalysis, noiseAnalysis, 2);
        const third = orderTransfers(sweepAnalysis, noiseAnalysis, 3);
        return {
            levelDbfs, teRe: second.re, teIm: second.im, noise: second.noise, gRatio: second.gRatio,
            t3Re: third.re, t3Im: third.im, noise3: third.noise, gRatio3: third.gRatio
        };
    } catch (error) {
        console.warn('Speaker distortion diagnosis: no swept-sine record.', error);
        return null;
    }
}

function sweepSums(main, other, noise) {
    const sums = {
        h: Array.from({ length: ESS_ORDERS }, () => new Float32Array(N_BANDS)),
        h1: Array.from({ length: ESS_ORDERS - 1 }, () => new Float32Array(N_BANDS)),
        z: Array.from({ length: ESS_ORDERS - 1 }, () => new Float32Array(N_BANDS))
    };
    const pts = new Uint16Array(N_BANDS);
    main.frequencies.forEach((f, k) => {
        const i = BAND_EDGES.findIndex((_, b) => b < N_BANDS && inBand(f, b));
        if (i < 0 || !valid(main.fundamentals[k]) || !valid(other.fundamentals[k])) return;
        const h1 = main.fundamentals[k] * main.fundamentals[k];
        pts[i]++;
        sums.h[0][i] += h1;
        main.series.forEach((entry, s) => {
            const ratio = entry.ratios[k];
            if (ratio === null || !Number.isFinite(ratio)) return;
            sums.h[s + 1][i] += h1 * ratio * ratio;
            sums.h1[s][i] += h1;
            const n = noise ? noise[s][k] : 0;
            sums.z[s][i] += n * n;
        });
    });
    return { sums, pts };
}

function essSums({ essL, ess6, silence, rateHz, bandwidth, sweepLength, levelDbfs }) {
    const sweep = createEssSignal({
        length: sweepLength, sampleRate: rateHz, startFrequency: bandwidth[0], endFrequency: bandwidth[1]
    });
    // The audio-context reference makes trimStartSamples + onsetIndex the measured path latency.
    const analyze = (recording, levelDb) => analyzeEssRecording(Float32Array.from(recording), sweep, {
        playbackOffsetSamples: 0, levelDb, detectClipping: false, outputTimeReference: 'audio-context'
    });
    const resultL = analyze(essL, levelDbfs);
    const result6 = analyze(ess6, levelDbfs - 6);
    const latency = resultL.trimStartSamples + resultL.onsetIndex;
    const distortionL = analyzeDistortion(resultL.harmonicAnalysis, ESS_SETTINGS);
    const distortion6 = analyzeDistortion(result6.harmonicAnalysis, ESS_SETTINGS);
    const quiet = Float32Array.from(silence);
    const quietL = silenceAnalysis(quiet, sweep, latency, levelDbfs);
    const L = sweepSums(distortionL, distortion6, noiseHarmonics(quietL));
    const six = sweepSums(distortion6, distortionL, noiseHarmonics(silenceAnalysis(quiet, sweep, latency, levelDbfs - 6)));
    return {
        sums: { essL: L.sums, ess6: six.sums, pts: L.pts },
        sweep: sweepRecord(resultL.harmonicAnalysis, quietL, levelDbfs)
    };
}

/**
 * Diagnosis block and swept-sine record ({ diagnosis, sweep }) from { essL, ess6, silence } captures,
 * the analyzed calls { seed, group, K, Y, Pn }, the device rate, bandwidth, sweep length and the level L in dBFS.
 */
export function analyzeDiagnosis(request) {
    const { calls, silence, rateHz, bandwidth } = request;
    const mean = silencePower(Float64Array.from(silence), rateHz);
    const silenceBands = new Float32Array(N_BANDS);
    for (let i = 0; i < N_BANDS; i++) silenceBands[i] = sumOver(bandBins[i], f => mean[f]);
    const { sums, sweep } = essSums(request);
    return {
        diagnosis: {
            nx: excitedCounts(calls[0].seed, bandwidth),
            sets: multitoneSets(calls, bandwidth),
            silence: silenceBands,
            hum50: humExcess(mean, 50),
            hum60: humExcess(mean, 60),
            ess: sums
        },
        sweep
    };
}
