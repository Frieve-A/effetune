// The identification reductions against their literal float64 forms.
// The first group runs in float64 JS only (no WebAssembly); the second runs the identification module of
// both DSP WebAssembly variants against the reference; the third checks the 90-degree taps and
// runs the plugin kernel on unit weights against the identification model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import {
    packSpeakerDistortionCorrectionPluginParams,
    SpeakerDistortionCorrectionPlugin_PARAMS_HASH
} from '../../js/audio/dsp-params.generated.js';
import {
    SDC_BUFFER, SDC_COLUMNS, SDC_SCORE_SCALES, SDC_SCORE_SETS, SDC_UNKNOWNS, createSdcContext
} from '../../js/utils/measurement-dsp/speaker-distortion/kernels.js';
import {
    ALL_ROWS, CARRIER_COLUMN, E_SCALE, MAX_BIN, MIC_COLUMN, MODEL_TERMS, N, RMS, ROW_COUNT,
    SCALE_VALUES, TAP_HALF_LENGTH, TERMS,
    binSets, circularFilter, columnProduct, combDrive, correctedPeriod, correctorStates, dftRows, driveColumns,
    expandWeights, fftComplex, foldSystem, gramColumnInfo, heldOut, heldOutPerBin, lengthColumns, literalNormal,
    mulberry32, ninetyTaps, penaltyMask, predictRows, ridgeSolve, rotateSecond, hiRows, seedGram, seedRowSums,
    synthesize, takeWeights, termProduct, totalSystem
} from '../helpers/speaker-distortion-reference.mjs';
import {
    SPEAKER_DISTORTION_ASSET_BYTES, SPEAKER_DISTORTION_ASSET_CHANNELS, SPEAKER_DISTORTION_ASSET_FRAMES,
    SPEAKER_DISTORTION_ASSET_MAGIC, SPEAKER_DISTORTION_ASSET_TOPOLOGY, SPEAKER_DISTORTION_HEADER_BYTES,
    SPEAKER_DISTORTION_STEP, SPEAKER_DISTORTION_STEP_FRAME
} from '../helpers/speaker-distortion-kernel-reference.mjs';
import { HANDLERS } from '../../js/utils/measurement-dsp/speaker-distortion/identify-worker.js';
import {
    LAMBDA_GRID, buildCapturePlan, identifySpeakerModel, setExecutorFactory
} from '../../js/utils/measurement-dsp/speaker-distortion/identify.js';
import { createPlant } from '../helpers/distortion-plant-sim.mjs';

const maxAbs = values => values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const relativeError = (actual, expected) => maxAbs(actual.map((value, i) => value - expected[i])) / maxAbs(expected);

// 200 even rows spread over 36…8000 Hz.
const ROWS = Int32Array.from({ length: 200 }, (_, i) => 2 * Math.round((36 + (MAX_BIN - 36) * i / 199) / 2));

// 40 Gram columns covering every term type and the microphone: low × low (same and different
// states, peak and quadrature), low × high peak, low × high quadrature, high × high, the second
// sum of both lengths.
const COLUMNS_40 = Int32Array.from([
    0, 1, 17, 31, 32, 95, 240, 333, 470, 527,
    528, 560, 611, 680, 719, 720, 755, 830, 899, 911,
    912, 913, 924, 950, 977, 989, 990, 1031, 1100, 1181,
    1182, 1223, 1292, 1373, 300, 400, 650, 860, 940, MIC_COLUMN
]);

// 120 Gram columns spread over all kinds, the microphone last.
const COLUMNS_120 = Int32Array.from({ length: 120 }, (_, i) => (i < 119 ? Math.round(i * 1373 / 118) : MIC_COLUMN));

const COMB = combDrive(8);

// A random drive on the COMB line set: unit amplitudes, seeded phases, rms near 0.05.
function randomDrive(seed) {
    const random = mulberry32(100 + seed);
    const X = new Float64Array(2 * (MAX_BIN + 1));
    let power = 0;
    COMB.excited.forEach((on, f) => {
        if (!on) return;
        const phase = 2 * Math.PI * random();
        X[2 * f] = Math.cos(phase);
        X[2 * f + 1] = Math.sin(phase);
        power += 2;
    });
    const scale = 0.05 / Math.sqrt(power);
    return { X: X.map(value => value * scale), excited: COMB.excited };
}

// A smooth complex linear response: magnitude 0.5…1, a 0.3 ms delay.
const G = (() => {
    const g = new Float64Array(2 * (MAX_BIN + 1));
    for (let f = 0; f <= MAX_BIN; f++) {
        const magnitude = 0.5 + 0.5 * f / MAX_BIN, phase = -2 * Math.PI * f * 3e-4;
        g[2 * f] = magnitude * Math.cos(phase);
        g[2 * f + 1] = magnitude * Math.sin(phase);
    }
    return g;
})();

const statesOf = drive => correctorStates(synthesize(drive.X));

describe('speaker distortion reference reductions', () => {
    const drive = randomDrive(1);
    const states = statesOf(drive);
    const direct = driveColumns(drive, G, { states, freqs: ROWS, columns: COLUMNS_40, method: 'direct' });
    const fast = driveColumns(drive, G, { states, freqs: ROWS, columns: COLUMNS_40, method: 'fast' });

    test('the column subset includes every term kind and the microphone', () => {
        const kinds = new Set(Array.from(COLUMNS_40, column => {
            const info = gramColumnInfo(column);
            if (info.kind !== 'direct') return info.kind === 'mic' ? 'mic' : `second-${info.length}`;
            const [a, b] = TERMS[info.term];
            return a < 32 && b < 32 ? 'low-low' : a < 32 ? `low-high-${b & 1 ? 'quadrature' : 'peak'}` : 'high-high';
        }));
        assert.deepEqual([...kinds].sort(),
            ['high-high', 'low-high-peak', 'low-high-quadrature', 'low-low', 'mic', 'second-long', 'second-short']);
    });

    test('the 24000 fold and the half-length low × low form equal the direct 48000-point DFT', () => {
        COLUMNS_40.forEach((column, i) => {
            assert.ok(relativeError(fast.columns[i], direct.columns[i]) < 1e-10, `column ${column}`);
        });
        assert.ok(relativeError(fast.M, direct.M) < 1e-10);
    });

    test('the second sum as Hi rotation equals the DFT of the circularly 90°-filtered product', () => {
        for (const length of ['short', 'long']) {
            const taps = ninetyTaps(TAP_HALF_LENGTH[length]);
            const hi = hiRows(TAP_HALF_LENGTH[length], ROWS);
            for (const term of [528, 611, 719]) {
                const filtered = dftRows(circularFilter(termProduct(states, term), taps), ROWS).map(value => RMS * value);
                const unrotated = dftRows(termProduct(states, term), ROWS).map(value => RMS * value);
                assert.ok(relativeError(rotateSecond(unrotated, hi), filtered) < 1e-10, `${length} ${term}`);
            }
        }
    });

    test('corrector products and the microphone square of a COMB drive are zero on odd bins', () => {
        const comb = { X: COMB.X.map(value => value * 0.05), excited: COMB.excited };
        const combStates = statesOf(comb);
        const y = synthesize(comb.X);
        const signals = [0, 17, 527, 560, 755, 950, 989].map(term => termProduct(combStates, term));
        signals.push(y.map(value => value * value));
        for (const signal of signals) {
            const { re, im } = fftComplex(signal);
            let odd = 0, even = 0;
            for (let k = 0; k < N; k++) {
                if (k & 1) odd += re[k] * re[k] + im[k] * im[k];
                else even += re[k] * re[k] + im[k] * im[k];
            }
            assert.ok(odd < 1e-22 * even, `odd/even power ${odd / even}`);
        }
    });

    test('the time-domain prediction equals the column product g·C·w', () => {
        const random = mulberry32(7);
        for (const length of ['short', 'long']) {
            const positions = [];
            COLUMNS_40.forEach((column, i) => {
                const info = gramColumnInfo(column);
                if (info.kind === 'direct' || (info.kind === 'second' && info.length === length)) positions.push(i);
            });
            const solution = positions.map(() => random() - 0.5);
            const { weights } = expandWeights(positions.map(i => COLUMNS_40[i]), solution, length);
            const expected = columnProduct(positions.map(i => fast.columns[i]), solution, G, ROWS);
            assert.ok(relativeError(predictRows(states, weights, length, G, ROWS), expected) < 1e-13, length);
            // The corrected period removes exactly C·w (without g) from the period spectrum.
            const x = synthesize(drive.X);
            const corrected = correctedPeriod(x, weights, length);
            const removed = dftRows(x.map((value, n) => value - corrected[n]), ROWS);
            const columnSum = columnProduct(positions.map(i => fast.columns[i]), solution, unitResponse, ROWS);
            assert.ok(relativeError(removed, columnSum) < 1e-10, `${length} corrected period`);
        }
    });

    test('columns from 10^(−6/20)·X equal 10^(−12/20) × the columns from X', () => {
        const quieter = { X: drive.X.map(value => value * 10 ** (-6 / 20)), excited: drive.excited };
        const scaled = driveColumns(quieter, G, { states: statesOf(quieter), freqs: ROWS, columns: COLUMNS_40 });
        COLUMNS_40.forEach((column, i) => {
            assert.ok(relativeError(scaled.columns[i], fast.columns[i].map(value => value * E_SCALE)) < 1e-10, `column ${column}`);
        });
    });
});

const unitResponse = (() => {
    const g = new Float64Array(2 * (MAX_BIN + 1));
    for (let f = 0; f <= MAX_BIN; f++) g[2 * f] = 1;
    return g;
})();

describe('speaker distortion reference systems', () => {
    const upperLimitHz = 1000;
    const bins = binSets(upperLimitHz);
    const qMask = penaltyMask(ROWS, upperLimitHz);
    const micPosition = COLUMNS_120.length - 1;
    const random = mulberry32(99);
    const truth = Float64Array.from(COLUMNS_120, () => random() - 0.5);

    // Two takes per seed: Y = g·C·w_true + noise on the rows, a level well above Pn on the
    // other even bins so every fit class is above the limit, noise elsewhere.
    const seeds = [1, 2, 3, 4, 5, 6].map(seed => {
        const drive = randomDrive(seed);
        const { columns } = driveColumns(drive, G, { states: statesOf(drive), freqs: ROWS, columns: COLUMNS_120 });
        const model = columnProduct(columns, truth, G, ROWS);
        const noiseScale = 0.1 * Math.sqrt(model.reduce((sum, value) => sum + value * value, 0) / ROWS.length);
        const takes = ['A', 'B'].map(() => {
            const Y = new Float64Array(2 * (MAX_BIN + 1));
            const Pn = new Float64Array(MAX_BIN + 1);
            for (let f = 0; f <= MAX_BIN; f++) {
                Pn[f] = noiseScale * noiseScale * (0.5 + random());
                const s = Math.sqrt(Pn[f] / 2);
                Y[2 * f] = s * (random() - 0.5) * 3.4;
                Y[2 * f + 1] = s * (random() - 0.5) * 3.4;
                if (!(f & 1)) { Y[2 * f] += 5 * noiseScale; Y[2 * f + 1] -= 3 * noiseScale; }
            }
            ROWS.forEach((f, r) => { Y[2 * f] = model[2 * r] + Y[2 * f] * 0.1; Y[2 * f + 1] = model[2 * r + 1] + Y[2 * f + 1] * 0.1; });
            const record = { Y, Pn };
            return { record, ...takeWeights(record, bins, ROWS) };
        });
        const sums = seedRowSums(takes, G, ROWS, qMask);
        const gram = seedGram(columns, micPosition, qMask, sums);
        return { columns, takes, sums, gram, system: { N: gram.N, b: gram.b, yy: sums.yy } };
    });

    test('the takes have penalty rows and active weights', () => {
        assert.ok(qMask.some(Boolean) && qMask.some(value => !value));
        for (const { takes } of seeds) for (const take of takes) assert.ok(take.wq2 > 0 && take.wp.some(value => value > 0));
    });

    test('one Gram per seed and its carrier equal the per-take complex systems', () => {
        for (const { columns, takes, gram, sums } of seeds) {
            const literal = literalNormal(columns, micPosition, ROWS, G, qMask, takes);
            assert.ok(relativeError(gram.N, literal.N) < 1e-10);
            assert.ok(relativeError(gram.b, literal.b) < 1e-10);
            assert.ok(Math.abs(sums.yy - literal.yy) < 1e-12 * literal.yy);
        }
    });

    test('fold subtraction equals the Gram summed over the other five seeds', () => {
        const total = totalSystem(seeds.map(seed => seed.system));
        seeds.forEach((seed, s) => {
            const fold = foldSystem(total, seed.system);
            const others = totalSystem(seeds.filter((_, i) => i !== s).map(other => other.system));
            assert.ok(maxAbs(fold.N.map((value, i) => value - others.N[i])) < 1e-12 * maxAbs(total.N));
            assert.ok(maxAbs(fold.b.map((value, i) => value - others.b[i])) < 1e-12 * maxAbs(total.b));
        });
    });

    test('the ridge solve satisfies its scaled system and the held-out quadratic equals the per-bin sum', () => {
        const total = totalSystem(seeds.map(seed => seed.system));
        seeds.forEach((seed, s) => {
            const fold = foldSystem(total, seed.system);
            const lambda = 10 ** (-1 / 4);
            const w = ridgeSolve(fold.N, fold.b, lambda, micPosition);
            assert.ok(w);
            const n = w.length;
            const residual = new Float64Array(n);
            for (let i = 0; i < n; i++) {
                let sum = (i === micPosition ? 1e-6 : lambda) * Math.max(fold.N[i * n + i], 1e-24) * w[i] - fold.b[i];
                for (let j = 0; j < n; j++) sum += fold.N[i * n + j] * w[j];
                residual[i] = sum / Math.sqrt(Math.max(fold.N[i * n + i], 1e-24));
            }
            assert.ok(maxAbs(residual) < 1e-9 * maxAbs(fold.b.map((value, i) => value / Math.sqrt(fold.N[i * n + i]))));
            const quadratic = heldOut(w, seed.system.N, seed.system.b, seed.system.yy);
            const perBin = heldOutPerBin(w, seed.columns, micPosition, ROWS, G, qMask, seed.takes);
            assert.ok(Math.abs(quadratic - perBin) < 1e-12 * seed.system.yy, `seed ${s + 1}: ${quadratic} vs ${perBin}`);
        });
    });
});

test('ALL_ROWS spans the even bins 36…8000 Hz', () => {
    assert.equal(ALL_ROWS[0], 36);
    assert.equal(ALL_ROWS.at(-1), MAX_BIN);
});

// ------------------------------------------------------------------------ identification module and corrector kernel

const ARTIFACTS = ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm'];
const loadDsp = artifact => instantiateDsp(fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url)));
const LENGTHS = [['short', 0], ['long', 1]];
const LD = 2 * ROW_COUNT + 2;
const PADDED_COLUMNS = 1380;
const EVEN_BINS = MAX_BIN / 2 + 1;
const VECTORS = 24;
const MASKED = [5, 1000];
const Q_ROW = 2000;
const LAMBDAS = [1e-4, 1, 10 ** 1.5];

const toFloat32 = values => Float64Array.from(Float32Array.from(values));
const rmsOf = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const maxAbsDifference = (actual, expected) => {
    let max = 0;
    for (let i = 0; i < expected.length; i++) {
        const difference = Math.abs(actual[i] - expected[i]);
        if (difference > max) max = difference;
    }
    return max;
};

// The module reads float32 inputs, so the reference starts from the same rounded drive and g.
const DRIVE32 = { X: toFloat32(randomDrive(11).X), excited: COMB.excited };
const G32 = toFloat32(G);

let identificationReference = null;
function referenceColumns() {
    if (!identificationReference) {
        const states = statesOf(DRIVE32);
        const all = Int32Array.from({ length: MIC_COLUMN + 1 }, (_, i) => i);
        identificationReference = { states, ...driveColumns(DRIVE32, G32, { states, columns: all }) };
    }
    return identificationReference;
}

// 24 random weight vectors in unknown order (model terms, microphone last), masked terms 0.
const WEIGHTS = (() => {
    const random = mulberry32(21);
    const weights = Float64Array.from({ length: VECTORS * SDC_UNKNOWNS }, () => random() - 0.5);
    for (let v = 0; v < VECTORS; v++) for (const term of MASKED) weights[v * SDC_UNKNOWNS + term] = 0;
    return weights;
})();

const expectedPredictions = new Map();
function expectedPrediction(length) {
    if (!expectedPredictions.has(length)) {
        const { columns } = referenceColumns();
        const model = Array.from(lengthColumns(length).slice(0, MODEL_TERMS), column => columns[column]);
        expectedPredictions.set(length, Array.from({ length: VECTORS }, (_, v) =>
            columnProduct(model, WEIGHTS.subarray(v * SDC_UNKNOWNS, (v + 1) * SDC_UNKNOWNS), G32, ALL_ROWS)));
    }
    return expectedPredictions.get(length);
}

for (const artifact of ARTIFACTS) {
    describe(`speaker distortion identification module against the reference, ${artifact}`, () => {
        let binding = null;
        let context = null;
        const timings = {};
        const margins = {};
        const timed = (name, run) => {
            const started = performance.now();
            run();
            timings[name] = Number((performance.now() - started).toFixed(1));
        };
        const columnView = c => context.view(SDC_BUFFER.COLUMNS).subarray(c * LD, (c + 1) * LD);

        before(async () => {
            binding = await loadDsp(artifact);
            context = createSdcContext(binding);
            assert.ok(context, 'the module provides the identification context');
        });

        after(() => {
            context?.destroy();
            binding?.close();
            console.log(`speaker distortion module ${artifact}:`, JSON.stringify({ timings, margins }));
        });

        test('the 48000-point transform matches a float64 DFT forward and inverse', () => {
            const random = mulberry32(31);
            const x = toFloat32(Array.from({ length: N }, () => random() - 0.5));
            const io = context.view(SDC_BUFFER.IO);
            io.set(x);
            context.fft();
            const bins = Int32Array.from({ length: 100 }, (_, i) => 1 + 239 * i);
            const forward = new Float64Array(2 * bins.length);
            bins.forEach((k, i) => { forward[2 * i] = io[2 * k]; forward[2 * i + 1] = io[2 * k + 1]; });
            margins.fftForward = relativeError(forward, dftRows(x, bins).map(value => value * N));

            const { re, im } = fftComplex(x);
            io[0] = re[0];
            io[1] = re[N / 2];
            for (let k = 1; k < N / 2; k++) { io[2 * k] = re[k]; io[2 * k + 1] = im[k]; }
            context.fft(true);
            margins.fftInverse = relativeError(Float64Array.from(io), x.map(value => value * N));
            assert.ok(margins.fftForward < 2e-6 && margins.fftInverse < 2e-6, JSON.stringify(margins));
        });

        test('drive states and MIC equal the reference near float32 rounding', () => {
            context.view(SDC_BUFFER.DRIVE).set(DRIVE32.X);
            context.view(SDC_BUFFER.G).set(G32);
            context.view(SDC_BUFFER.EXCITED).set(DRIVE32.excited);
            timed('drive', () => context.drive());
            const { states, M } = referenceColumns();
            const actual = context.view(SDC_BUFFER.STATES);
            margins.states = Math.max(...states.map((state, i) =>
                maxAbsDifference(actual.subarray(i * N, (i + 1) * N), state) / (rmsOf(state) || 1)));
            margins.mic = relativeError(Float64Array.from(context.view(SDC_BUFFER.MIC)), M);
            assert.ok(margins.states < 2e-6 && margins.mic < 2e-6, JSON.stringify(margins));
        });

        test('all columns of one drive equal the reference columns on all rows', () => {
            const mask = context.view(SDC_BUFFER.TERM_MASK);
            mask.fill(1);
            for (const term of MASKED) mask[term] = 0;
            timed('columns', () => context.columns());
            const { columns } = referenceColumns();
            const interleaved = new Float64Array(2 * ROW_COUNT);
            let worst = 0;
            for (let c = 0; c < PADDED_COLUMNS; c++) {
                const actual = columnView(c);
                if (c >= CARRIER_COLUMN || MASKED.includes(c)) {
                    assert.ok(actual.every(value => value === 0), `column ${c} is zero`);
                    continue;
                }
                assert.ok(actual[LD - 2] === 0 && actual[LD - 1] === 0, `column ${c} pads`);
                for (let r = 0; r < ROW_COUNT; r++) {
                    interleaved[2 * r] = actual[r];
                    interleaved[2 * r + 1] = actual[ROW_COUNT + r];
                }
                const error = relativeError(interleaved, columns[c]);
                if (error > worst) worst = error;
            }
            margins.columns = worst;
            assert.ok(worst < 1e-5, `${worst}`);
        });

        test('PRED of 24 random vectors equals g·C·w from the reference columns', () => {
            context.view(SDC_BUFFER.WEIGHTS).set(WEIGHTS);
            const pred = context.view(SDC_BUFFER.PRED);
            let worst = 0;
            for (const [name, length] of LENGTHS) {
                timed(`predict ${name}`, () => context.predict(length, VECTORS));
                expectedPrediction(name).forEach((expected, v) => {
                    const actual = Float64Array.from(pred.subarray(v * 2 * ROW_COUNT, (v + 1) * 2 * ROW_COUNT));
                    const error = relativeError(actual, expected);
                    if (error > worst) worst = error;
                });
            }
            margins.predict = worst;
            assert.ok(worst < 1e-5, `${worst}`);
        });

        test('the held-out sum from GRAM_S equals the per-bin sum from PRED and MIC', () => {
            const count = 4;
            const random = mulberry32(41);
            const rowWeight = context.view(SDC_BUFFER.ROWW);
            for (let r = 0; r < ROW_COUNT; r++) rowWeight[r] = 0.5 + random();
            context.predict(0, count);
            const pred = context.view(SDC_BUFFER.PRED);
            const mic = context.view(SDC_BUFFER.MIC);
            // C·w of the Gram's own columns: (PRED + w_mic·M below Q) / g.
            const modelRows = v => {
                const micWeight = WEIGHTS[v * SDC_UNKNOWNS + MODEL_TERMS];
                const out = new Float64Array(2 * ROW_COUNT);
                for (let r = 0; r < ROW_COUNT; r++) {
                    const f = ALL_ROWS[r], gr = G32[2 * f], gi = G32[2 * f + 1], magnitude = gr * gr + gi * gi;
                    const pr = pred[v * 2 * ROW_COUNT + 2 * r] + (r < Q_ROW ? micWeight * mic[2 * r] : 0);
                    const pi = pred[v * 2 * ROW_COUNT + 2 * r + 1] + (r < Q_ROW ? micWeight * mic[2 * r + 1] : 0);
                    out[2 * r] = (pr * gr + pi * gi) / magnitude;
                    out[2 * r + 1] = (pi * gr - pr * gi) / magnitude;
                }
                return out;
            };
            // A carrier near slot 0's model, so its held-out sum is a residual, not a total.
            const first = modelRows(0);
            const noise = 0.3 * rmsOf(first);
            const carrier = context.view(SDC_BUFFER.CARRIER);
            for (let i = 0; i < 2 * ROW_COUNT; i++) carrier[i] = 0.8 * first[i] + 2 * noise * (random() - 0.5);
            timed('gram', () => context.gram(Q_ROW));
            context.packGram(SDC_BUFFER.GRAM_S);
            const scaledCarrier = columnView(CARRIER_COLUMN);
            const yy = scaledCarrier.reduce((sum, value) => sum + value * value, 0);
            context.heldout(0, count, yy);
            const out = context.view(SDC_BUFFER.OUT);
            let worst = 0;
            for (let v = 0; v < count; v++) {
                const rows = modelRows(v);
                let perBin = 0;
                for (let r = 0; r < ROW_COUNT; r++) {
                    const re = scaledCarrier[r] - rowWeight[r] * rows[2 * r];
                    const im = scaledCarrier[ROW_COUNT + r] - rowWeight[r] * rows[2 * r + 1];
                    perBin += re * re + im * im;
                }
                const error = Math.abs(out[v] - perBin) / perBin;
                if (error > worst) worst = error;
            }
            margins.heldout = worst;
            assert.ok(worst < 1e-5, `${worst}`);
        });

        test('GRAM equals the float64 product of the module\'s own float32 columns', () => {
            const gram = context.view(SDC_BUFFER.GRAM);
            const dot = (a, b) => {
                let sum = 0;
                for (let t = 0; t < LD; t++) sum += a[t] * b[t];
                return sum;
            };
            const diagonal = Float64Array.from({ length: SDC_COLUMNS }, (_, c) => dot(columnView(c), columnView(c)));
            let worst = 0;
            for (const i of [...COLUMNS_40, CARRIER_COLUMN]) {
                const a = columnView(i);
                for (let j = 0; j < SDC_COLUMNS; j++) {
                    const actual = i >= j ? gram[i * PADDED_COLUMNS + j] : gram[j * PADDED_COLUMNS + i];
                    const norm = Math.sqrt(diagonal[i] * diagonal[j]);
                    if (norm === 0) {
                        assert.equal(actual, 0, `GRAM ${i}, ${j} of a zero column`);
                        continue;
                    }
                    const error = Math.abs(actual - dot(a, columnView(j))) / norm;
                    if (error > worst) worst = error;
                }
            }
            margins.gram = worst;
            assert.ok(worst < 2e-6, `${worst}`);
        });

        test('the ridge solve equals the reference Cholesky; a zero column gives 0 and a failure keeps the slot', () => {
            const total = context.packGram(SDC_BUFFER.GRAM_T);
            const seed = context.view(SDC_BUFFER.GRAM_S);
            for (let i = 0; i < total.length; i++) seed[i] = 0.25 * total[i];
            const packedAt = (packed, i, j) => (i >= j ? packed[i * (i + 1) / 2 + j] : packed[j * (j + 1) / 2 + i]);
            const carrierRow = CARRIER_COLUMN * (CARRIER_COLUMN + 1) / 2;
            const referenceSystem = (name, fold) => {
                const J = lengthColumns(name);
                const n = J.length;
                const at = (i, j) => packedAt(total, i, j) - (fold ? packedAt(seed, i, j) : 0);
                const matrix = new Float64Array(n * n);
                const b = new Float64Array(n);
                for (let i = 0; i < n; i++) {
                    for (let j = 0; j <= i; j++) matrix[i * n + j] = matrix[j * n + i] = at(J[i], J[j]);
                    b[i] = total[carrierRow + J[i]] - (fold ? seed[carrierRow + J[i]] : 0);
                }
                return { matrix, b, n };
            };
            const weights = context.view(SDC_BUFFER.WEIGHTS);
            const solveAgainstReference = ({ matrix, b, n }, lambda, slot) => {
                const started = performance.now();
                assert.ok(context.solve(lambda, slot), `solve at ${lambda}`);
                if (lambda === 1) timings.solve = Number((performance.now() - started).toFixed(1));
                const expected = ridgeSolve(matrix, b, lambda, MODEL_TERMS);
                assert.ok(expected);
                const actual = weights.subarray(slot * SDC_UNKNOWNS, (slot + 1) * SDC_UNKNOWNS);
                // Compared on the unit-diagonal scale the solve works in.
                const scaled = w => Float64Array.from(w, (value, i) => value * Math.sqrt(matrix[i * n + i]));
                const error = relativeError(scaled(actual), scaled(expected));
                margins.solve = Math.max(margins.solve ?? 0, error);
                return actual;
            };

            const short = referenceSystem('short', false);
            timed('system', () => context.system(0, false));
            LAMBDAS.forEach((lambda, slot) => {
                const actual = solveAgainstReference(short, lambda, slot);
                assert.ok(actual[MASKED[0]] === 0 && actual[MASKED[1]] === 0, 'masked unknowns are exactly 0');
            });
            context.system(1, true);
            const long = solveAgainstReference(referenceSystem('long', true), 1, 3);
            assert.ok(long[MASKED[0]] === 0 && long[MASKED[1]] !== 0, 'only the masked Long column is 0');

            const kept = weights.slice(4 * SDC_UNKNOWNS, 5 * SDC_UNKNOWNS);
            assert.equal(context.solve(-2, 4), false);
            assert.deepEqual(weights.slice(4 * SDC_UNKNOWNS, 5 * SDC_UNKNOWNS), kept);
            assert.ok(margins.solve < 1e-9, `${margins.solve}`);
        });

        test('SCORE equals JS sums of the same PRED, Y and Pn; a zero vector scores alike at every scale', () => {
            const weights = context.view(SDC_BUFFER.WEIGHTS);
            weights.set(WEIGHTS);
            weights.fill(0, (VECTORS - 1) * SDC_UNKNOWNS);
            context.predict(0, VECTORS);
            const pred = context.view(SDC_BUFFER.PRED);
            const mic = context.view(SDC_BUFFER.MIC);
            const level = rmsOf(Float64Array.from(pred.subarray(0, 2 * ROW_COUNT)));
            const random = mulberry32(51);
            const y = context.view(SDC_BUFFER.Y);
            const pn = context.view(SDC_BUFFER.PN);
            const rowSet = context.view(SDC_BUFFER.ROWSET);
            for (let k = 0; k < EVEN_BINS; k++) {
                y[2 * k] = 2 * level * (random() - 0.5);
                y[2 * k + 1] = 2 * level * (random() - 0.5);
                pn[k] = level * level * random();
                rowSet[k] = k % 60;
                rowSet[EVEN_BINS + k] = k % 4;
                rowSet[2 * EVEN_BINS + k] = k % 3 === 0 ? 1 : 0;
            }
            const predScale = 0.8;
            timed('score', () => context.score(VECTORS, predScale));
            const score = context.view(SDC_BUFFER.SCORE);
            const block = SDC_SCORE_SCALES * SDC_SCORE_SETS;
            let worst = 0;
            for (let v = 0; v < VECTORS; v++) {
                const expected = new Float64Array(block);
                const magnitude = new Float64Array(block);
                const add = (index, value) => { expected[index] += value; magnitude[index] += Math.abs(value); };
                const micWeight = predScale * weights[v * SDC_UNKNOWNS + MODEL_TERMS];
                for (let k = 0; k < EVEN_BINS; k++) {
                    let yr = y[2 * k], yi = y[2 * k + 1], pr = 0, pi = 0;
                    if (k >= 18) {
                        const r = k - 18;
                        yr -= micWeight * mic[2 * r];
                        yi -= micWeight * mic[2 * r + 1];
                        pr = predScale * pred[v * 2 * ROW_COUNT + 2 * r];
                        pi = predScale * pred[v * 2 * ROW_COUNT + 2 * r + 1];
                    }
                    SCALE_VALUES.forEach((s, scale) => {
                        const er = yr - s * pr, ei = yi - s * pi;
                        const e = er * er + ei * ei - pn[k];
                        const set = scale * SDC_SCORE_SETS;
                        if (rowSet[k] < 50) add(set + rowSet[k], e);
                        if (rowSet[EVEN_BINS + k] < 3) add(set + 50 + rowSet[EVEN_BINS + k], e > 0 ? e : 0);
                        if (rowSet[2 * EVEN_BINS + k] === 1) add(set + 53, e > 0 ? e : 0);
                    });
                }
                for (let i = 0; i < block; i++) {
                    const difference = Math.abs(score[v * block + i] - expected[i]);
                    const error = magnitude[i] > 0 ? difference / magnitude[i] : difference;
                    if (error > worst) worst = error;
                }
            }
            margins.score = worst;
            assert.ok(worst < 1e-12, `${worst}`);
            const zero = score.subarray((VECTORS - 1) * block, VECTORS * block);
            for (let scale = 1; scale < SDC_SCORE_SCALES; scale++) {
                for (let set = 0; set < SDC_SCORE_SETS; set++) {
                    assert.equal(zero[scale * SDC_SCORE_SETS + set], zero[set], `scale ${scale} set ${set}`);
                }
            }
        });

        test('the corrected period removes the reference prediction at the requested scale', () => {
            const random = mulberry32(61);
            const unit = Float64Array.from({ length: MODEL_TERMS }, () => random() - 0.5);
            const weights = context.view(SDC_BUFFER.WEIGHTS);
            const io = context.view(SDC_BUFFER.IO);
            let worst = 0;
            for (const [name, length] of LENGTHS) {
                weights.fill(0, 0, SDC_UNKNOWNS);
                context.correct(length, 0);
                const x = Float64Array.from(io);
                const corrected = correctedPeriod(x, unit, name);
                const removedUnit = x.map((value, n) => value - corrected[n]);
                // Scaled so the removed part has an rms of 0.05.
                const factor = 0.05 / rmsOf(removedUnit);
                weights.set(unit.map(value => value * factor));
                timed(`correct ${name}`, () => context.correct(length, 0.8));
                const removed = Float64Array.from(io, (value, n) => x[n] - value);
                const expected = removedUnit.map(value => 0.8 * factor * value);
                const error = maxAbsDifference(removed, expected) / rmsOf(expected);
                if (error > worst) worst = error;
            }
            margins.correct = worst;
            assert.ok(worst < 1e-5, `${worst}`);
        });
    });
}

// One unit weight per kernel channel, one term of each kind.
const UNIT_TERMS = [
    ['low × low', TERMS.findIndex(([a, b]) => a === 10 && b === 19)],
    ['low × pk', 590],
    ['low × svlp', 782],
    ['high × high', TERMS.findIndex(([a, b]) => a === 34 && b === 39)],
    ['second sum', 1052]
];
const KERNEL_BLOCK = 128;

function unitAsset(length) {
    const bytes = new ArrayBuffer(SPEAKER_DISTORTION_ASSET_BYTES);
    const header = new Uint32Array(bytes, 0, SPEAKER_DISTORTION_HEADER_BYTES / 4);
    header[0] = SPEAKER_DISTORTION_ASSET_MAGIC;
    header[1] = SPEAKER_DISTORTION_ASSET_CHANNELS;
    header[2] = SPEAKER_DISTORTION_ASSET_FRAMES;
    header[4] = SPEAKER_DISTORTION_ASSET_TOPOLOGY;
    const data = new Float32Array(bytes, SPEAKER_DISTORTION_HEADER_BYTES);
    const step = length === 'long' ? SPEAKER_DISTORTION_STEP.LONG : SPEAKER_DISTORTION_STEP.SHORT;
    for (let channel = 0; channel < SPEAKER_DISTORTION_ASSET_CHANNELS; channel++) {
        const base = channel * SPEAKER_DISTORTION_ASSET_FRAMES;
        if (channel < UNIT_TERMS.length) data[base + UNIT_TERMS[channel][1]] = 1;
        data[base + SPEAKER_DISTORTION_STEP_FRAME] = step;
    }
    return bytes;
}

// The periodic drive looped through the kernel at 48 kHz for three periods and the latency.
async function runKernel(artifact, length, x32) {
    const binding = await loadDsp(artifact);
    const channels = UNIT_TERMS.length;
    let id = 0;
    try {
        assert.ok(binding.createEngine());
        assert.equal(binding.prepare(N, channels, KERNEL_BLOCK, 0), 0);
        id = binding.createInstance('SpeakerDistortionCorrectionPlugin');
        assert.ok(id);
        assert.equal(binding.instanceSetParams(id, packSpeakerDistortionCorrectionPluginParams({ dv: 0, md: 'Reduce' }),
            SpeakerDistortionCorrectionPlugin_PARAMS_HASH), 0);
        assert.equal(binding.instanceSetAsset(id, 0, unitAsset(length), {
            headBlock: 0, rateDivider: 1, pathCount: 0, inputCount: 0,
            processingChannels: channels, footprintBytes: SPEAKER_DISTORTION_ASSET_BYTES
        }, 1), 0);
        const audio = binding.getArenaViews().scratch.allChannels.subarray(0, channels * KERNEL_BLOCK);
        const pointer = binding.pointerForArenaView(audio);
        const blocks = Math.ceil((3 * N + 2 * KERNEL_BLOCK) / KERNEL_BLOCK);
        const outputs = Array.from({ length: channels }, () => new Float32Array(blocks * KERNEL_BLOCK));
        for (let block = 0; block < blocks; block++) {
            const start = block * KERNEL_BLOCK;
            for (let c = 0; c < channels; c++) {
                for (let i = 0; i < KERNEL_BLOCK; i++) audio[c * KERNEL_BLOCK + i] = x32[(start + i) % N];
            }
            assert.equal(binding.instanceProcess(id, pointer, channels, KERNEL_BLOCK, start / N), 0);
            for (let c = 0; c < channels; c++) outputs[c].set(audio.subarray(c * KERNEL_BLOCK, (c + 1) * KERNEL_BLOCK), start);
        }
        assert.equal(binding.instanceAssetState(id, 0) & 0xff, 3, 'the asset is active');
        return { outputs, latency: binding.instanceLatency(id) };
    } finally {
        if (id) binding.destroyInstance(id);
        binding.close();
    }
}

describe('speaker distortion corrector kernel against the identification model', () => {
    test('float32 90-degree taps have an imaginary response equal to Hi on all rows', () => {
        const margins = {};
        for (const [name, d] of Object.entries(TAP_HALF_LENGTH)) {
            const taps = Float32Array.from(ninetyTaps(d));
            const hi = hiRows(d, ALL_ROWS);
            let real = 0, imaginary = 0;
            ALL_ROWS.forEach((f, r) => {
                let re = 0, im = 0;
                for (let m = -d; m <= d; m++) {
                    const theta = 2 * Math.PI * f * m / N;
                    re += taps[m + d] * Math.cos(theta);
                    im -= taps[m + d] * Math.sin(theta);
                }
                const magnitude = Math.hypot(re, im);
                if (Math.abs(re) / magnitude > real) real = Math.abs(re) / magnitude;
                if (Math.abs(im - hi[r]) / magnitude > imaginary) imaginary = Math.abs(im - hi[r]) / magnitude;
            });
            margins[name] = { real, imaginary };
            assert.ok(real < 1e-6 && imaginary < 1e-6, `${name}: ${JSON.stringify(margins[name])}`);
        }
        console.log('speaker distortion taps:', JSON.stringify(margins));
    });

    const x32 = Float32Array.from(synthesize(DRIVE32.X));
    const x = Float64Array.from(x32);
    const removedOf = (length, term) => {
        const weights = new Float64Array(MODEL_TERMS);
        weights[term] = 1;
        const corrected = correctedPeriod(x, weights, length);
        return x.map((value, n) => value - corrected[n]);
    };

    for (const artifact of ARTIFACTS) {
        test(`unit weights through the kernel remove the identification model's p_j, ${artifact}`, async () => {
            const errors = {};
            for (const [length] of LENGTHS) {
                const { outputs, latency } = await runKernel(artifact, length, x32);
                assert.equal(latency, TAP_HALF_LENGTH[length]);
                UNIT_TERMS.forEach(([kind, term], channel) => {
                    const expected = removedOf(length, term);
                    const output = outputs[channel];
                    let error = 0;
                    for (let n = 0; n < N; n++) {
                        const difference = Math.abs(x[n] - output[2 * N + n + latency] - expected[n]);
                        if (difference > error) error = difference;
                    }
                    errors[`${length} ${kind}`] = error / rmsOf(expected);
                });
            }
            console.log(`speaker distortion kernel ${artifact}:`, JSON.stringify(errors));
            for (const [key, error] of Object.entries(errors)) assert.ok(error < 5e-5, `${key}: ${error}`);
        });
    }
});

describe('speaker distortion full identification chain', () => {
    const settings = {
        index: 0, label: 'L', rateHz: N, signalLevelDbfs: -20, bandwidth: [20, 20000], sweepLength: 65536,
        averaging: 1, upperLimitHz: MAX_BIN, inputDeviceId: '', inputDeviceLabel: ''
    };
    const runs = {};

    before(async () => {
        const plant = createPlant({ kind: 'speaker' });
        let recordings = null, plan = null;
        for (const artifact of ARTIFACTS) {
            const binding = await loadDsp(artifact);
            const context = createSdcContext(binding);
            const folds = [];
            setExecutorFactory(() => ({
                run: async (type, payload) => {
                    const result = HANDLERS[type](context, payload);
                    if (type === 'folds') folds.push(result.E);
                    return result;
                },
                close() {}
            }));
            try {
                if (!plan) {
                    plan = await buildCapturePlan(settings);
                    recordings = plan.captures.map(capture =>
                        plant.capture(capture.samples, { fsDev: N, group: capture.group ?? 'a' }));
                }
                const started = performance.now();
                const channel = await identifySpeakerModel({ recordings, plan, settings });
                console.log(`speaker distortion full chain ${artifact}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
                runs[artifact] = { channel, folds };
            } finally {
                setExecutorFactory(null);
                context.destroy();
                binding.close?.();
            }
        }
    });

    test('baseline and SIMD give the same λ* and figures within 0.02 dB', () => {
        const [baseline, simd] = ARTIFACTS.map(artifact => runs[artifact].channel);
        for (const [length] of LENGTHS) {
            assert.notEqual(simd.report.lambda[length], null, length);
            assert.equal(baseline.report.lambda[length], simd.report.lambda[length], length);
            simd.figL[length].forEach((figures, scale) => figures.forEach((value, c) => {
                const other = baseline.figL[length][scale][c];
                if (value === null) assert.equal(other, null);
                else assert.ok(Math.abs(value - other) < 0.02, `${length} ${scale} ${c}: ${value} ${other}`);
            }));
        }
    });

    test('the held-out sum over λ has a single minimum on the grid', () => {
        const count = LAMBDA_GRID.length;
        for (const artifact of ARTIFACTS) {
            for (const [length, index] of LENGTHS) {
                const sums = Array.from({ length: count }, (_, k) =>
                    runs[artifact].folds.reduce((sum, E) => sum + E[index * count + k], 0));
                const sorted = [...sums].sort((x, y) => x - y);
                assert.ok(sorted[1] - sorted[0] > 1e-6 * Math.abs(sorted[0]), `${artifact} ${length}: ${sorted[0]} ${sorted[1]}`);
            }
        }
    });
});
