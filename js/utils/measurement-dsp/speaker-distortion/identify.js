// Coordinator of the speaker distortion identification:
// work units run on a small pool of Workers (identify-worker.js); the coordinator keeps the
// sums, the λ choice, the figures and the on/off rule.
import { createEssSignal } from '../ess.js';
import {
    BAND_EDGES, CLASSES, LENGTHS, LEVEL_CHECK_K, LEVEL_CHECK_OVERLOAD, N_BANDS, ODD_CLASSES, ODD_CONFIGS, ODD_FIRST_BIN,
    ODD_STATES, POWER_LENGTH, REF_LENGTH, SCALES, SETS
} from './constants.js';
import { SDC_COLUMNS, SDC_SCORE_SETS, SDC_UNKNOWNS } from './kernels.js';
import {
    PENALTY_MU, ROW_COUNT, activeClasses, aboveLimit, analyzeCall, binSets, estimateG, excitedRange, isBelowLimit,
    isMains, isMeasured, limitSums, oddSets, rowFrequency, seedRows, takeWeights, termMask
} from './preprocess.js';
import { MAX_BIN, combLines, isMeasurableBand, levelCheckSignal } from './signals.js';
import { constrainedSweepFit, singleToneWorseClass, sweepKappa, sweepRows, worseForSingleTones } from './sweep.js';

/** λ grid: 10^((i − 16)/4), i = 0…22. */
export const LAMBDA_GRID = Object.freeze(Array.from({ length: 23 }, (_, i) => 10 ** ((i - 16) / 4)));
/** Prediction scale of the (e) record scored on drive 7. */
export const E_SCALE = 10 ** (-12 / 20);
/** Microphone share above which the run warns about microphone distortion. */
export const MIC_WARNING_DB = -19;
/** z at or above which an amplifier gain estimate is used. */
export const AMP_MIN_Z = 30;
/** Share of the level-check lines that must be measured for `passed`. */
const LEVEL_CHECK_MEASURED_SHARE = 0.1;

const MODEL_TERMS = SDC_UNKNOWNS - 1;
const FIT_SEEDS = [1, 2, 3, 4, 5, 6];
const SET_GROUPS = Object.freeze({ L: 'a', 'L-6': 'd', 'L-12': 'e', peaks: 'f' });
const CAPTURE_GAP_SECONDS = 0.5;
const CHECK_SEED = 10;
const CHECK_K = 7;

// Sorted distinct seeds of `records`.
const seedsOf = records => [...new Set(records.map(record => record.seed))].sort((x, y) => x - y);
// Fit drives of the even block (the (a) seeds) and of the odd block (the (a) and (f) seeds, one
// leave-one-out group each).
const fitSeedsOf = calls => seedsOf(calls.filter(call => call.group === 'a'));
const oddFitSeedsOf = calls => seedsOf(calls.filter(call => call.group === 'a' || call.group === 'f'));
// Work units of one fitChannel: a Gram and a fold per fit seed, 2 final solves, a score unit per
// seed, the odd columns of every odd fit drive and of drive 7, and with a sweep record its even
// and odd single-tone rows. A refit under the single-tone constraint (constrainedSweepFit) runs
// its units again; the progress is clamped at 1.
const fitUnits = (calls, sweep) => 2 * fitSeedsOf(calls).length + 2 + seedsOf(calls).length + oddFitSeedsOf(calls).length + 1
    + (sweep ? 2 : 0);

// ---------------------------------------------------------------------------------------------
// Executors. An executor is { run(type, payload) → Promise<result>, close() }.

const MAX_WORKERS = 4;

function analysisError() {
    const error = new Error('The distortion analysis failed.');
    error.name = 'SpeakerDistortionAnalysisError';
    error.code = 'analysisFailed';
    return error;
}

function createWorkerPool(signal, { analysisOnly = false } = {}) {
    const cores = globalThis.navigator?.hardwareConcurrency ?? 2;
    const limit = analysisOnly ? 1 : MAX_WORKERS;
    const size = cores - 1 < 1 ? 1 : cores - 1 > limit ? limit : cores - 1;
    const workers = [];
    const queue = [];
    const pending = new Map();
    let nextId = 1;
    let closed = false;

    const abortError = () => new DOMException('The measurement was cancelled.', 'AbortError');
    const onAbort = () => close();

    function close(reason = null) {
        if (closed) return;
        closed = true;
        signal?.removeEventListener('abort', onAbort);
        for (const { worker } of workers) worker.terminate();
        const error = reason ?? abortError();
        for (const { reject } of pending.values()) reject(error);
        for (const job of queue) job.reject(error);
        pending.clear();
        queue.length = 0;
    }

    function dispatch() {
        for (const slot of workers) {
            if (!queue.length) return;
            if (slot.busy) continue;
            const job = queue.shift();
            slot.busy = true;
            const id = nextId++;
            pending.set(id, { ...job, slot });
            slot.worker.postMessage({ id, type: job.type, payload: job.payload });
        }
    }

    function onMessage({ data: { id, result, error } }) {
        const job = pending.get(id);
        if (!job) return;
        pending.delete(id);
        job.slot.busy = false;
        if (error) {
            console.error('Speaker distortion work unit failed:', job.type, error);
            if (job.type === 'init') {
                close(analysisError());
                return;
            }
            job.reject(analysisError());
        } else {
            job.resolve(result);
        }
        dispatch();
    }

    for (let i = 0; i < size; i++) {
        const worker = new Worker(new URL('./identify-worker.js', import.meta.url), { type: 'module' });
        const slot = { worker, busy: !analysisOnly };
        worker.onmessage = onMessage;
        worker.onerror = event => {
            console.error('Speaker distortion worker error:', event?.message ?? event);
            close(analysisError());
        };
        workers.push(slot);
        // Analyzing a capture doesn't use a WASM fitting context.
        if (!analysisOnly) {
            const id = nextId++;
            pending.set(id, { type: 'init', slot, resolve: () => {}, reject: () => {} });
            worker.postMessage({ id, type: 'init', payload: null });
        }
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    return {
        run(type, payload) {
            if (closed || signal?.aborted) return Promise.reject(abortError());
            return new Promise((resolve, reject) => {
                queue.push({ type, payload, resolve, reject });
                dispatch();
            });
        },
        close: () => close()
    };
}

let executorFactory = createWorkerPool;

/**
 * Replaces the executor factory. Node tests pass a factory that runs the
 * handlers of identify-worker.js in the calling thread; null restores the Worker pool.
 */
export function setExecutorFactory(factory) {
    executorFactory = factory ?? createWorkerPool;
}

export async function withExecutor(signal, body, options) {
    signal?.throwIfAborted();
    const executor = executorFactory(signal, options);
    try {
        return await body(executor);
    } finally {
        executor.close();
    }
}

// ---------------------------------------------------------------------------------------------
// Small helpers.

const power = (Y, f) => Y[2 * f] * Y[2 * f] + Y[2 * f + 1] * Y[2 * f + 1];
const positive = value => (value > 0 ? value : 0);
const db = (num, den) => (den > 0 && num >= 0 && Number.isFinite(num / den) ? 10 * Math.log10(num / den) : null);
const perLength = make => Object.fromEntries(LENGTHS.map((key, length) => [key, make(length, key)]));

function median(values) {
    const v = values.filter(value => value !== null).sort((a, b) => a - b);
    const n = v.length;
    if (!n) return null;
    return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

// Half-open [lo, hi); a range ending at 8000 Hz includes 8000.
const inRange = (f, lo, hi) => f >= lo && (f < hi || (hi === MAX_BIN && f === MAX_BIN));

/** Excited-line masks per seed of a channel's Sweep Bandwidth, computed once. */
export function excitedMasks(bandwidth) {
    const masks = new Map();
    return seed => {
        if (!masks.has(seed)) masks.set(seed, combLines(seed, bandwidth).excited);
        return masks.get(seed);
    };
}

// Σ (|Y|² − Pn)⁺ over the non-excited, non-mains odd bins of 50 Hz-8 kHz.
function oddSum(record) {
    let sum = 0;
    for (const f of oddSets(record.excited).odd8k) sum += positive(power(record.Y, f) - record.Pn[f]);
    return sum;
}

// ---------------------------------------------------------------------------------------------
// Figures. A scored entry is { record, S } with S the SCORE block of its record:
// S[scaleIndex·54 + set], sets 0…49 bands (unfloored), 50…52 C1…C3 and 53 the even 50 Hz-8 kHz
// set (floored).

const scoreAt = (S, scaleIndex, set) => S[scaleIndex * SDC_SCORE_SETS + set];

/** power[ℓ][R][s]. `perTake` (R = L): a record adds to a class only when the class is above the limit in it. */
function powerVector(entries, scaleIndex, bins, active, perTake) {
    const out = new Float64Array(POWER_LENGTH);
    for (const { S } of entries) for (let i = 0; i < N_BANDS; i++) out[i] += scoreAt(S, scaleIndex, i);
    let any = false;
    for (let c = 0; c < 3; c++) {
        if (!active[c]) {
            out[50 + c] = NaN;
            continue;
        }
        for (const { record, S } of entries) {
            if (!perTake || aboveLimit([record], bins.score[c])) out[50 + c] += scoreAt(S, scaleIndex, 50 + c);
        }
        out[53] += out[50 + c];
        any = true;
    }
    if (!any) out[53] = NaN;
    for (const { S } of entries) out[54] += scoreAt(S, scaleIndex, 53);
    return out;
}

/** Fold figures at one scale: [C1, C2, C3, even all, total, even 50 Hz-8 kHz]. */
function foldFigures(takes, scaleIndex, bins, active) {
    const values = [0, 1, 2].map(c => {
        if (!active[c]) return null;
        const contributing = takes.filter(({ record }) => aboveLimit([record], bins.score[c]));
        if (!contributing.length) return null;
        let num = 0, den = 0;
        for (const { S } of contributing) {
            num += scoreAt(S, scaleIndex, 50 + c);
            den += scoreAt(S, 0, 50 + c);
        }
        return db(num, den);
    });
    let num = 0, den = 0, anyClass = false;
    for (const { record, S } of takes) {
        for (let c = 0; c < 3; c++) {
            if (!active[c] || !aboveLimit([record], bins.score[c])) continue;
            anyClass = true;
            num += scoreAt(S, scaleIndex, 50 + c);
            den += scoreAt(S, 0, 50 + c);
        }
    }
    values.push(anyClass ? db(num, den) : null);
    let odd = 0, even = 0, even0 = 0;
    for (const { record, S } of takes) {
        odd += record.odd;
        even += scoreAt(S, scaleIndex, 53);
        even0 += scoreAt(S, 0, 53);
    }
    values.push(db(odd + even, odd + even0), db(even, even0));
    return values;
}

/** figL (fold medians per scale) and the predicted worst class at s = +1. */
function figuresAtL(folds, scaleCount, bins, active) {
    const perScale = Array.from({ length: scaleCount }, (_, scaleIndex) =>
        folds.map(takes => foldFigures(takes, scaleIndex, bins, active)));
    const figL = perScale.map(perFold => Array.from({ length: CLASSES.length }, (_, k) => median(perFold.map(values => values[k]))));
    let worst = null;
    for (const values of perScale[1] ?? []) {
        for (let c = 0; c < 3; c++) {
            if (values[c] !== null && (worst === null || values[c] > worst.value)) worst = { value: values[c], classIndex: c };
        }
    }
    return { figL, worst };
}

/** ref[R] (Float32Array(204)) from records { Y, Pn, excited }. */
export function referenceSums(records, bins) {
    const ref = new Float64Array(REF_LENGTH);
    const variance = (record, f) => {
        const pn = record.Pn[f];
        return 2 * positive(power(record.Y, f) - pn) * pn + pn * pn;
    };
    for (const record of records) {
        const odd = oddSets(record.excited);
        for (let i = 0; i <= N_BANDS; i++) {
            const lo = i < N_BANDS ? BAND_EDGES[i] : 50;
            const hi = i < N_BANDS ? BAND_EDGES[i + 1] : MAX_BIN;
            for (let f = 1; f <= MAX_BIN; f++) if (record.excited[f] && inRange(f, lo, hi)) ref[i] += power(record.Y, f);
            for (const f of i < N_BANDS ? odd.bands[i] : odd.odd8k) {
                const excess = power(record.Y, f) - record.Pn[f];
                ref[51 + i] += i < N_BANDS ? excess : positive(excess);
                ref[153 + i] += variance(record, f);
            }
            for (const f of i < N_BANDS ? bins.bands[i] : bins.even8k) ref[102 + i] += variance(record, f);
        }
    }
    return Float32Array.from(ref);
}

/** Repeatability ceiling per score class from the (a) take pairs. */
function repeatabilityCeiling(pairs, bins) {
    return bins.score.map(classBins => median(pairs
        .filter(([A, B]) => aboveLimit([A], classBins) && aboveLimit([B], classBins))
        .map(([A, B]) => {
            let diff = 0, sum = 0;
            for (const f of classBins) {
                const dr = A.Y[2 * f] - B.Y[2 * f], di = A.Y[2 * f + 1] - B.Y[2 * f + 1];
                diff += positive(dr * dr + di * di - A.Pn[f] - B.Pn[f]);
                sum += positive(power(A.Y, f) - A.Pn[f]) + positive(power(B.Y, f) - B.Pn[f]);
            }
            return db(diff / 2, sum / 2);
        })));
}

// ---------------------------------------------------------------------------------------------
// On/off rule.

/**
 * On/off rule of one length. `input` = { failure, figL1, predictedWorst, powerL6, powerPeaks, sweep,
 * response } (figL1 the predicted figures at s = +1, predictedWorst { value, classIndex } or null, the
 * powers by scale, the stored sweep record and the length's single-tone response or null);
 * `checkFig` the measured figures or null. Returns { on, reason, worst }.
 */
export function evaluateRule(input, checkFig = null) {
    if (input.failure) return { on: false, reason: input.failure, worst: null };
    const figures = checkFig ? checkFig.fig : input.figL1;
    if (!(figures[3] !== null && figures[3] <= -2)) return { on: false, reason: 'littleGain', worst: null };
    let worst = checkFig ? null : input.predictedWorst;
    if (checkFig) {
        // The measured classes, the total and the even 50 Hz-8 kHz figure (it covers the range above the classes).
        for (const c of [0, 1, 2, 4, 5]) {
            const value = checkFig.fig[c];
            if (value !== null && (worst === null || value > worst.value)) worst = { value, classIndex: c };
        }
    }
    if (worst && worst.value > 1) {
        return { on: false, reason: 'worseInCheck', worst: { set: 'L', class: CLASSES[worst.classIndex].key } };
    }
    const sweepClass = input.sweep && input.response ? singleToneWorseClass(input.sweep, input.response) : null;
    if (sweepClass) return { on: false, reason: 'worseForSingleTones', worst: { set: 'sweep', class: sweepClass } };
    const l6 = db(input.powerL6[1][53], input.powerL6[0][53]);
    if (l6 !== null && l6 > 0) return { on: false, reason: 'worseAtLowerVolume', worst: { set: 'L-6', class: 'evenAll' } };
    const peaks = db(input.powerPeaks[1][53], input.powerPeaks[0][53]);
    if (peaks !== null && peaks > 0) return { on: false, reason: 'worseAtLoudPeaks', worst: { set: 'peaks', class: 'evenAll' } };
    return { on: true, reason: null, worst: null };
}

/** Rule input of a stored channel entry (a length with weights is re-evaluated with its checkFig). */
export function storedRuleInput(channel, key) {
    return {
        failure: channel.weights[key] ? null : channel.reason[key],
        figL1: channel.figL[key][1] ?? null,
        predictedWorst: null,
        powerL6: channel.power[key]['L-6'],
        powerPeaks: channel.power[key].peaks,
        sweep: channel.sweep,
        response: channel.sweepResponse[key]
    };
}

// ---------------------------------------------------------------------------------------------
// Odd block fit. Odd columns hold the 32 model columns then the microphone
// column on the odd row grid (row r is bin ODD_FIRST_BIN + 2r), interleaved, column-major.

const ODD_UNKNOWNS = ODD_STATES + 1;
const ODD_FIT_RANGES = [[35, 100], [100, 400], [400, 2000]];
const ODD_SCALE_FLOOR = 1e-12;
const ODD_MIC_RIDGE = 1e-6;
const ODD_KEYS = ODD_CLASSES.map(entry => entry.key);
const oddRow = f => (f - ODD_FIRST_BIN) / 2;
const perConfig = make => Object.fromEntries(ODD_CONFIGS.map(c => [c, make(c)]));

/** Non-excited, non-mains odd bins of [lo, hi) Hz of one drive. */
function oddBins(excited, lo, hi) {
    const bins = [];
    for (let f = lo | 1; f < hi; f += 2) if (!excited[f] && !isMains(f)) bins.push(f);
    return Int32Array.from(bins);
}

/** Bins of the odd classes o1-o3 of one drive; oddAll is their union. */
export const oddClassBins = excited => ODD_CLASSES.slice(0, 3).map(({ lo, hi }) => oddBins(excited, lo, hi));

/** Odd classes active at L: above the limit over the (a) records { Y, Pn, excited } pooled, each with its own bins. */
export function oddActiveClasses(aRecords) {
    const recordBins = aRecords.map(record => oddClassBins(record.excited));
    return [0, 1, 2].map(c => {
        let sum = 0, variance = 0, bins = 0;
        aRecords.forEach((record, i) => {
            const sums = limitSums([record], recordBins[i][c]);
            sum += sums.sum;
            variance += sums.variance;
            bins += recordBins[i][c].length;
        });
        return bins > 0 && sum > 2 * Math.sqrt(variance);
    });
}

/** Odd figures [o1, o2, o3, oddAll] from takes [{ above, energies }] with per class [E(1), E(0)] (foldFigures). */
export function oddFigures(takes, active) {
    const values = [0, 1, 2].map(c => {
        const contributing = active[c] ? takes.filter(take => take.above[c]) : [];
        if (!contributing.length) return null;
        let num = 0, den = 0;
        for (const { energies } of contributing) {
            num += energies[c][0];
            den += energies[c][1];
        }
        return db(num, den);
    });
    let num = 0, den = 0, any = false;
    for (const { above, energies } of takes) {
        for (let c = 0; c < 3; c++) {
            if (!active[c] || !above[c]) continue;
            any = true;
            num += energies[c][0];
            den += energies[c][1];
        }
    }
    values.push(any ? db(num, den) : null);
    return values;
}

// Row weights of one record (takeWeights on the odd fit rows) for the oddColumns unit.
function oddRowWeights(record) {
    const wp = new Float64Array(ROW_COUNT);
    let pRef = 0;
    for (const [lo, hi] of ODD_FIT_RANGES) {
        const classBins = oddBins(record.excited, lo, hi);
        if (!aboveLimit([record], classBins)) continue;
        const floor = 0.25 * median(Array.from(classBins, f => record.Pn[f]));
        const pnOf = f => (record.Pn[f] > floor ? record.Pn[f] : floor);
        let norm = 0;
        for (const f of classBins) {
            const p = power(record.Y, f);
            norm += p / pnOf(f);
            pRef += p;
        }
        norm = Math.sqrt(norm);
        for (const f of classBins) wp[oddRow(f)] = 1 / Math.sqrt(pnOf(f)) / norm;
    }
    return { wp, wq2: pRef > 0 ? PENALTY_MU / pRef : 0, Y: record.Y };
}

// Per class [E(1), E(0)] of a record { Y, Pn, oddBins } for odd columns and weights w (33):
// E(s) = Σ(|Y − M·w_m − s·P|² − Pn)⁺ with P the model prediction.
function oddEnergies(record, columns, w) {
    const mic = 2 * ODD_STATES * ROW_COUNT;
    const wm = w[ODD_STATES];
    return record.oddBins.map(bins => {
        let e1 = 0, e0 = 0;
        for (const f of bins) {
            const r = oddRow(f);
            let pr = 0, pi = 0;
            for (let a = 0; a < ODD_STATES; a++) {
                pr += columns[2 * (a * ROW_COUNT + r)] * w[a];
                pi += columns[2 * (a * ROW_COUNT + r) + 1] * w[a];
            }
            const yr = record.Y[2 * f] - wm * columns[mic + 2 * r];
            const yi = record.Y[2 * f + 1] - wm * columns[mic + 2 * r + 1];
            const dr = yr - pr, di = yi - pi;
            e0 += positive(yr * yr + yi * yi - record.Pn[f]);
            e1 += positive(dr * dr + di * di - record.Pn[f]);
        }
        return [e1, e0];
    });
}

// Ridge solve of the 33 odd unknowns (as et_sdc_system/et_sdc_solve): diagonal scaling, λ on the
// model unknowns, a small ridge on the microphone unknown, Cholesky. Null when it fails.
function solveOdd(normal, rhs, lambda) {
    const n = ODD_UNKNOWNS;
    const scale = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const s = Math.sqrt(normal[i * n + i]);
        scale[i] = s > ODD_SCALE_FLOOR ? s : ODD_SCALE_FLOOR;
    }
    const A = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) A[i * n + j] = normal[i * n + j] / scale[i] / scale[j];
    for (let i = 0; i < ODD_STATES; i++) A[i * n + i] += lambda;
    A[n * n - 1] += ODD_MIC_RIDGE;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let sum = A[i * n + j];
            for (let k = 0; k < j; k++) sum -= A[i * n + k] * A[j * n + k];
            if (i === j) {
                if (!(sum > 0)) return null;
                A[i * n + i] = Math.sqrt(sum);
            } else {
                A[i * n + j] = sum / A[j * n + j];
            }
        }
    }
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let sum = rhs[i] / scale[i];
        for (let k = 0; k < i; k++) sum -= A[i * n + k] * x[k];
        x[i] = sum / A[i * n + i];
    }
    for (let i = n; i-- > 0;) {
        let sum = x[i];
        for (let k = i + 1; k < n; k++) sum -= A[k * n + i] * x[k];
        x[i] = sum / A[i * n + i];
    }
    for (let i = 0; i < n; i++) {
        x[i] /= scale[i];
        if (!Number.isFinite(x[i])) return null;
    }
    return x;
}

/**
 * Odd fit rule from figL { o1, o2, o3, oddAll }, figL6 and whether the correction raises the
 * single-tone third harmonic of the sweep record (sweep.js worseForSingleTones): { fitReason, worst }.
 */
export function oddFitRule(figL, figL6, singleTonesWorse = false) {
    if (!(figL.oddAll !== null && figL.oddAll <= -1)) return { fitReason: 'littleGain', worst: null };
    let worst = null;
    for (const key of ODD_KEYS.slice(0, 3)) if (figL[key] !== null && (worst === null || figL[key] > figL[worst])) worst = key;
    if (worst && figL[worst] > 1) return { fitReason: 'worseInCheck', worst: { set: 'L', class: worst } };
    if (figL6 !== null && figL6 > 0) return { fitReason: 'worseAtLowerVolume', worst: { set: 'L-6', class: 'oddAll' } };
    if (singleTonesWorse) return { fitReason: 'worseForSingleTones', worst: null };
    return { fitReason: null, worst: null };
}

/** Reason of the first measured test (1-3) that configuration c fails, null when all pass. */
export function oddMeasuredReason(odd, c) {
    const fig = odd.checkFig[c];
    if (!fig) return 'notChecked';
    if (!(fig.odd[3] !== null && fig.odd[3] <= -1)) return 'littleGain';
    if (!(fig.total !== null && fig.total <= 0)) return 'worseOverall';
    return null;
}

/** Sets odd.on and odd.reason of every configuration from the fit rule and the measured checks (tests 1-4). */
export function evaluateOddChecks(odd) {
    for (const c of ODD_CONFIGS) {
        let reason = odd.fitReason ?? oddMeasuredReason(odd, c);
        if (!reason) {
            const { loud } = odd;
            reason = !loud ? 'notChecked' : loud.t !== null && loud.total !== null && loud.total <= 0.5 ? null : 'worseWhenLoud';
        }
        odd.on[c] = reason === null;
        odd.reason[c] = reason;
    }
    return odd;
}

// Stored odd block before any measured check.
function oddEntry(fit, fitReason, worst) {
    return evaluateOddChecks({
        weights: fit?.weights ?? null,
        bounds: fit?.bounds ?? null,
        lambda: fit?.lambda ?? null,
        figL: Object.fromEntries(ODD_KEYS.map((key, k) => [key, fit?.figL[k] ?? null])),
        figL6: fit?.figL6 ?? null,
        fitReason,
        worst,
        on: perConfig(() => false),
        reason: perConfig(() => null),
        checkFig: perConfig(() => null),
        loud: null,
        sweepResponse: fit?.sweepResponse ?? null
    });
}

/**
 * Odd block of one channel from its records { seed, take, group, X, Y, Pn, excited }, the response g
 * and the stored `sweep` record or null: the stored `odd` entry.
 */
async function fitOdd(executor, { records, g, driveX, excited, sweep }, onUnit) {
    for (const record of records) {
        record.oddBins = oddClassBins(record.excited);
        record.above = record.oddBins.map(bins => aboveLimit([record], bins));
    }
    const active = oddActiveClasses(records.filter(record => record.group === 'a'));
    if (!g) return oddEntry(null, 'noFit', null);
    if (!active.some(Boolean)) return oddEntry(null, 'belowLimit', null);
    const fitRecords = records.filter(record => record.group === 'a' || record.group === 'f');
    const units = await Promise.all(oddFitSeedsOf(records).map(async seed => {
        const takes = fitRecords.filter(record => record.seed === seed);
        const result = await executor.run('oddColumns', {
            X: driveX(seed), g, excited: excited(seed), records: takes.map(oddRowWeights)
        });
        onUnit();
        return { takes, ...result };
    }));

    // B_a over the fit drives; the raw columns and sums become those of s̃ = state/B (|state| ≤ B there).
    const bounds = new Float64Array(ODD_STATES);
    for (let a = 0; a < ODD_STATES; a++) {
        for (const { peaks } of units) if (peaks[a] > bounds[a]) bounds[a] = peaks[a];
        if (!(bounds[a] > 0)) bounds[a] = 1;
    }
    const d = Float64Array.from({ length: ODD_UNKNOWNS }, (_, i) => (i < ODD_STATES ? bounds[i] ** -3 : 1));
    const n = ODD_UNKNOWNS;
    const totalN = new Float64Array(n * n);
    const totalB = new Float64Array(n);
    const groups = units.map(({ takes, columns, grams }) => {
        for (let c = 0; c < ODD_STATES; c++) {
            for (let i = 2 * c * ROW_COUNT; i < 2 * (c + 1) * ROW_COUNT; i++) columns[i] *= d[c];
        }
        const normal = new Float64Array(n * n);
        const rhs = new Float64Array(n);
        for (const gram of grams) {
            for (let i = 0; i < n; i++) {
                rhs[i] += gram.b[i] * d[i];
                for (let j = 0; j < n; j++) normal[i * n + j] += gram.N[i * n + j] * d[i] * d[j];
            }
        }
        for (let i = 0; i < n * n; i++) totalN[i] += normal[i];
        for (let i = 0; i < n; i++) totalB[i] += rhs[i];
        return { takes, columns, normal, rhs };
    });
    const drive7 = executor.run('oddColumns', { X: driveX(7), g, excited: excited(7), bounds }).then(result => {
        onUnit();
        return result;
    });
    const tones = sweep && (await executor.run('oddTones', { kappa: sweepKappa(sweep.levelDbfs), bounds })).columns;
    if (sweep) onUnit();
    const { columns: columns7 } = await drive7;

    // The swept-sine third-harmonic rows join every training set and the final solve; the held-out
    // error and the λ choice stay on the multitone records.
    const { result } = await constrainedSweepFit(sweep, 3, bandWeights => {
        const fitN = Float64Array.from(totalN), fitB = Float64Array.from(totalB);
        if (sweep) addOddToneRows(tones, sweepRows(sweep, fitRecords.length, Infinity, 3, bandWeights), fitN, fitB);
        const result = solveOddFit({ records, active, groups, columns7, totalN: fitN, totalB: fitB });
        if (result) {
            result.bounds = Float32Array.from(bounds);
            result.sweepResponse = tones && oddSweepResponse(tones, result.weights);
        }
        return { result, responses: result?.sweepResponse ? [result.sweepResponse] : [] };
    });
    if (!result) return oddEntry(null, 'noFit', null);
    const { fitReason, worst } = oddFitRule(Object.fromEntries(ODD_KEYS.map((key, k) => [key, result.figL[k]])), result.figL6,
        Boolean(result.sweepResponse) && worseForSingleTones(sweep, result.sweepResponse, 3));
    return oddEntry(result, fitReason, worst);
}

/**
 * Odd fit from the normal equations (totalN, totalB) in s̃ coordinates: λ* minimises the median
 * held-out oddAll over the leave-one-out `groups` (ties to the larger λ). Returns { weights, lambda,
 * figL, figL6 } or null without a solution.
 */
function solveOddFit({ records, active, groups, columns7, totalN, totalB }) {
    const foldsAt = lambda => groups.map(group => {
        const w = solveOdd(totalN.map((value, i) => value - group.normal[i]),
            totalB.map((value, i) => value - group.rhs[i]), lambda);
        return w && group.takes.map(record => ({
            above: record.above, energies: oddEnergies(record, group.columns, w)
        }));
    });
    let best = null;
    for (const lambda of LAMBDA_GRID) {
        const folds = foldsAt(lambda);
        if (folds.some(takes => !takes)) continue;
        const value = median(folds.map(takes => oddFigures(takes, active)[3]));
        if (value !== null && (best === null || value <= best.value)) best = { lambda, value, folds };
    }
    const final = best && solveOdd(totalN, totalB, best.lambda);
    if (!final) return null;
    // figL over the folds of the (a) drives, which precede the (f) drives.
    const perFold = best.folds.slice(0, fitSeedsOf(records).length).map(takes => oddFigures(takes, active));
    return {
        weights: Float32Array.from(final.subarray(0, ODD_STATES)),
        lambda: best.lambda,
        figL: ODD_KEYS.map((_, k) => median(perFold.map(values => values[k]))),
        figL6: oddFigures(records.filter(record => record.group === 'd').map(record => ({
            above: record.above, energies: oddEnergies(record, columns7, final)
        })), active)[3]
    };
}

/**
 * Adds the swept-sine third-harmonic rows { w2, tRe, tIm } (sweepRows) on the oddTones `columns` to
 * the normal equations (totalN, totalB) of the odd fit in s̃ coordinates.
 */
function addOddToneRows(columns, { w2, tRe, tIm }, totalN, totalB) {
    const n = ODD_UNKNOWNS;
    for (let k = 0; k < w2.length; k++) {
        if (!(w2[k] > 0)) continue;
        const re = 2 * k * ODD_STATES, im = re + ODD_STATES;
        for (let i = 0; i < ODD_STATES; i++) {
            const wRe = w2[k] * columns[re + i], wIm = w2[k] * columns[im + i];
            totalB[i] += wRe * tRe[k] + wIm * tIm[k];
            for (let j = 0; j < ODD_STATES; j++) totalN[i * n + j] += wRe * columns[re + j] + wIm * columns[im + j];
        }
    }
}

/**
 * Single-tone third-harmonic response of the odd block (Float32Array(2 × SWEEP_FREQUENCIES.length), re,
 * im per point).
 */
function oddSweepResponse(columns, weights) {
    const count = columns.length / (2 * ODD_STATES);
    const response = new Float32Array(2 * count);
    for (let k = 0; k < count; k++) {
        const re = 2 * k * ODD_STATES, im = re + ODD_STATES;
        let sumRe = 0, sumIm = 0;
        for (let a = 0; a < ODD_STATES; a++) {
            sumRe += columns[re + a] * weights[a];
            sumIm += columns[im + a] * weights[a];
        }
        response[2 * k] = sumRe;
        response[2 * k + 1] = sumIm;
    }
    return response;
}

// ---------------------------------------------------------------------------------------------
// Channel fit shared by the identification and the refit.

// Weight i of a length sits in Gram column i, except Long's second sum (i >= 990), which follows
// Short's at column i + 192.
const LONG_SECOND_TERM = 990;
const LONG_COLUMN_SHIFT = 192;

/**
 * Single-tone response κ·d·w of one length at SWEEP_FREQUENCIES (Float32Array(2 ×
 * SWEEP_FREQUENCIES.length), re, im per point) from the masked κ·d of the sweepGram unit and the stored
 * float32 weights.
 */
function sweepResponse(tones, weights, length) {
    const count = tones.length / (2 * SDC_COLUMNS);
    const response = new Float32Array(2 * count);
    for (let k = 0; k < count; k++) {
        const re = 2 * k * SDC_COLUMNS, im = re + SDC_COLUMNS;
        let sumRe = 0, sumIm = 0;
        for (let i = 0; i < MODEL_TERMS; i++) {
            const column = length === 1 && i >= LONG_SECOND_TERM ? i + LONG_COLUMN_SHIFT : i;
            sumRe += tones[re + column] * weights[i];
            sumIm += tones[im + column] * weights[i];
        }
        response[2 * k] = sumRe;
        response[2 * k + 1] = sumIm;
    }
    return response;
}

/**
 * Fits one channel from its stored calls and drives at `upperLimitHz`, with the swept-sine rows of
 * the stored `sweep` record (diagnosis-analysis.js sweepRecord) when it is not null. Returns
 * { fields, ruleInputs }: `fields` the entries a fit defines (weights, on, reason, worst, power,
 * figL, ref, report, micDistortionWarning, odd, sweepResponse), `ruleInputs` per length for
 * evaluateRule.
 */
export async function fitChannel(executor, { calls, drives, bandwidth, upperLimitHz, sweep }, onUnit = () => {}) {
    const excited = excitedMasks(bandwidth);
    const driveX = seed => drives.find(drive => drive.seed === seed).X;
    const records = calls.map(call => {
        const record = { ...call, X: driveX(call.seed), excited: excited(call.seed) };
        record.odd = oddSum(record);
        return record;
    });
    const aRecords = records.filter(record => record.group === 'a');
    const fitSeeds = fitSeedsOf(records);
    const takesOf = seed => aRecords.filter(record => record.seed === seed);
    const bins = binSets(upperLimitHz);
    const active = activeClasses(aRecords, bins);
    const g = estimateG(aRecords);
    const failure = !g ? 'noFit' : isBelowLimit(aRecords, bins, active) ? 'belowLimit' : null;
    const tick = result => {
        onUnit();
        return result;
    };
    // The odd block runs beside the even fit; it is awaited below, and the handler only keeps an
    // early even-fit failure from leaving its rejection unhandled.
    const oddFit = fitOdd(executor, { records, g, driveX, excited, sweep }, onUnit);
    oddFit.catch(() => {});

    // Steps 1-4: seed Grams, folds over the λ grid, final solves.
    let fits = [null, null];
    let micSum = 0;
    if (!failure) {
        const mask = termMask(...excitedRange(fitSeeds.map(excited)));
        const rowMask = new Uint8Array(ROW_COUNT);
        for (const f of bins.mic) rowMask[f / 2 - 18] = 1;
        const rows = fitSeeds.map(seed =>
            seedRows(takesOf(seed).map(record => ({ record, ...takeWeights(record, bins) })), g, bins.qRow));
        const grams = await Promise.all(fitSeeds.map((seed, s) => executor.run('seedGram', {
            X: driveX(seed), g, excited: excited(seed), termMask: mask, rowWeight: rows[s].rowWeight,
            carrier: rows[s].carrier, qRow: bins.qRow, rowMask
        }).then(tick)));
        const seedTotal = new Float64Array(grams[0].gram.length);
        for (const { gram, micSum: seedMic } of grams) {
            for (let i = 0; i < seedTotal.length; i++) seedTotal[i] += gram[i];
            micSum += seedMic;
        }
        // The swept-sine rows join every training set (a fold leaves out one seed Gram only); the
        // held-out error and the λ choice stay on the multitone records.
        ({ fits } = await constrainedSweepFit(sweep, 2, async bandWeights => {
            let total = seedTotal, tones = null;
            if (sweep) {
                const { w2, tRe, tIm } = sweepRows(sweep, aRecords.length, upperLimitHz, 2, bandWeights);
                const swept = await executor.run('sweepGram', {
                    tRe, tIm, w2, kappa: sweepKappa(sweep.levelDbfs), termMask: mask
                });
                tick();
                total = Float64Array.from(seedTotal, (value, i) => value + swept.gram[i]);
                tones = swept.tones;
            }
            const folds = await Promise.all(fitSeeds.map((_, s) => executor.run('folds', {
                total, gram: grams[s].gram, yy: rows[s].yy, lambdas: LAMBDA_GRID
            }).then(tick)));
            const count = LAMBDA_GRID.length;
            const best = [0, 1].map(length => {
                let index = -1, bestValue = 0;
                for (let k = 0; k < count; k++) {
                    let value = 0;
                    for (const { E } of folds) value += E[length * count + k];
                    if (Number.isFinite(value) && (index < 0 || value <= bestValue)) {
                        index = k;
                        bestValue = value;
                    }
                }
                return index;
            });
            const finals = await Promise.all([0, 1].map(length => (best[length] < 0 ? null
                : executor.run('final', { total, length, lambda: LAMBDA_GRID[best[length]] }).then(tick))));
            const lengthFits = [0, 1].map(length => {
                if (!finals[length]?.weights) return null;
                const offset = (length * count + best[length]) * SDC_UNKNOWNS;
                const final = finals[length].weights;
                const weights = Float32Array.from(final.subarray(0, MODEL_TERMS));
                return {
                    lambda: LAMBDA_GRID[best[length]],
                    final,
                    weights,
                    response: tones && sweepResponse(tones, weights, length),
                    folds: folds.map(({ weights: foldWeights }) => foldWeights.slice(offset, offset + SDC_UNKNOWNS))
                };
            });
            return { fits: lengthFits, responses: lengthFits.flatMap(fit => (fit?.response ? [fit.response] : [])) };
        }));
    }

    // Step 5: SCORE blocks of every record; a length without a fit uses zero weights.
    const rowSet = new Uint8Array(3 * 4001);
    rowSet.fill(255, 0, 2 * 4001);
    bins.bands.forEach((band, i) => { for (const f of band) rowSet[f / 2] = i; });
    bins.score.forEach((classBins, c) => { for (const f of classBins) rowSet[4001 + f / 2] = c; });
    for (const f of bins.even8k) rowSet[8002 + f / 2] = 1;
    const zero = new Float64Array(SDC_UNKNOWNS);
    // A fit seed is scored out of fold, every other seed with the final vector.
    const vectorOf = (length, seed) => (!fits[length] ? zero
        : fitSeeds.includes(seed) ? fits[length].folds[fitSeeds.indexOf(seed)] : fits[length].final);
    const scoreOf = [new Map(), new Map()];
    await Promise.all(seedsOf(records).map(async seed => {
        const scored = fitSeeds.includes(seed) ? takesOf(seed) : records.filter(record => record.seed === seed && record.group !== 'a');
        const { scores } = await executor.run('score', {
            X: driveX(seed), g, excited: excited(seed), rowSet,
            vectors: [vectorOf(0, seed), vectorOf(1, seed)],
            records: scored.map(({ Y, Pn, group }) => ({ Y, Pn, predScale: group === 'e' ? E_SCALE : 1 }))
        });
        tick();
        for (let length = 0; length < 2; length++) scored.forEach((record, i) => scoreOf[length].set(record, scores[length][i]));
    }));

    // Step 6: figures, rule and report.
    let aPower = 0;
    for (const record of aRecords) for (const f of bins.mic) aPower += positive(power(record.Y, f) - record.Pn[f]);
    // micSum holds one term per fit seed and aPower one per (a) take, so the share scales by the takes per seed.
    const takesPerSeed = aRecords.length / fitSeeds.length;
    const lengths = [0, 1].map(length => {
        const lengthFailure = failure ?? (fits[length] ? null : 'noFit');
        const scaleCount = lengthFailure ? 1 : SCALES.length;
        const entriesOf = set => records.filter(record => record.group === SET_GROUPS[set])
            .map(record => ({ record, S: scoreOf[length].get(record) }));
        const powers = Object.fromEntries(SETS.map(set => [set, Array.from({ length: scaleCount }, (_, scaleIndex) =>
            powerVector(entriesOf(set), scaleIndex, bins, active, set === 'L'))]));
        const aEntries = entriesOf('L');
        const { figL, worst } = figuresAtL(fitSeeds.map(seed => aEntries.filter(({ record }) => record.seed === seed)),
            scaleCount, bins, active);
        const micWeight = fits[length] ? fits[length].final[MODEL_TERMS] : null;
        const weights = fits[length]?.weights ?? null;
        const response = fits[length]?.response ?? null;
        const ruleInput = {
            failure: lengthFailure, figL1: figL[1] ?? null, predictedWorst: worst,
            powerL6: powers['L-6'], powerPeaks: powers.peaks, sweep: sweep ?? null, response
        };
        return {
            ruleInput,
            rule: evaluateRule(ruleInput),
            weights,
            response,
            power: Object.fromEntries(SETS.map(set => [set, powers[set].map(vector => Float32Array.from(vector))])),
            figL,
            lambda: fits[length]?.lambda ?? null,
            micWeight,
            micShare: micWeight === null ? null : db(takesPerSeed * micWeight * micWeight * micSum, aPower),
            worst: worst?.value ?? null
        };
    });
    const byKey = pick => perLength(length => pick(lengths[length]));
    const ref = Object.fromEntries(SETS.map(set =>
        [set, referenceSums(records.filter(record => record.group === SET_GROUPS[set]), bins)]));
    // Without a second take (fast plan) no pair exists and every class of the ceiling is null.
    const ceiling = repeatabilityCeiling(fitSeeds.map(takesOf).filter(takes => takes.length === 2), bins);
    return {
        fields: {
            weights: byKey(entry => entry.weights),
            on: byKey(entry => entry.rule.on),
            reason: byKey(entry => entry.rule.reason),
            worst: byKey(entry => entry.rule.worst),
            power: byKey(entry => entry.power),
            figL: byKey(entry => entry.figL),
            ref,
            report: {
                lambda: byKey(entry => entry.lambda),
                micWeight: byKey(entry => entry.micWeight),
                micShare: byKey(entry => entry.micShare),
                worst: byKey(entry => entry.worst),
                ceiling
            },
            micDistortionWarning: lengths.some(entry => entry.micShare !== null && entry.micShare > MIC_WARNING_DB),
            odd: await oddFit,
            sweepResponse: byKey(entry => entry.response)
        },
        ruleInputs: byKey(entry => entry.ruleInput)
    };
}

// ---------------------------------------------------------------------------------------------
// Amplifier change estimator.

/**
 * Gain a of the stored model's prediction in a plain record { Y, Pn } of drive { X, excited }
 * with the float32 weights of `length` (0 Short, 1 Long): { a, se, z }, or null when it cannot
 * be formed.
 */
export async function estimateAmplifier(executor, { record, X, excited, weights, length }) {
    const g = estimateG([{ ...record, X, excited }]);
    if (!g) return null;
    const { T, M } = await executor.run('checkPredict', { X, g, excited, weights, length });
    const { Y, Pn } = record;
    let tt = 0, mm = 0, n = 0;
    let tmr = 0, tmi = 0, tyr = 0, tyi = 0, myr = 0, myi = 0;
    for (let r = 0; r < ROW_COUNT; r++) {
        const f = rowFrequency(r);
        if (isMains(f) || !(Pn[f] > 0)) continue;
        const v = 1 / Pn[f];
        const Tr = T[2 * r], Ti = T[2 * r + 1], Mr = M[2 * r], Mi = M[2 * r + 1];
        const Yr = Y[2 * f], Yi = Y[2 * f + 1];
        tt += v * (Tr * Tr + Ti * Ti);
        mm += v * (Mr * Mr + Mi * Mi);
        tmr += v * (Tr * Mr + Ti * Mi);
        tmi += v * (Tr * Mi - Ti * Mr);
        tyr += v * (Tr * Yr + Ti * Yi);
        tyi += v * (Tr * Yi - Ti * Yr);
        myr += v * (Mr * Yr + Mi * Yi);
        myi += v * (Mr * Yi - Mi * Yr);
        n++;
    }
    const denominator = tt - (tmr * tmr + tmi * tmi) / mm;
    if (!(n > 3) || !(mm > 0) || !(denominator > 0)) return null;
    // a = Re(ty − tm·my/mm)/den; b = (my − a·conj(tm))/mm.
    const a = (tyr - (tmr * myr - tmi * myi) / mm) / denominator;
    const br = (myr - a * tmr) / mm, bi = (myi + a * tmi) / mm;
    let residualSum = 0;
    for (let r = 0; r < ROW_COUNT; r++) {
        const f = rowFrequency(r);
        if (isMains(f) || !(Pn[f] > 0)) continue;
        const er = Y[2 * f] - a * T[2 * r] - (br * M[2 * r] - bi * M[2 * r + 1]);
        const ei = Y[2 * f + 1] - a * T[2 * r + 1] - (br * M[2 * r + 1] + bi * M[2 * r]);
        residualSum += (er * er + ei * ei) / Pn[f];
    }
    const se = Math.sqrt(residualSum / (n - 3) / (2 * denominator));
    return { a, se, z: a / se };
}

/** ampRef per length from the plain correction-check record and the stored weights. */
export async function amplifierReferences(executor, { checkCall, drives, bandwidth, weights }) {
    const X = drives.find(drive => drive.seed === CHECK_SEED).X;
    const excited = combLines(CHECK_SEED, bandwidth).excited;
    const values = await Promise.all(LENGTHS.map(async (key, length) => {
        if (!checkCall || !weights[key]) return null;
        const estimate = await estimateAmplifier(executor, { record: checkCall, X, excited, weights: weights[key], length });
        return estimate && estimate.z >= AMP_MIN_Z ? estimate.a : null;
    }));
    return perLength(length => values[length]);
}

// ---------------------------------------------------------------------------------------------
// Capture plan and level check.

const signalLevel = settings => (settings.signalLevelDbfs < -10 ? settings.signalLevelDbfs : -10);

/**
 * Level-check signal and the data its judgement needs, from the calls of drives 1 (at L) and 8
 * (at L + 10), each { samples, chirp }.
 */
export function levelCheckOf(first, loud, { rateHz, bandwidth }) {
    return {
        levelCheck: levelCheckSignal(first.samples, loud.samples, rateHz),
        levelChirp: first.chirp,
        rateHz,
        bandwidth: [...bandwidth]
    };
}

/** Capture plan of one channel. */
export function buildCapturePlan(settings, { signal = null } = {}) {
    const { rateHz: fsDev, bandwidth, sweepLength, averaging } = settings;
    // An unmeasurable band would make silent or NaN test signals; refuse it before any is built.
    if (!isMeasurableBand(bandwidth)) throw new Error(`Speaker distortion: unmeasurable band ${bandwidth.join('-')} Hz`);
    const L = signalLevel(settings);
    const K = 7 * averaging;
    return withExecutor(signal, async executor => {
        const callUnit = (seed, targetDbfs, k = K, factor = null) =>
            executor.run('call', { seed, bandwidth, targetDbfs, K: k, fsDev, factor });
        const d = callUnit(7, L - 6);
        const [a, dCall, eCall, f, check] = await Promise.all([
            Promise.all(FIT_SEEDS.map(seed => callUnit(seed, L))),
            d,
            d.then(dResult => callUnit(7, L - 12, K, dResult.factor * 10 ** (-6 / 20))),
            Promise.all([8, 9].map(seed => callUnit(seed, L + 10))),
            callUnit(CHECK_SEED, L, CHECK_K)
        ]);
        const call = (unit, seed, take, group, peakDbfs) =>
            ({ kind: 'call', samples: unit.samples, chirp: unit.chirp, seed, take, group, peakDbfs, K });
        const sweep = createEssSignal({
            length: sweepLength, sampleRate: fsDev, startFrequency: bandwidth[0], endFrequency: bandwidth[1]
        });
        const sweepLengthTotal = sweep.length + sweep.tailSamples;
        const sweepAt = peakDbfs => {
            const samples = new Float32Array(sweepLengthTotal);
            const scale = 10 ** (peakDbfs / 20);
            for (let n = 0; n < sweep.length; n++) samples[n] = sweep.signal[n] * scale;
            return samples;
        };
        // The fast plan plays one take of each call instead of the A/B pair.
        const takes = settings.fast ? ['A'] : ['A', 'B'];
        const captures = [
            ...takes.flatMap(take => a.map((unit, i) => call(unit, i + 1, take, 'a', L))),
            ...takes.map(take => call(dCall, 7, take, 'd', L - 6)),
            call(eCall, 7, 'A', 'e', L - 12),
            ...takes.flatMap(take => f.map((unit, i) => call(unit, 8 + i, take, 'f', L + 10))),
            { kind: 'essL', samples: sweepAt(L) },
            { kind: 'ess6', samples: sweepAt(L - 6) },
            { kind: 'silence', samples: new Float32Array(sweepLengthTotal) }
        ].map((capture, i, all) => ({ ...capture, gapSeconds: i < all.length - 1 ? CAPTURE_GAP_SECONDS : 0 }));
        const drives = [
            ...a.map((unit, i) => ({ seed: i + 1, X: unit.X })),
            { seed: 7, X: dCall.X },
            { seed: 8, X: f[0].X },
            { seed: 9, X: f[1].X },
            { seed: CHECK_SEED, X: check.X }
        ];
        return {
            levelDbfs: L,
            peakDbfs: L + 10,
            ...levelCheckOf(a[0], f[0], { rateHz: fsDev, bandwidth }),
            captures,
            check: { samples: check.samples, chirp: check.chirp, seed: CHECK_SEED, K: CHECK_K },
            drives
        };
    });
}

/**
 * Signal power on the excited lines of the period mean and noise power (one period's share on every
 * line, K·Pn), both between 50 Hz and 8 kHz, of an analysed call.
 */
function callPowers(record, excited, K) {
    let signal = 0, noise = 0;
    for (let f = 50; f <= MAX_BIN; f++) {
        if (excited[f]) signal += power(record.Y, f);
        noise += K * record.Pn[f];
    }
    return { signal, noise };
}

/**
 * { signal, noise } powers of the recording of the call { seed, K, chirp } on the channel
 * { rateHz, bandwidth }, measured as in the level check. The spectrum is computed in a worker.
 */
export async function callSignalNoise(recording, { seed, K, chirp }, { rateHz, bandwidth }, { signal = null } = {}) {
    const record = await withExecutor(signal, executor =>
        executor.run('analyze', { capture: recording, fsDev: rateHz, K, chirp }), { analysisOnly: true });
    // Only the K full periods after the fade-in contribute to the estimate. Reject captures
    // that the analyzer would complete with zero padding in those periods.
    const end = record.latency + Math.round(0.5 * rateHz) + Math.round((K + 1) * rateHz);
    if (recording.length < end) throw analysisError();
    const powers = callPowers(record, combLines(seed, bandwidth).excited, K);
    if (!(powers.signal > 0) || !Number.isFinite(powers.signal) || !Number.isFinite(powers.noise)) throw analysisError();
    return powers;
}

/**
 * Level-check outcome: { outcome, headroomDb, snrDb, noisePower } (headroomDb null for a silent recording;
 * snrDb, the test signal at Signal Level over the noise between 50 Hz and 8 kHz, and noisePower, that
 * noise, only for an analysed recording).
 */
export function judgeLevelCheck(recording, plan) {
    let peak = 0;
    for (let n = 0; n < recording.length; n++) {
        const value = recording[n] < 0 ? -recording[n] : recording[n];
        if (value > peak) peak = value;
    }
    // Digital silence (a muted or unconnected input) carries no noise to judge the burst against.
    if (peak === 0) return { outcome: 'tooQuiet', headroomDb: null };
    const headroomDb = -20 * Math.log10(peak);
    if (peak >= LEVEL_CHECK_OVERLOAD) return { outcome: 'overloaded', headroomDb };
    let record;
    try {
        record = analyzeCall(recording, { fsDev: plan.rateHz, K: LEVEL_CHECK_K, chirp: plan.levelChirp });
    } catch (error) {
        console.warn('Speaker distortion level check: no usable recording.', error);
        return { outcome: 'tooQuiet', headroomDb };
    }
    // With K = 2, Pn rests on one period difference, so noise alone meets |Y|² ≥ 25·Pn on about 4 %
    // of the lines; a burst counts as measurable only when a tenth of its lines do.
    const excited = combLines(1, plan.bandwidth).excited;
    let lines = 0, measured = 0;
    for (let f = 50; f <= MAX_BIN; f++) {
        lines += excited[f];
        if (isMeasured(record, excited, f)) measured++;
    }
    const { signal, noise } = callPowers(record, excited, LEVEL_CHECK_K);
    return {
        outcome: measured >= LEVEL_CHECK_MEASURED_SHARE * lines ? 'passed' : 'tooQuiet',
        headroomDb,
        snrDb: 10 * Math.log10(signal / noise),
        noisePower: noise
    };
}

// ---------------------------------------------------------------------------------------------
// Identification and refit.

/** Channel entry for one channel from its recordings, one per capture of `plan`. */
export function identifySpeakerModel({ recordings, plan, settings, signal = null, onProgress = null }) {
    return withExecutor(signal, async executor => {
        const callCaptures = plan.captures.filter(capture => capture.kind === 'call');
        const recordingOf = kind => recordings[plan.captures.findIndex(capture => capture.kind === kind)];
        // The sweep record is only known after the diagnosis; its fit unit is counted up front.
        const total = callCaptures.length + fitUnits(callCaptures, true) + 1;
        let done = 0;
        const tick = () => onProgress?.(++done < total ? done / total : 1);
        const calls = await Promise.all(callCaptures.map(async capture => {
            const { Y, Pn } = await executor.run('analyze', {
                capture: recordings[plan.captures.indexOf(capture)], fsDev: settings.rateHz, K: capture.K, chirp: capture.chirp
            });
            tick();
            const { seed, take, group, peakDbfs, K } = capture;
            return { seed, take, group, peakDbfs, K, Y, Pn };
        }));
        let diagnosis = null;
        let sweep = null;
        try {
            ({ diagnosis, sweep } = await executor.run('diagnosis', {
                essL: recordingOf('essL'), ess6: recordingOf('ess6'), silence: recordingOf('silence'), calls,
                rateHz: settings.rateHz, bandwidth: settings.bandwidth, sweepLength: settings.sweepLength,
                levelDbfs: plan.levelDbfs
            }));
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            console.error('Speaker distortion diagnosis failed; the channel is stored without it.', error);
        }
        const { fields } = await fitChannel(executor, {
            calls, drives: plan.drives, bandwidth: settings.bandwidth, upperLimitHz: settings.upperLimitHz, sweep
        }, tick);
        onProgress?.(1);
        return {
            index: settings.index,
            label: settings.label,
            rateHz: settings.rateHz,
            bandwidth: [...settings.bandwidth],
            inputDeviceId: settings.inputDeviceId,
            inputDeviceLabel: settings.inputDeviceLabel,
            calls,
            drives: plan.drives,
            checkCall: null,
            ampRef: perLength(() => null),
            checkFig: perLength(() => null),
            ...fields,
            diagnosis,
            sweep
        };
    });
}

const sameBits = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    const x = new Uint32Array(a.buffer, a.byteOffset, a.length);
    const y = new Uint32Array(b.buffer, b.byteOffset, b.length);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
};

/** Fields a refit at `upperLimitHz` replaces, one object per channel of `model`. */
export function refitSpeakerModel(model, upperLimitHz, { signal = null, onChannelProgress = null } = {}) {
    return withExecutor(signal, async executor => {
        const results = [];
        for (const [index, channel] of model.channels.entries()) {
            let done = 0;
            const units = fitUnits(channel.calls, channel.sweep);
            const { fields, ruleInputs } = await fitChannel(executor, {
                calls: channel.calls, drives: channel.drives, bandwidth: channel.bandwidth, upperLimitHz, sweep: channel.sweep
            }, () => onChannelProgress?.(index, ++done < units ? done / units : 1));
            const ampRef = await amplifierReferences(executor, { ...channel, weights: fields.weights });
            const checkFig = perLength((_, key) =>
                (sameBits(channel.weights[key], fields.weights[key]) ? channel.checkFig[key] : null));
            if (channel.odd) {
                // A slot survives when every weight that played in it is bit-identical.
                const { odd } = fields;
                const sameOdd = sameBits(channel.odd.weights, odd.weights) && sameBits(channel.odd.bounds, odd.bounds);
                for (const c of ODD_CONFIGS) {
                    const sameEven = c === 'alone' || sameBits(channel.weights[c], fields.weights[c]);
                    odd.checkFig[c] = sameOdd && sameEven ? channel.odd.checkFig[c] : null;
                }
                odd.loud = channel.odd.loud;
                evaluateOddChecks(odd);
            }
            for (const key of LENGTHS) {
                if (!checkFig[key]) continue;
                const { on, reason, worst } = evaluateRule(ruleInputs[key], checkFig[key]);
                fields.on[key] = on;
                fields.reason[key] = reason;
                fields.worst[key] = worst;
            }
            onChannelProgress?.(index, 1);
            results.push({ ...fields, ampRef, checkFig });
        }
        return results;
    });
}
