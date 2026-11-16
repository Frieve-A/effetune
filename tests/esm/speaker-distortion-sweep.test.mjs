// Swept-sine rows of the speaker distortion fit: the batched single-tone columns, their Gram, the
// row weights, the single-tone views and the "worse for single tones" rule, and the stored record.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import {
    SDC_BUFFER, SDC_COLUMNS, SDC_COLUMN_STRIDE, SDC_PACKED_LENGTH, createSdcContext
} from '../../js/utils/measurement-dsp/speaker-distortion/kernels.js';
import { MAX_BIN } from '../../js/utils/measurement-dsp/speaker-distortion/signals.js';
import { ROW_COUNT } from '../../js/utils/measurement-dsp/speaker-distortion/preprocess.js';
import { HANDLERS, toneGroups } from '../../js/utils/measurement-dsp/speaker-distortion/identify-worker.js';
import { evaluateRule } from '../../js/utils/measurement-dsp/speaker-distortion/identify.js';
import { ODD_STATES, SWEEP_FREQUENCIES } from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';
import {
    constrainedSweepFit, singleToneWorseClass, sweepH2View, sweepH3View, sweepKappa, sweepRows, sweepStaticView, sweepWorstRise,
    worseForSingleTones
} from '../../js/utils/measurement-dsp/speaker-distortion/sweep.js';
import { validateSpeakerModel } from '../../js/utils/measurement-dsp/speaker-distortion/index.js';
import { decodeSpeakerModel, encodeSpeakerModel } from '../../features/measurement/dataStorage.js';
import { createSpeakerModel } from '../helpers/speaker-model-fixture.mjs';

const COUNT = SWEEP_FREQUENCIES.length;
const MODEL_COLUMNS = SDC_COLUMNS - 2;

// A record of constant |t| = 10^(h2Db/20) at both orders (phase rotating with k), noise
// 10^(noiseDb/20), gRatio 1.
function record({ h2Db = -40, noiseDb = -70, levelDbfs = -20 } = {}) {
    const sweep = { levelDbfs };
    for (const [re, im, noise, gRatio] of [['teRe', 'teIm', 'noise', 'gRatio'], ['t3Re', 't3Im', 'noise3', 'gRatio3']]) {
        for (const key of [re, im, noise, gRatio]) sweep[key] = new Float32Array(COUNT);
        for (let k = 0; k < COUNT; k++) {
            const t = 10 ** (h2Db / 20);
            sweep[re][k] = t * Math.cos(0.3 * k);
            sweep[im][k] = t * Math.sin(0.3 * k);
            sweep[noise][k] = 10 ** (noiseDb / 20);
            sweep[gRatio][k] = 1;
        }
    }
    return sweep;
}
// Single-tone response r = factor · t_e at the points where `pick(f)` holds, 0 elsewhere.
const responseOf = (sweep, factor, pick = () => true) => {
    const r = new Float32Array(2 * COUNT);
    for (let k = 0; k < COUNT; k++) {
        if (!pick(SWEEP_FREQUENCIES[k])) continue;
        r[2 * k] = factor * sweep.teRe[k];
        r[2 * k + 1] = factor * sweep.teIm[k];
    }
    return r;
};

describe('swept-sine columns and Gram', () => {
    let binding = null;
    let context = null;
    let timer = null;

    before(async () => {
        // Referenced guard: a hung WASM call fails the suite instead of stalling it.
        timer = setTimeout(() => assert.fail('sweep column tests timed out'), 120000);
        binding = await instantiateDsp(fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.simd.wasm', import.meta.url)));
        context = createSdcContext(binding);
    });

    after(() => {
        clearTimeout(timer);
        context?.destroy();
        binding?.close?.();
    });

    test('each tone appears once and no product of a group lands on one of its 2f', () => {
        const groups = toneGroups(SWEEP_FREQUENCIES);
        assert.deepStrictEqual(groups.flat().sort((x, y) => x - y), [...SWEEP_FREQUENCIES.keys()]);
        assert.ok(groups.length < COUNT / 4, `${groups.length} groups`);
        for (const group of groups) {
            const f = group.map(k => SWEEP_FREQUENCIES[k]);
            const targets = new Set(f.map(x => 2 * x));
            for (const [i, a] of f.entries()) {
                assert.ok(!targets.has(a));
                for (const b of f.slice(0, i)) assert.ok(!targets.has(a + b) && !targets.has(a - b), `${a} ${b}`);
            }
        }
    });

    test('batched columns equal the single-tone columns; κ, the term mask and the Gram match a dense sum', () => {
        const all = new Uint8Array(SDC_COLUMNS).fill(1);
        const zeros = new Float64Array(COUNT);
        const { tones } = HANDLERS.sweepGram(context, { tRe: zeros, tIm: zeros, w2: zeros, kappa: 1, termMask: all });
        const X = new Float64Array(2 * (MAX_BIN + 1));
        const excited = new Uint8Array(MAX_BIN + 1);
        let peak = 0, error = 0;
        for (const k of [0, 30, 61, 100, COUNT - 1]) {
            const f = SWEEP_FREQUENCIES[k];
            X.fill(0);
            excited.fill(0);
            X[2 * f] = 1;
            excited[f] = 1;
            context.view(SDC_BUFFER.DRIVE).set(X);
            const G = context.view(SDC_BUFFER.G);
            G.fill(0);
            for (let i = 0; i < G.length; i += 2) G[i] = 1;
            context.view(SDC_BUFFER.EXCITED).set(excited);
            context.drive();
            context.view(SDC_BUFFER.TERM_MASK).set(all);
            context.columns();
            const columns = context.view(SDC_BUFFER.COLUMNS);
            const r = f - 18;
            for (let j = 0; j < MODEL_COLUMNS; j++) {
                const re = columns[j * SDC_COLUMN_STRIDE + r], im = columns[j * SDC_COLUMN_STRIDE + ROW_COUNT + r];
                peak = Math.max(peak, Math.hypot(re, im));
                error = Math.max(error, Math.abs(tones[2 * k * SDC_COLUMNS + j] - re), Math.abs(tones[(2 * k + 1) * SDC_COLUMNS + j] - im));
            }
        }
        assert.ok(peak > 0 && error < 1e-5 * peak, `error ${error} of ${peak}`);

        const termMask = Uint8Array.from({ length: SDC_COLUMNS }, (_, j) => (j % 7 === 3 ? 0 : 1));
        const tRe = Float64Array.from({ length: COUNT }, (_, k) => Math.cos(k));
        const tIm = Float64Array.from({ length: COUNT }, (_, k) => Math.sin(k));
        const w2 = Float64Array.from({ length: COUNT }, (_, k) => (k % 50 === 7 ? 1 + k / 100 : 0));
        const kappa = sweepKappa(-20);
        const out = HANDLERS.sweepGram(context, { tRe, tIm, w2, kappa, termMask });
        assert.equal(out.gram.length, SDC_PACKED_LENGTH);
        const row = (k, part) => {
            const a = new Float64Array(SDC_COLUMNS);
            for (let j = 0; j < MODEL_COLUMNS; j++) a[j] = termMask[j] ? kappa * tones[(2 * k + part) * SDC_COLUMNS + j] : 0;
            a[SDC_COLUMNS - 1] = part ? tIm[k] : tRe[k];
            return a;
        };
        const rows = [...w2.keys()].filter(k => w2[k] > 0).flatMap(k => [[w2[k], row(k, 0)], [w2[k], row(k, 1)]]);
        let gramError = 0, gramPeak = 0;
        for (let i = 0, offset = 0; i < SDC_COLUMNS; offset += ++i) {
            for (let j = 0; j <= i; j++) {
                let sum = 0;
                for (const [w, a] of rows) sum += w * a[i] * a[j];
                gramPeak = Math.max(gramPeak, Math.abs(sum));
                gramError = Math.max(gramError, Math.abs(out.gram[offset + j] - sum));
            }
        }
        assert.ok(gramError < 1e-6 * gramPeak, `Gram error ${gramError} of ${gramPeak}`);
        for (let j = 0; j < MODEL_COLUMNS; j++) {
            if (!termMask[j]) assert.equal(out.tones[2 * 61 * SDC_COLUMNS + j], 0);
        }
    });

    test('odd third-harmonic columns: cubic in the drive below the bounds', () => {
        const wide = new Float64Array(ODD_STATES).fill(1e6);
        const at = (kappa, bounds) => HANDLERS.oddTones(context, { kappa, bounds }).columns;
        const full = at(0.05, wide), half = at(0.025, wide);
        let peak = 0, error = 0;
        for (let i = 0; i < full.length; i++) {
            peak = Math.max(peak, Math.abs(full[i]));
            // s̃³/κ: half the drive gives a quarter of the column.
            error = Math.max(error, Math.abs(full[i] - 4 * half[i]));
        }
        assert.ok(peak > 0 && error < 1e-6 * peak, `error ${error} of ${peak}`);
        // A bound the drive exceeds clamps the state, so the column stops growing as κ².
        const tight = Float64Array.from(wide, () => 1e-9);
        const clamped = at(0.05, tight), clampedHalf = at(0.025, tight);
        const a = full.findIndex(value => Math.abs(value) === peak);
        assert.ok(Math.abs(clamped[a] / clampedHalf[a] - 4) > 1, `${clamped[a] / clampedHalf[a]}`);
    });
});

describe('swept-sine row weights, views and rule', () => {
    test('rows: per class the target energy equals the record count; 2f above the limit gets no row; an unobserved point gets target 0', () => {
        const sweep = record();
        for (let k = 0; k < COUNT; k += 9) sweep.noise[k] = 10 ** (-60 / 20) * (1 + k / COUNT);
        sweep.noise[40] = NaN;
        const { w2, tRe, tIm } = sweepRows(sweep, 6, 2000);
        // The unobserved point takes the weight of its nearest observed neighbour (the lower on a tie).
        assert.equal(tRe[40], 0);
        assert.equal(tIm[40], 0);
        assert.equal(w2[40], w2[39]);
        assert.ok(w2[40] > 0);
        for (const [lo, hi] of [[100, 400], [400, 2000]]) {
            let energy = 0;
            for (let k = 0; k < COUNT; k++) {
                const f2 = 2 * SWEEP_FREQUENCIES[k];
                if (f2 >= lo && f2 < hi) energy += w2[k] * (tRe[k] ** 2 + tIm[k] ** 2);
            }
            assert.ok(Math.abs(energy - 6) < 1e-9, `${lo}-${hi}: ${energy}`);
        }
        assert.ok(SWEEP_FREQUENCIES.every((f, k) => 2 * f < 2000 || w2[k] === 0));
        // The ±3-point median ignores a single noisy point; the floor caps a single quiet one.
        const quiet = record();
        quiet.noise[100] = 1e-9;
        const q = sweepRows(quiet, 6, 8000).w2;
        assert.ok(Math.abs(q[100] / q[101] - 1) < 1e-9);
        // Order 3 classes by 3f on its own fields; the second-order noise does not enter.
        const w3 = sweepRows(sweep, 4, Infinity, 3).w2;
        for (const [lo, hi] of [[100, 400], [400, 2000]]) {
            let energy = 0;
            for (let k = 0; k < COUNT; k++) {
                const f3 = 3 * SWEEP_FREQUENCIES[k];
                if (f3 >= lo && f3 < hi) energy += w3[k] * (sweep.t3Re[k] ** 2 + sweep.t3Im[k] ** 2);
            }
            assert.ok(Math.abs(energy - 4) < 1e-9, `order 3 ${lo}-${hi}: ${energy}`);
        }
        assert.ok(w3[40] > 0);
    });

    test('single-tone views in dB re the fundamental, with gRatio and without a response', () => {
        const sweep = record({ h2Db: -40, noiseDb: -70 });
        sweep.gRatio.fill(0.5);
        sweep.noise[10] = NaN;
        const view = sweepH2View(sweep, responseOf(sweep, 0.5));
        assert.deepStrictEqual(view.frequencies, [...SWEEP_FREQUENCIES]);
        const gDb = 20 * Math.log10(0.5);
        assert.ok(Math.abs(view.measured[0] - (-40 + gDb)) < 1e-4);
        assert.ok(Math.abs(view.noise[0] - (-70 + gDb)) < 1e-4);
        assert.ok(Math.abs(view.model[0] - (-46.0206 + gDb)) < 1e-3);
        assert.ok(Math.abs(view.expected[0] - (-46.0206 + gDb)) < 1e-3);
        for (const key of ['measured', 'noise', 'model', 'expected']) assert.equal(view[key][10], null, key);
        const plain = sweepH2View(sweep, null);
        assert.ok(plain.model.every(value => value === null) && plain.expected.every(value => value === null));
        assert.deepStrictEqual(plain.measured, view.measured);
        // The third-harmonic view reads its own fields.
        sweep.t3Re[0] *= 0.1;
        sweep.t3Im[0] *= 0.1;
        const h3 = sweepH3View(sweep, null);
        assert.ok(Math.abs(h3.measured[0] - (-60)) < 1e-4);
        assert.ok(Math.abs(h3.measured[10] - (-40)) < 1e-4, 'second-order noise does not mask order 3');
    });

    test('static view: peak gains from the in-phase parts, bounds from the magnitudes, the map, null where not drawable', () => {
        const sweep = record({ noiseDb: -60 });
        const set = (k, t2Re, t2Im, t3Re, t3Im) => {
            [sweep.teRe[k], sweep.teIm[k], sweep.t3Re[k], sweep.t3Im[k]] = [t2Re, t2Im, t3Re, t3Im];
        };
        set(0, 0.05, 0, -0.02, 0);
        set(1, 0, 0.05, 0, -0.02);
        set(2, 0.05, 0, -0.02, 0);
        sweep.noise3[2] = 0;
        set(3, 0.6, 0, 0, 0);
        const view = sweepStaticView(sweep, [-1, 0, 0.5, 1]);
        assert.deepStrictEqual(view.frequencies, [...SWEEP_FREQUENCIES]);
        const dB = value => 20 * Math.log10(value);
        const [r2, r3] = [Math.fround(0.05), Math.fround(-0.02)];
        const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual}`);
        near(view.positive[0], dB((1 + r3 + 2 * r2) / (1 - 3 * r3)), 'positive');
        near(view.negative[0], dB((1 + r3 - 2 * r2) / (1 - 3 * r3)), 'negative');
        near(view.upper[0], dB((1 - r3 + 2 * r2) / (1 + 3 * r3)), 'upper');
        near(view.lower[0], dB((1 + r3 - 2 * r2) / (1 - 3 * r3)), 'lower');
        near(view.noise[0], dB(1 + Math.hypot(2, 4) * Math.fround(1e-3)), 'noise');
        // The map is the same gain at every instantaneous level: the peaks at its ends, 0 dB at the zero crossing.
        assert.deepStrictEqual([view.map[0][0], view.map[0][3]], [view.negative[0], view.positive[0]]);
        near(view.map[0][1], 0, 'map at 0 %');
        near(view.map[0][2], dB((1 - 3 * r3 + r2 + r3) / (1 - 3 * r3)), 'map at +50 %');
        // Purely quadrature harmonics are not static: both peaks at 0 dB, the bounds still apart.
        near(view.positive[1], 0, 'positive, quadrature');
        near(view.negative[1], 0, 'negative, quadrature');
        assert.ok(view.upper[1] > 0.5 && view.lower[1] < -0.5);
        // Order 3 unobserved, and a negative peak gain below zero: all six are null.
        for (const k of [2, 3]) {
            for (const key of ['positive', 'negative', 'upper', 'lower', 'noise', 'map']) assert.equal(view[key][k], null, `${key} ${k}`);
        }
    });

    test('worse for single tones: a band 6 dB above the noise raised by more than 1 dB switches the length off', () => {
        const sweep = record({ h2Db: -40, noiseDb: -70 });
        assert.equal(singleToneWorseClass(sweep, responseOf(sweep, 0)), null);
        assert.ok(Math.abs(sweepWorstRise(sweep, responseOf(sweep, 0)).riseDb) < 1e-6);
        // r = −t doubles the residual: +6 dB at every band.
        const inBand = f => f >= 560 && f < 710;
        assert.equal(singleToneWorseClass(sweep, responseOf(sweep, -1, inBand)), 'c3');
        assert.equal(singleToneWorseClass(sweep, responseOf(sweep, -1, f => f >= 140 && f < 180)), 'c2');
        assert.equal(singleToneWorseClass(sweep, responseOf(sweep, -1, f => f >= 2500)), 'even8k');
        // The grid starts at 20 Hz; a band below 50 Hz is reported as c1.
        assert.equal(SWEEP_FREQUENCIES[0], 20);
        assert.equal(singleToneWorseClass(sweep, responseOf(sweep, -1, f => f < 25)), 'c1');
        // Rises of 0.9 and 1.1 dB around the 1 dB margin.
        const rise = db => 1 - 10 ** (db / 20);
        assert.equal(singleToneWorseClass(sweep, responseOf(sweep, rise(0.9), inBand)), null);
        assert.equal(singleToneWorseClass(sweep, responseOf(sweep, rise(1.1), inBand)), 'c3');
        // A band counts when its measured or its expected harmonic (−34 dB here) is 6 dB above the noise.
        const noiseInBand = noiseDb => {
            for (let k = 0; k < COUNT; k++) if (inBand(SWEEP_FREQUENCIES[k])) sweep.noise[k] = 10 ** (noiseDb / 20);
        };
        noiseInBand(-38);
        assert.equal(singleToneWorseClass(sweep, responseOf(sweep, -1, inBand)), null);
        noiseInBand(-41);
        assert.equal(singleToneWorseClass(sweep, responseOf(sweep, -1, inBand)), 'c3');
        // Order 3 uses its own fields and the same bands and margins.
        const odd = record({ h2Db: -40, noiseDb: -70 });
        const response3 = (factor, pick) => {
            const r = new Float32Array(2 * COUNT);
            for (let k = 0; k < COUNT; k++) {
                if (!pick(SWEEP_FREQUENCIES[k])) continue;
                r[2 * k] = factor * odd.t3Re[k];
                r[2 * k + 1] = factor * odd.t3Im[k];
            }
            return r;
        };
        assert.equal(worseForSingleTones(odd, response3(0.5, () => true), 3), false);
        assert.equal(worseForSingleTones(odd, response3(rise(0.9), inBand), 3), false);
        assert.equal(worseForSingleTones(odd, response3(rise(1.1), inBand), 3), true);
        odd.noise.fill(1);
        assert.equal(worseForSingleTones(odd, response3(-1, inBand), 3), true, 'order-2 noise is not read');

        const power = [new Array(54).fill(1), new Array(54).fill(0.5)];
        const loud = record({ h2Db: -40, noiseDb: -70 });
        const input = {
            failure: null, figL1: [-6, -6, -6, -6, -6, -6], predictedWorst: null, powerL6: power, powerPeaks: power,
            sweep: loud, response: responseOf(loud, -1, inBand)
        };
        assert.deepStrictEqual(evaluateRule(input), { on: false, reason: 'worseForSingleTones', worst: { set: 'sweep', class: 'c3' } });
        assert.deepStrictEqual(evaluateRule({ ...input, response: responseOf(loud, 0.5) }), { on: true, reason: null, worst: null });
        assert.deepStrictEqual(evaluateRule({ ...input, sweep: null }), { on: true, reason: null, worst: null });
        // worseInCheck comes first.
        assert.equal(evaluateRule(input, { fig: [-6, -6, 2, -6, -6, -6] }).reason, 'worseInCheck');
    });

    test('constrained fit: band weights grow until no counted band rises by more than the margin', async () => {
        const sweep = record({ h2Db: -40, noiseDb: -70 });
        const inBand = f => f >= 570 && f < 710;
        const seen = [];
        // A fit whose in-band response −t/w shrinks as the weight w of that band grows (+6 dB at w = 1).
        const result = await constrainedSweepFit(sweep, 2, bandWeights => {
            seen.push(Float64Array.from(bandWeights));
            const response = responseOf(sweep, -1 / Math.max(...bandWeights), inBand);
            return { response, responses: [response] };
        });
        assert.ok(seen.length > 1, `${seen.length} fits`);
        assert.equal(worseForSingleTones(sweep, result.response, 2), false);
        assert.equal(seen.at(-1).filter(w => w !== 1).length, 1, 'only the raised band is weighted');
        // Without a record the fit runs once, unweighted.
        const calls = [];
        await constrainedSweepFit(null, 2, bandWeights => calls.push(bandWeights));
        assert.deepStrictEqual(calls, [null]);
    });
});

describe('stored swept-sine record', () => {
    test('the record and the responses survive the JSON round trip bit-exact, unobserved points included', () => {
        const model = createSpeakerModel(2);
        const { sweep } = model.channels[0];
        sweep.teRe[3] = sweep.teIm[3] = sweep.noise[3] = sweep.gRatio[3] = NaN;
        sweep.t3Re[4] = sweep.t3Im[4] = sweep.noise3[4] = sweep.gRatio3[4] = NaN;
        const decoded = decodeSpeakerModel(JSON.parse(JSON.stringify(encodeSpeakerModel(model))));
        assert.ok(validateSpeakerModel(decoded));
        assert.deepStrictEqual(decoded.channels[0].sweep, sweep);
        assert.ok(Number.isNaN(decoded.channels[0].sweep.noise[3]));
        assert.deepStrictEqual(decoded.channels[0].sweepResponse, model.channels[0].sweepResponse);
        assert.equal(decoded.channels[1].sweep, null);
    });

    test('a record of the wrong layout makes the model invalid', () => {
        const bad = [
            channel => { channel.sweep.noise = new Float32Array(COUNT - 1); },
            channel => { channel.sweep.teRe = Array.from(channel.sweep.teRe); },
            channel => { delete channel.sweep.levelDbfs; },
            channel => { delete channel.sweep.t3Re; },
            channel => { channel.sweep.gRatio3 = new Float64Array(COUNT); },
            channel => { channel.sweepResponse.short = new Float32Array(COUNT); },
            channel => { delete channel.sweepResponse; }
        ];
        for (const [i, edit] of bad.entries()) {
            const model = createSpeakerModel(1);
            edit(model.channels[0]);
            assert.ok(!validateSpeakerModel(model), `${i}`);
        }
    });
});
