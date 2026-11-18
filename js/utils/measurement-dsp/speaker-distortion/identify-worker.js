// Work units of the speaker distortion identification. Each handler is a
// plain function of an identification context and a request; the module also runs as a Worker
// that loads the DSP module once (`init`) and answers { id, type, payload } messages.
import { instantiateDsp, loadDspModule } from '../../../audio/dsp-wasm-loader.js';
import {
    SDC_BUFFER, SDC_COLUMNS, SDC_COLUMN_STRIDE, SDC_PACKED_LENGTH, SDC_SCORE_SCALES, SDC_SCORE_SETS, SDC_UNKNOWNS,
    createSdcContext
} from './kernels.js';
import { analyzeCall, ROW_COUNT } from './preprocess.js';
import { MAX_BIN, N, assembleCall, buildCall, seedCall, synthesizeInto } from './signals.js';
import { analyzeDiagnosis } from './diagnosis-analysis.js';
import { ODD_FIRST_BIN, ODD_STATES, SWEEP_FREQUENCIES } from './constants.js';

const SCORE_BLOCK = SDC_SCORE_SCALES * SDC_SCORE_SETS;
const ODD_RMS = 0.1;
const EVEN_BINS = 4001;
const MODEL_TERMS = SDC_UNKNOWNS - 1;
// Model columns (both lengths) before MIC and RHS.
const MODEL_COLUMNS = SDC_COLUMNS - 2;

function loadDrive(context, X, g, excited) {
    context.view(SDC_BUFFER.DRIVE).set(X);
    const G = context.view(SDC_BUFFER.G);
    if (g) {
        G.set(g);
    } else {
        // The corrector states do not depend on g; MIC is then unused.
        G.fill(0);
        for (let i = 0; i < G.length; i += 2) G[i] = 1;
    }
    context.view(SDC_BUFFER.EXCITED).set(excited);
    context.drive();
}

// Stored float32 model weights of one length into slot 0 with a zero microphone weight.
function loadStoredWeights(context, weights) {
    const slot = context.view(SDC_BUFFER.WEIGHTS);
    for (let i = 0; i < MODEL_TERMS; i++) slot[i] = weights[i];
    slot[MODEL_TERMS] = 0;
}

/**
 * `call`: device-rate call of drive `seed` within `bandwidth` and its stored X (seedCall). A stored
 * (already scaled) `X` is replayed as is with factor 1.
 */
export function call(context, { seed, bandwidth, targetDbfs, K, fsDev, factor = null, X: storedX = null }) {
    const settings = { targetDbfs, K, fsDev, bandwidth };
    return storedX
        ? buildCall(context, Float64Array.from(storedX), { ...settings, factor: 1 })
        : seedCall(context, seed, { ...settings, factor });
}

/** `analyze`: Y and Pn of one capture (see analyzeCall for the options). */
export function analyze(_context, { capture, ...options }) {
    return analyzeCall(capture, options);
}

/** `diagnosis`: the diagnosis block. */
export function diagnosis(_context, request) {
    return analyzeDiagnosis(request);
}

/**
 * `seedGram`: packed seed Gram and Σ_{f∈S} |M[f]|² over the rows with rowMask[r] = 1.
 */
export function seedGram(context, { X, g, excited, termMask, rowWeight, carrier, qRow, rowMask }) {
    loadDrive(context, X, g, excited);
    const mic = context.view(SDC_BUFFER.MIC);
    let micSum = 0;
    for (let r = 0; r < ROW_COUNT; r++) {
        if (rowMask[r]) micSum += mic[2 * r] * mic[2 * r] + mic[2 * r + 1] * mic[2 * r + 1];
    }
    context.view(SDC_BUFFER.TERM_MASK).set(termMask);
    context.columns();
    context.view(SDC_BUFFER.ROWW).set(rowWeight);
    context.view(SDC_BUFFER.CARRIER).set(carrier);
    context.gram(qRow);
    return { gram: context.packGram(SDC_BUFFER.GRAM_S).slice(), micSum };
}

/**
 * `folds`: for both lengths the fold weights at every λ (Float64Array(2 × count × 1183), Short
 * first) and the held-out E of the left-out seed (Float64Array(2 × count), NaN for a failed solve).
 */
export function folds(context, { total, gram, yy, lambdas }) {
    const count = lambdas.length;
    context.view(SDC_BUFFER.GRAM_T).set(total);
    context.view(SDC_BUFFER.GRAM_S).set(gram);
    const weights = new Float64Array(2 * count * SDC_UNKNOWNS);
    const E = new Float64Array(2 * count);
    for (let length = 0; length < 2; length++) {
        context.system(length, true);
        const solved = lambdas.map((lambda, k) => context.solve(lambda, k));
        context.heldout(length, count, yy);
        const out = context.view(SDC_BUFFER.OUT);
        for (let k = 0; k < count; k++) E[length * count + k] = solved[k] ? out[k] : NaN;
        weights.set(context.view(SDC_BUFFER.WEIGHTS).subarray(0, count * SDC_UNKNOWNS), length * count * SDC_UNKNOWNS);
    }
    return { weights, E };
}

/** `final`: weights of N_T at λ* for `length` (0 Short, 1 Long), or null when the solve fails. */
export function final(context, { total, length, lambda }) {
    context.view(SDC_BUFFER.GRAM_T).set(total);
    context.system(length, false);
    if (!context.solve(lambda, 0)) return { weights: null };
    return { weights: context.view(SDC_BUFFER.WEIGHTS).slice(0, SDC_UNKNOWNS) };
}

// Swept-sine rows. d(f) holds the corrector columns at 2f (row f − 18) for a drive with one line
// of amplitude 1 at f; the columns are quadratic in the drive, so several tones share a drive while
// no other product of the group (a sum, a difference or a line itself) lands on a 2f of the group.

/** Groups of indices into the ascending `frequencies` whose tones can share one drive. */
export function toneGroups(frequencies) {
    const groups = [];
    for (const [index, f] of frequencies.entries()) {
        const group = groups.find(({ members, products, targets }) => {
            if (products.has(2 * f) || targets.has(f)) return false;
            for (const g of members) {
                if (targets.has(frequencies[g] + f) || targets.has(f - frequencies[g])) return false;
            }
            return true;
        });
        const entry = group ?? { members: [], products: new Set(), targets: new Set() };
        for (const g of entry.members) {
            entry.products.add(frequencies[g] + f);
            entry.products.add(f - frequencies[g]);
        }
        entry.products.add(f);
        entry.targets.add(2 * f);
        entry.members.push(index);
        if (!group) groups.push(entry);
    }
    return groups.map(({ members }) => members);
}

let toneCache = null;

// d at SWEEP_FREQUENCIES (Float64Array(SWEEP_FREQUENCIES.length × 2 × 1376), re then im per point;
// the MIC and RHS entries 0). Channel independent, so computed once per worker.
function toneColumns(context) {
    if (toneCache) return toneCache;
    const tones = new Float64Array(SWEEP_FREQUENCIES.length * 2 * SDC_COLUMNS);
    const X = new Float64Array(2 * (MAX_BIN + 1));
    const excited = new Uint8Array(MAX_BIN + 1);
    const mask = new Uint8Array(SDC_COLUMNS).fill(1, 0, MODEL_COLUMNS);
    for (const group of toneGroups(SWEEP_FREQUENCIES)) {
        X.fill(0);
        excited.fill(0);
        for (const k of group) {
            X[2 * SWEEP_FREQUENCIES[k]] = 1;
            excited[SWEEP_FREQUENCIES[k]] = 1;
        }
        loadDrive(context, X, null, excited);
        context.view(SDC_BUFFER.TERM_MASK).set(mask);
        context.columns();
        const columns = context.view(SDC_BUFFER.COLUMNS);
        for (const k of group) {
            const r = SWEEP_FREQUENCIES[k] - 18;
            const re = 2 * k * SDC_COLUMNS, im = re + SDC_COLUMNS;
            for (let j = 0; j < MODEL_COLUMNS; j++) {
                tones[re + j] = columns[j * SDC_COLUMN_STRIDE + r];
                tones[im + j] = columns[j * SDC_COLUMN_STRIDE + ROW_COUNT + r];
            }
        }
    }
    toneCache = tones;
    return tones;
}

/**
 * `sweepGram`: the swept-sine rows a_k = κ·d(f_k) with target t_k and LS weight w2[k] (rows with
 * w2[k] = 0 are left out), columns outside `termMask` zeroed. Returns { gram } the packed Gram
 * (Float64Array(947376), RHS last, the layout of seedGram) and { tones } κ·d at every point
 * (Float64Array(SWEEP_FREQUENCIES.length × 2 × 1376), re then im).
 */
export function sweepGram(context, { tRe, tIm, w2, kappa, termMask }) {
    const d = toneColumns(context);
    const tones = new Float64Array(d.length);
    for (let i = 0; i < d.length; i++) tones[i] = termMask[i % SDC_COLUMNS] ? kappa * d[i] : 0;
    const gram = new Float64Array(SDC_PACKED_LENGTH);
    const aRe = new Float64Array(SDC_COLUMNS), aIm = new Float64Array(SDC_COLUMNS);
    const rhs = SDC_COLUMNS - 1;
    for (let k = 0; k < SWEEP_FREQUENCIES.length; k++) {
        if (!(w2[k] > 0)) continue;
        const w = Math.sqrt(w2[k]);
        const re = 2 * k * SDC_COLUMNS, im = re + SDC_COLUMNS;
        for (let j = 0; j < rhs; j++) {
            aRe[j] = w * tones[re + j];
            aIm[j] = w * tones[im + j];
        }
        aRe[rhs] = w * tRe[k];
        aIm[rhs] = w * tIm[k];
        for (let i = 0, offset = 0; i < SDC_COLUMNS; offset += ++i) {
            const xr = aRe[i], xi = aIm[i];
            if (xr === 0 && xi === 0) continue;
            for (let j = 0; j <= i; j++) gram[offset + j] += xr * aRe[j] + xi * aIm[j];
        }
    }
    return { gram, tones };
}

/**
 * `score`: SCORE blocks of one drive. `vectors` holds per length (0 Short, 1 Long) the
 * weight vectors (Float64Array(count × 1183)); every record { Y, Pn, predScale } is scored against
 * every vector of both lengths. Returns scores[length][record] = Float64Array(count × 270).
 */
export function score(context, { X, g, excited, rowSet, vectors, records }) {
    loadDrive(context, X, g, excited);
    context.view(SDC_BUFFER.ROWSET).set(rowSet);
    const y = context.view(SDC_BUFFER.Y);
    const pn = context.view(SDC_BUFFER.PN);
    const scores = [[], []];
    for (let length = 0; length < 2; length++) {
        const count = vectors[length].length / SDC_UNKNOWNS;
        context.view(SDC_BUFFER.WEIGHTS).set(vectors[length]);
        context.predict(length, count);
        for (const { Y, Pn, predScale } of records) {
            for (let k = 0; k < EVEN_BINS; k++) {
                y[2 * k] = Y[4 * k];
                y[2 * k + 1] = Y[4 * k + 1];
                pn[k] = Pn[2 * k];
            }
            context.score(count, predScale);
            scores[length].push(context.view(SDC_BUFFER.SCORE).slice(0, count * SCORE_BLOCK));
        }
    }
    return { scores };
}

// Rows r of the odd row grid with their bin f = ODD_FIRST_BIN + 2r.
const oddBin = r => ODD_FIRST_BIN + 2 * r;
const ODD_COLUMNS = ODD_STATES + 1;
const ODD_PENALTY_HZ = 2000;

// Complex row r of the forward transform in IO times c (c = cr + j·ci) into column `column`.
function storeOddColumn(columns, column, io, r, cr, ci) {
    const f = oddBin(r);
    const re = io[2 * f], im = io[2 * f + 1];
    const at = 2 * (column * ROW_COUNT + r);
    columns[at] = cr * re - ci * im;
    columns[at + 1] = cr * im + ci * re;
}

/**
 * `oddColumns`: the 32 odd model columns g·RMS·DFT(s̃_a³ held)/N and the microphone
 * column DFT(y_lin³)/(N·y_r²) of drive X on the odd rows (Float64Array(33 × 2 × 3983), column-major,
 * interleaved), with s̃_a = clamp(state_a/B_a, −1, 1) for `bounds` B, or the raw states when `bounds`
 * is null. `peaks` are max |state_a|. For every record { wp, wq2, Y } the real normal equations
 * of the 33 unknowns (N: Float64Array(33 × 33), b: Float64Array(33)) over its fit rows (weight wp)
 * and its penalty rows (every odd row from 2 kHz, weight wq², model columns only).
 */
export function oddColumns(context, { X, g, excited, bounds = null, records = [] }) {
    loadDrive(context, X, null, excited);
    const states = context.view(SDC_BUFFER.STATES);
    const columns = new Float64Array(ODD_COLUMNS * 2 * ROW_COUNT);
    const peaks = new Float64Array(ODD_STATES);
    const scale = ODD_RMS / N;
    for (let a = 0; a < ODD_STATES; a++) {
        const io = context.view(SDC_BUFFER.IO);
        const state = states.subarray(a * N, (a + 1) * N);
        const bound = bounds ? bounds[a] : 1;
        // Evaluated at n = 4·floor(n/4) and held for four samples, as et_sdc_correct does.
        for (let n = 0; n < N; n += 4) {
            let s = state[n] / bound;
            if (bounds) s = s > 1 ? 1 : s < -1 ? -1 : s;
            const cube = s * s * s;
            io[n] = cube;
            io[n + 1] = cube;
            io[n + 2] = cube;
            io[n + 3] = cube;
        }
        let peak = 0;
        for (let n = 0; n < N; n++) {
            const magnitude = state[n] < 0 ? -state[n] : state[n];
            if (magnitude > peak) peak = magnitude;
        }
        peaks[a] = peak;
        context.fft();
        for (let r = 0; r < ROW_COUNT; r++) {
            const f = oddBin(r);
            storeOddColumn(columns, a, io, r, g[2 * f] * scale, g[2 * f + 1] * scale);
        }
    }
    // Microphone column: y_lin = IDFT(g·X on the excited bins).
    const product = new Float64Array(X.length);
    for (let f = 0; f < X.length / 2; f++) {
        if (!excited[f]) continue;
        product[2 * f] = g[2 * f] * X[2 * f] - g[2 * f + 1] * X[2 * f + 1];
        product[2 * f + 1] = g[2 * f] * X[2 * f + 1] + g[2 * f + 1] * X[2 * f];
    }
    const io = synthesizeInto(context, product);
    let energy = 0;
    for (let n = 0; n < N; n++) energy += io[n] * io[n];
    const yr2 = energy / N;
    for (let n = 0; n < N; n++) io[n] = yr2 > 0 ? io[n] * io[n] * io[n] / yr2 : 0;
    context.fft();
    for (let r = 0; r < ROW_COUNT; r++) storeOddColumn(columns, ODD_STATES, io, r, 1 / N, 0);
    const grams = records.map(record => oddGram(columns, record));
    return { columns, peaks, grams };
}

// Real normal equations of one record over the odd rows (oddColumns).
function oddGram(columns, { wp, wq2, Y }) {
    const Nm = new Float64Array(ODD_COLUMNS * ODD_COLUMNS);
    const b = new Float64Array(ODD_COLUMNS);
    const re = new Float64Array(ODD_COLUMNS);
    const im = new Float64Array(ODD_COLUMNS);
    for (let r = 0; r < ROW_COUNT; r++) {
        const f = oddBin(r);
        const penalty = f >= ODD_PENALTY_HZ;
        const w2 = penalty ? wq2 : wp[r] * wp[r];
        if (!(w2 > 0)) continue;
        const count = penalty ? ODD_STATES : ODD_COLUMNS;
        for (let c = 0; c < count; c++) {
            re[c] = columns[2 * (c * ROW_COUNT + r)];
            im[c] = columns[2 * (c * ROW_COUNT + r) + 1];
        }
        for (let i = 0; i < count; i++) {
            const row = i * ODD_COLUMNS;
            for (let j = 0; j <= i; j++) Nm[row + j] += w2 * (re[i] * re[j] + im[i] * im[j]);
            if (!penalty) b[i] += w2 * (re[i] * Y[2 * f] + im[i] * Y[2 * f + 1]);
        }
    }
    for (let i = 0; i < ODD_COLUMNS; i++) for (let j = 0; j < i; j++) Nm[j * ODD_COLUMNS + i] = Nm[i * ODD_COLUMNS + j];
    return { N: Nm, b };
}

/**
 * `oddTones`: single-tone third-harmonic columns of the odd block at SWEEP_FREQUENCIES. For every
 * point k the drive is one line κ at f_k (peak amplitude 2κ) and column a is the electrical response
 * per unit weight RMS·DFT(s̃_a³ held)[3f]/(N·κ), s̃_a = clamp(state_a/B_a, −1, 1) for `bounds` B.
 * Returns { columns }: Float64Array(SWEEP_FREQUENCIES.length × 2 × 32), re then im per point. One
 * drive per tone: the clamp makes the cube depend on everything the drive holds.
 */
export function oddTones(context, { kappa, bounds }) {
    const columns = new Float64Array(SWEEP_FREQUENCIES.length * 2 * ODD_STATES);
    const X = new Float64Array(2 * (MAX_BIN + 1));
    const excited = new Uint8Array(MAX_BIN + 1);
    const cos = new Float64Array(N / 4), sin = new Float64Array(N / 4);
    const scale = ODD_RMS / (N * kappa);
    for (const [k, f] of SWEEP_FREQUENCIES.entries()) {
        X.fill(0);
        excited.fill(0);
        X[2 * f] = kappa;
        excited[f] = 1;
        loadDrive(context, X, null, excited);
        const states = context.view(SDC_BUFFER.STATES);
        // The cube is evaluated at n = 4m and held for four samples, so its DFT at 3f is
        // Σ_m c(4m)·e^(−jω4m) times the hold factor Σ_{i<4} e^(−jωi).
        const omega = 2 * Math.PI * 3 * f / N;
        for (let m = 0; m < N / 4; m++) {
            cos[m] = Math.cos(4 * omega * m);
            sin[m] = Math.sin(4 * omega * m);
        }
        let holdRe = 0, holdIm = 0;
        for (let i = 0; i < 4; i++) {
            holdRe += Math.cos(omega * i);
            holdIm -= Math.sin(omega * i);
        }
        const re = 2 * k * ODD_STATES, im = re + ODD_STATES;
        for (let a = 0; a < ODD_STATES; a++) {
            const bound = bounds[a];
            let sumRe = 0, sumIm = 0;
            for (let m = 0, n = a * N; m < N / 4; m++, n += 4) {
                let s = states[n] / bound;
                s = s > 1 ? 1 : s < -1 ? -1 : s;
                const cube = s * s * s;
                sumRe += cube * cos[m];
                sumIm -= cube * sin[m];
            }
            columns[re + a] = scale * (sumRe * holdRe - sumIm * holdIm);
            columns[im + a] = scale * (sumRe * holdIm + sumIm * holdRe);
        }
    }
    return { columns };
}

/**
 * `correct`: device-rate corrected call of the played drive X with the stored weights of
 * `length` at scale `scale` (weights null: no even block) and the odd block `odd` = { weights,
 * bounds } or null, assembled like `call` without rescaling.
 */
export function correct(context, { X, excited, weights, length, scale, odd = null, targetDbfs, K, fsDev, bandwidth }) {
    loadDrive(context, X, null, excited);
    if (weights) loadStoredWeights(context, weights);
    else context.view(SDC_BUFFER.WEIGHTS).fill(0, 0, SDC_UNKNOWNS);
    const oddBuffer = context.view(SDC_BUFFER.ODD);
    oddBuffer.fill(0);
    if (odd) {
        oddBuffer.set(odd.weights);
        oddBuffer.set(odd.bounds, ODD_STATES);
    }
    context.correct(weights ? length : 0, scale);
    const period = Float64Array.from(context.view(SDC_BUFFER.IO));
    const { samples, chirp } = assembleCall(period, { targetDbfs, K, fsDev, bandwidth, factor: 1 });
    return { samples, chirp };
}

/** `checkPredict`: T = PRED and M = MIC on the rows for g′ and the stored weights. */
export function checkPredict(context, { X, g, excited, weights, length }) {
    loadDrive(context, X, g, excited);
    loadStoredWeights(context, weights);
    context.predict(length, 1);
    return {
        T: context.view(SDC_BUFFER.PRED).slice(0, 2 * ROW_COUNT),
        M: context.view(SDC_BUFFER.MIC).slice()
    };
}

export const HANDLERS = Object.freeze({
    call, analyze, diagnosis, seedGram, sweepGram, folds, final, score, oddColumns, oddTones, correct, checkPredict
});

/** ArrayBuffers of every typed array in `value`, for transfer. */
export function transferablesOf(value, list = []) {
    if (ArrayBuffer.isView(value)) {
        if (!list.includes(value.buffer)) list.push(value.buffer);
    } else if (value && typeof value === 'object') {
        for (const entry of Object.values(value)) transferablesOf(entry, list);
    }
    return list;
}

// Worker entry: one context per worker, created by `init`.
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
    let context = null;
    globalThis.onmessage = async ({ data: { id, type, payload } }) => {
        try {
            if (type === 'init') {
                const loaded = await loadDspModule({ basePath: new URL('../../../../', import.meta.url).href, publishTarget: null });
                context = loaded?.module ? createSdcContext(await instantiateDsp(loaded.module)) : null;
                if (!context) throw new Error('The identification module is unavailable.');
                globalThis.postMessage({ id, result: 'ready' });
                return;
            }
            const result = HANDLERS[type](context, payload);
            globalThis.postMessage({ id, result }, transferablesOf(result));
        } catch (error) {
            console.error('Speaker distortion work unit failed:', type, error);
            globalThis.postMessage({ id, error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) } });
        }
    };
}
