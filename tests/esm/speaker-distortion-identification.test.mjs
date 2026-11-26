// Identification pipeline of the speaker distortion correction:
// signals, preprocessing, the coordinator on simulated plants, checks and refit.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { createSdcContext } from '../../js/utils/measurement-dsp/speaker-distortion/kernels.js';
import {
    MAX_BIN, N, buildCall, combDrive, combLines
} from '../../js/utils/measurement-dsp/speaker-distortion/signals.js';
import {
    PENALTY_MU, analyzeCall, binSets, estimateG, excitedRange, isMains, takeWeights, termMask
} from '../../js/utils/measurement-dsp/speaker-distortion/preprocess.js';
import { HANDLERS } from '../../js/utils/measurement-dsp/speaker-distortion/identify-worker.js';
import {
    buildCapturePlan, callSignalNoise, evaluateOddChecks, evaluateRule, identifySpeakerModel, judgeLevelCheck, oddFitRule, refitSpeakerModel,
    setExecutorFactory
} from '../../js/utils/measurement-dsp/speaker-distortion/identify.js';
import {
    applyCorrectionCheck, buildCheckCall, checkFigures, combineAmplifierChange, estimateAmplifierChange,
    loudCheckConfig, playedCheckFig, recommendLength
} from '../../js/utils/measurement-dsp/speaker-distortion/check.js';
import { ODD_CONFIGS, SWEEP_FREQUENCIES } from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';
import { resampleByRatio } from '../../js/utils/measurement-dsp/resample.js';
import { sweepWorstRise } from '../../js/utils/measurement-dsp/speaker-distortion/sweep.js';
import { validateSpeakerModel } from '../../js/utils/measurement-dsp/speaker-distortion/index.js';
import { biquad, createPlant, filterCascade, linearResponse } from '../helpers/distortion-plant-sim.mjs';
import { createSpeakerModel } from '../helpers/speaker-model-fixture.mjs';

const loadDsp = artifact => instantiateDsp(fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url)));
const FULL_BAND = [20, 20000];
const db = ratio => 10 * Math.log10(ratio);

test('call noise uses a worker without starting a fit and terminates it on cancellation', async t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'Worker', previous);
        else delete globalThis.Worker;
    });
    const sent = [];
    let terminated = 0;
    globalThis.Worker = class {
        postMessage(message) { sent.push(message); }
        terminate() { terminated++; }
    };
    const controller = new AbortController();
    const K = 2;
    const chirp = new Float32Array(1);
    const capture = new Float32Array(4 * N);
    const request = callSignalNoise(capture, { seed: 1, K, chirp }, { rateHz: N, bandwidth: FULL_BAND },
        { signal: controller.signal });
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    assert.deepEqual(sent, [{ id: 1, type: 'analyze', payload: { capture, fsDev: N, K, chirp, seed: 1, bandwidth: FULL_BAND } }]);
    assert.equal(terminated, 1);
});

// Gaussian noise of a fixed seed (Box-Muller on a mulberry32 stream).
function gaussian(seed) {
    let state = seed | 0;
    const uniform = () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
    };
    return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

// Complex response of a biquad cascade at f Hz and rate fs.
function cascadeResponse(sections, f, fs) {
    const w = 2 * Math.PI * f / fs;
    let re = 1, im = 0;
    for (const { b0, b1, b2, a1, a2 } of sections) {
        const nr = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w);
        const ni = -b1 * Math.sin(w) - b2 * Math.sin(2 * w);
        const dr = 1 + a1 * Math.cos(w) + a2 * Math.cos(2 * w);
        const di = -a1 * Math.sin(w) - a2 * Math.sin(2 * w);
        const den = dr * dr + di * di;
        const hr = (nr * dr + ni * di) / den, hi = (ni * dr - nr * di) / den;
        [re, im] = [re * hr - im * hi, re * hi + im * hr];
    }
    return [re, im];
}

const crestDb = (context, X) => {
    const unit = buildCall(context, X, { targetDbfs: 0, K: 1, fsDev: N, bandwidth: FULL_BAND });
    let peak = 0, energy = 0;
    for (let n = 1.5 * N; n < 2.5 * N; n++) {
        const value = unit.samples[n];
        energy += value * value;
        if (Math.abs(value) > peak) peak = Math.abs(value);
    }
    return 20 * Math.log10(peak / Math.sqrt(energy / N));
};

describe('speaker distortion signals and preprocessing', () => {
    let binding = null;
    let context = null;

    before(async () => {
        binding = await loadDsp('effetune-dsp.simd.wasm');
        context = createSdcContext(binding);
    });

    after(() => {
        context?.destroy();
        binding?.close();
    });

    test('line set: 998 groups with one omitted line each, 2992 lines, LF/HF power 80/20', () => {
        const { excited, target } = combLines(1, FULL_BAND);
        let present = 0, low = 0, high = 0;
        for (let group = 0; group < 998; group++) {
            const size = group === 997 ? 2 : 4;
            let inGroup = 0;
            for (let i = 0; i < size; i++) inGroup += excited[21 + 8 * group + 2 * i];
            assert.equal(inGroup, size - 1, `group ${group}`);
        }
        excited.forEach((on, k) => {
            if (!on) return;
            present++;
            if (k <= 499) low += target[k] ** 2;
            else high += target[k] ** 2;
        });
        assert.equal(present, 2992);
        assert.ok(Math.abs(low / (low + high) - 0.8) < 1e-12);
    });

    test('drives are identical across runs and contexts; crest factors stay in the expected range', () => {
        const other = createSdcContext(binding);
        try {
            for (const seed of [1, 8]) {
                assert.deepEqual(combDrive(context, seed).X, combDrive(other, seed).X);
            }
        } finally {
            other.destroy();
        }
        for (let seed = 1; seed <= 9; seed++) {
            const crest = crestDb(context, combDrive(context, seed).X);
            if (seed <= 7) assert.ok(Math.abs(crest - 3.9) < 0.3, `seed ${seed}: ${crest}`);
            else assert.ok(crest > 11 && crest < 13.5, `seed ${seed}: ${crest}`);
        }
    });

    test('the device-rate peak of the averaged periods equals the target; (e) is (d) × 10^(−6/20)', () => {
        const { X } = combDrive(context, 7);
        for (const fsDev of [44100, 48000, 96000]) {
            const K = 7;
            const call = buildCall(context, X, { targetDbfs: -16, K, fsDev, bandwidth: FULL_BAND });
            let peak = 0;
            for (let n = Math.round(1.5 * fsDev); n < Math.round((1.5 + K) * fsDev); n++) {
                if (Math.abs(call.samples[n]) > peak) peak = Math.abs(call.samples[n]);
            }
            assert.ok(Math.abs(20 * Math.log10(peak) + 16) < 0.01, `${fsDev}: ${20 * Math.log10(peak)}`);
            const e = buildCall(context, X, {
                targetDbfs: -22, K, fsDev, bandwidth: FULL_BAND, factor: call.factor * 10 ** (-6 / 20)
            });
            assert.equal(e.factor, call.factor * 10 ** (-6 / 20));
        }
    });

    test('a band-limited call is the full-band call with the lines outside the band removed', () => {
        const request = { seed: 1, targetDbfs: -20, K: 1, fsDev: 44100 };
        const full = HANDLERS.call(context, { ...request, bandwidth: FULL_BAND });
        const band = [1000, 20000];
        const limited = HANDLERS.call(context, { ...request, bandwidth: band });
        const { excited } = combLines(1, band);
        assert.equal(limited.factor, full.factor);
        for (let k = 0; k <= MAX_BIN; k++) {
            const expected = excited[k] ? [full.X[2 * k], full.X[2 * k + 1]] : [0, 0];
            assert.deepEqual([limited.X[2 * k], limited.X[2 * k + 1]], expected, `line ${k}`);
        }
    });

    test('Sweep Bandwidth 100 Hz-20 kHz: no line below 100 Hz, low sections far below it masked off', () => {
        const masks = [1, 2, 3, 4, 5, 6].map(seed => combLines(seed, [100, 20000]).excited);
        for (const excited of masks) for (let k = 0; k < 100; k++) assert.equal(excited[k], 0);
        const [lowest, highest] = excitedRange(masks);
        assert.ok(lowest >= 100);
        const mask = termMask(lowest, highest);
        const full = termMask(21, 7997);
        let masked = 0;
        for (let c = 0; c < 1374; c++) {
            assert.ok(mask[c] <= full[c]);
            masked += full[c] - mask[c];
        }
        assert.ok(masked > 0);
        // Both second-sum lengths share the mask of their source term; mic on, carrier off.
        assert.deepEqual(mask.subarray(990, 1182), mask.subarray(1182, 1374));
        assert.equal(mask[1374], 1);
        assert.equal(mask[1375], 0);
    });

    test('synthetic captures: exact latency, g within 0.05 dB at 44.1, 48 and 96 kHz', () => {
        const drives = [1, 2].map(seed => combDrive(context, seed));
        for (const fsDev of [44100, 48000, 96000]) {
            const response = linearResponse(fsDev);
            const noise = gaussian(fsDev);
            const records = drives.map((drive, i) => {
                const call = buildCall(context, drive.X, { targetDbfs: -20, K: 7, fsDev, bandwidth: FULL_BAND });
                const latency = 137 + 50 * i;
                const capture = new Float32Array(call.samples.length + fsDev);
                const filtered = filterCascade(call.samples, response);
                for (let n = 0; n < filtered.length; n++) capture[n + latency] = filtered[n];
                for (let n = 0; n < capture.length; n++) capture[n] += 2e-4 * noise();
                const analysis = analyzeCall(capture, { fsDev, K: 7, chirp: call.chirp });
                assert.equal(analysis.latency, latency, `${fsDev}`);
                return { X: call.X, excited: drive.excited, Y: analysis.Y, Pn: analysis.Pn };
            });
            const g = estimateG(records);
            let worst = 0, at = 0;
            for (let f = 50; f <= 8000; f += 1) {
                if (!records[0].excited[f]) continue;
                const [hr, hi] = cascadeResponse(response, f, fsDev);
                // The latency is removed by the alignment, so compare magnitudes.
                const error = Math.abs(db((g[2 * f] ** 2 + g[2 * f + 1] ** 2) / (hr * hr + hi * hi)));
                if (error > worst) { worst = error; at = f; }
            }
            assert.ok(worst < 0.05, `${fsDev}: ${worst} dB at ${at} Hz`);
        }
    });

    test('Pn matches the variance of the mean over 200 noise draws; ×2 averaging is 3 dB lower', () => {
        const sigma = 1e-3;
        const chirp = buildCall(context, combDrive(context, 1).X,
            { targetDbfs: -20, K: 1, fsDev: N, bandwidth: FULL_BAND }).chirp;
        const meanPn = (K, draws, seed) => {
            const noise = gaussian(seed);
            let sum = 0, count = 0;
            for (let draw = 0; draw < draws; draw++) {
                const capture = new Float32Array((K + 3) * N);
                capture.set(chirp);
                for (let n = 0; n < capture.length; n++) capture[n] += sigma * noise();
                const { Pn } = analyzeCall(capture, { fsDev: N, K, chirp });
                for (let k = 20; k <= 8000; k++) { sum += Pn[k]; count++; }
            }
            return sum / count;
        };
        const expected = sigma * sigma / N / 7;
        const pn7 = meanPn(7, 200, 1);
        assert.ok(Math.abs(pn7 / expected - 1) < 0.05, `${pn7 / expected}`);
        const pn14 = meanPn(14, 20, 2);
        assert.ok(Math.abs(db(pn14 / pn7) + 3.01) < 0.2, `${db(pn14 / pn7)}`);
    });

    test('mains bins and half-open class edges', () => {
        const bins = binSets(8000);
        const has = (set, f) => set.includes(f);
        assert.ok(has(bins.fit[3], 2000) && !has(bins.fit[2], 2000) && !has(bins.score[2], 2000));
        assert.ok(has(bins.fit[3], 8000) && has(bins.bands[49], 8000) && has(bins.even8k, 8000));
        assert.ok(!has(bins.score[1], 100) && !has(bins.score[0], 100), '100 Hz is a mains bin');
        for (let f = 2; f <= 1001; f += 2) {
            if (!isMains(f)) continue;
            for (const set of [...bins.fit, ...bins.score]) assert.ok(!has(set, f), `${f}`);
        }
        assert.ok(isMains(150) && isMains(299) && isMains(1000) && !isMains(1020) && !isMains(1200));
        // Every even bin of 25 Hz-8 kHz sits in exactly one chart band.
        const count = new Map();
        for (const band of bins.bands) for (const f of band) count.set(f, (count.get(f) ?? 0) + 1);
        assert.ok([...count.values()].every(value => value === 1));
    });

    test('a fit class below the limit keeps its rows; P_ref sums the classes above it', () => {
        const bins = binSets(8000);
        const Y = new Float64Array(2 * (MAX_BIN + 1)).fill(1);
        const Pn = new Float64Array(MAX_BIN + 1).fill(2);
        let pRef = 0;
        for (const classBins of bins.fit.slice(0, 3)) {
            for (const f of classBins) {
                Y[2 * f] = 10;
                pRef += 101;
            }
        }
        const { wp, wq2 } = takeWeights({ Y, Pn }, bins);
        assert.ok(bins.fit.every(classBins => classBins.every(f => wp[f / 2 - 18] > 0)));
        assert.ok(Math.abs(wq2 - PENALTY_MU / pRef) < 1e-12 * wq2);
    });

    test('capture time slips: periods realigned or dropped, clean captures unchanged, too many losses interrupted', () => {
        const fsDev = 96000, K = 14, latency = 3000, seed = 1;
        const call = buildCall(context, combDrive(context, seed).X, { targetDbfs: -20, K, fsDev, bandwidth: FULL_BAND });
        const noise = gaussian(7);
        const base = new Float32Array(latency + call.samples.length + fsDev);
        base.set(call.samples, latency);
        for (let n = 0; n < base.length; n++) base[n] += 2e-5 * noise();
        // Steady window i of the analysis starts 1.5 s + i periods after the chirp.
        const windowAt = i => latency + Math.round((1.5 + i) * fsDev);
        // Each slip [position, d] inserts d zeros (d > 0) or skips −d samples (d < 0) of the clean capture.
        const slipped = (slips, source = base) => {
            let samples = Array.from(source);
            for (const [position, d] of [...slips].sort((a, b) => b[0] - a[0])) {
                samples = d > 0
                    ? [...samples.slice(0, position), ...new Array(d).fill(0), ...samples.slice(position)]
                    : [...samples.slice(0, position), ...samples.slice(position - d)];
            }
            return Float32Array.from(samples);
        };
        const options = { fsDev, K, chirp: call.chirp, seed, bandwidth: FULL_BAND, X: call.X };
        const plain = analyzeCall(base, { fsDev, K, chirp: call.chirp });
        const clean = analyzeCall(base, options);
        assert.deepEqual(clean.Y, plain.Y);
        assert.deepEqual(clean.Pn, plain.Pn);
        assert.equal(clean.gaps, null);
        assert.equal(clean.periods, K);
        assert.deepEqual(clean.dropped, []);
        const reference = clean.peak;
        assert.deepEqual(analyzeCall(base, { ...options, reference }).Y, plain.Y, 'the channel reference keeps a clean capture');
        const { excited } = combLines(seed, FULL_BAND);
        const errorDb = (Y, cleanY = plain.Y) => {
            let error = 0, power = 0;
            for (let f = 50; f <= 8000; f++) {
                if (!excited[f]) continue;
                error += (Y[2 * f] - cleanY[2 * f]) ** 2 + (Y[2 * f + 1] - cleanY[2 * f + 1]) ** 2;
                power += cleanY[2 * f] ** 2 + cleanY[2 * f + 1] ** 2;
            }
            return db(error / power);
        };
        for (const d of [-960, 960, 768, -966, 8633]) {
            const record = analyzeCall(slipped([[windowAt(6) + Math.round(0.3 * fsDev), d]]), { ...options, reference });
            assert.equal(record.gaps, 'corrected', `${d}`);
            assert.ok(record.periods >= 10 && record.dropped.includes(6), `${d}: ${record.dropped}`);
            assert.ok(errorDb(record.Y) < -40, `${d}: ${errorDb(record.Y)} dB`);
        }
        // A slip in the gap between the chirp and the periods delays every period: the channel reference
        // realigns them and drops the first window, which would reach into the fade-in.
        const gapSlip = [[latency + Math.round(0.45 * fsDev), 960]];
        const late = analyzeCall(slipped(gapSlip), { ...options, reference });
        assert.equal(late.gaps, 'corrected');
        assert.equal(late.peak.offset, reference.offset + 960);
        assert.deepEqual(late.dropped, [0]);
        assert.ok(errorDb(late.Y) < -40, `${errorDb(late.Y)} dB`);
        // A response with nearly equal lobes of either sign 8 samples apart (from before the periods, so
        // the chirp latency stays), where the largest magnitude of the slipped capture falls on the other
        // lobe than the reference's: the offset follows the reference's lobe.
        const lobesFrom = latency + Math.round(0.4 * fsDev);
        const lobes = (a, b) => base.map((value, n) => (n < lobesFrom ? value : a * value + b * base[n - 8]));
        const lobeReference = analyzeCall(lobes(1, -0.98), options).peak;
        const other = lobes(0.98, -1);
        const otherPlain = analyzeCall(other, { fsDev, K, chirp: call.chirp });
        const lobeLate = analyzeCall(slipped(gapSlip, other), { ...options, reference: lobeReference });
        assert.equal(lobeLate.peak.offset, lobeReference.offset + 960);
        assert.ok(errorDb(lobeLate.Y, otherPlain.Y) < -40, `${errorDb(lobeLate.Y, otherPlain.Y)} dB`);
        // A jump in every other period leaves too few periods with an agreeing lag.
        const broken = analyzeCall(slipped([1, 3, 5, 7, 9, 11].map(i => [windowAt(i) + fsDev / 2, 960])), { ...options, reference });
        assert.equal(broken.gaps, 'interrupted');
        assert.ok(broken.periods < 0.7 * K || broken.dropped.length > 0.3 * K, `${broken.dropped}`);
        // A recording clock 100 ppm fast moves each period 9.6 samples later than the one before;
        // resampling onto the playback clock keeps every period.
        for (const ratio of [1.0001, 0.9999]) {
            const drifted = analyzeCall(resampleByRatio(base, 1 / ratio, latency), { ...options, reference });
            assert.equal(drifted.gaps, null, `${ratio}`);
            assert.equal(drifted.periods, K);
            assert.ok(errorDb(drifted.Y) < -40, `${ratio}: ${errorDb(drifted.Y)} dB`);
        }
    });
});

const SETTINGS = Object.freeze({
    index: 0, label: 'L', rateHz: N, signalLevelDbfs: -20, bandwidth: FULL_BAND, sweepLength: 65536,
    averaging: 1, upperLimitHz: 8000, inputDeviceId: '', inputDeviceLabel: ''
});
const LENGTH_KEYS = ['short', 'long'];
const REDUCE = 1;
const C1 = 0, EVEN_ALL = 3, TOTAL = 4, EVEN_8K = 5;
const evenPower = (record, bins) => {
    let sum = 0;
    for (const f of bins) sum += record.Y[2 * f] ** 2 + record.Y[2 * f + 1] ** 2 - record.Pn[f];
    return sum;
};
const scaled = (samples, gainDb, delay = 0) => {
    const out = new Float32Array(samples.length + delay);
    const gain = 10 ** (gainDb / 20);
    for (let n = 0; n < samples.length; n++) out[n + delay] = gain * samples[n];
    return out;
};

describe('speaker distortion identification on simulated plants', () => {
    let binding, context, plan;
    const identified = new Map();

    // Each plant is identified once, with the correction check run through it, and the
    // result shared by the assertions.
    async function identifyAndCheck(options) {
        const plant = createPlant(options);
        const recordings = plan.captures.map(capture =>
            plant.capture(capture.samples, { fsDev: N, group: capture.group ?? 'a' }));
        const channel = await identifySpeakerModel({ recordings, plan, settings: SETTINGS });
        const checks = { plain: plant.capture((await buildCheckCall(channel, plan, null)).samples, { group: 'c' }) };
        const odd = Boolean(channel.odd.weights && !channel.odd.fitReason);
        for (const key of LENGTH_KEYS) {
            if (!channel.weights[key]) continue;
            checks[key] = plant.capture((await buildCheckCall(channel, plan, key)).samples, { group: 'c' });
            if (odd) checks[`${key}Odd`] = plant.capture((await buildCheckCall(channel, plan, key, 0, true)).samples, { group: 'c' });
        }
        if (odd) checks.alone = plant.capture((await buildCheckCall(channel, plan, null, 0, true)).samples, { group: 'c' });
        return { plant, identified: channel, channel: await applyCorrectionCheck(channel, checks, { upperLimitHz: 8000 }) };
    }
    function checked(name, options) {
        if (!identified.has(name)) identified.set(name, identifyAndCheck(options));
        return identified.get(name);
    }

    const WOOFER = { kind: 'speaker' };
    const QUADRATIC = { kind: 'quadratic', a: 0.5 };
    // A cubic of the 63-400 Hz band only: the 32 low-frequency states represent it, and it stays small
    // below the single-tone record's lowest observed point, where the odd block is held silent.
    const LOW_CUBIC = { kind: 'quadratic', a: 0, b: 1, bandHz: [63, 400] };

    before(async () => {
        binding = await loadDsp('effetune-dsp.simd.wasm');
        context = createSdcContext(binding);
        setExecutorFactory(() => ({ run: async (type, payload) => HANDLERS[type](context, payload), close() {} }));
        plan = await buildCapturePlan(SETTINGS);
    });

    after(() => {
        setExecutorFactory(null);
        context?.destroy();
        binding?.close?.();
    });

    test('reference woofer: on for both lengths, dominant class predicted ≥ 15 dB lower', async () => {
        const { identified: channel } = await checked('woofer', WOOFER);
        const bins = binSets(8000);
        const aRecords = channel.calls.filter(call => call.group === 'a');
        const classPower = bins.score.map(classBins => aRecords.reduce((sum, record) => sum + evenPower(record, classBins), 0));
        const dominant = classPower.indexOf(classPower.reduce((x, y) => (y > x ? y : x)));
        for (const key of LENGTH_KEYS) {
            assert.equal(channel.on[key], true, key);
            assert.ok(channel.figL[key][REDUCE][dominant] <= -15, `${key}: ${channel.figL[key][REDUCE][dominant]}`);
        }
        assert.equal(channel.micDistortionWarning, false);
    });

    test('correction check through the plant matches the predicted figures', async () => {
        const { channel } = await checked('woofer', WOOFER);
        for (const key of LENGTH_KEYS) {
            assert.equal(channel.on[key], true, key);
            const measured = channel.checkFig[key].fig, predicted = channel.figL[key][REDUCE];
            // C1 (50-100 Hz) has few bins in the single check call; only its reduction is asserted.
            assert.ok(measured[C1] < -3, `${key} C1: ${measured[C1]}`);
            for (let c = C1 + 1; c <= EVEN_8K; c++) {
                assert.ok(Math.abs(measured[c] - predicted[c]) < 1, `${key} ${c}: ${measured[c]} ${predicted[c]}`);
            }
        }
        assert.equal(recommendLength({ channels: [channel] }), 'short');
    });

    test('refit: an unchanged Upper Limit is bit-exact, 500 Hz refits without capture, cancel rejects', async () => {
        const { channel } = await checked('woofer', WOOFER);
        const model = { upperLimitHz: 8000, lastCheck: null, channels: [channel] };
        const [same] = await refitSpeakerModel(model, 8000);
        for (const [key, value] of Object.entries(same)) assert.deepStrictEqual(value, channel[key], key);
        const [low] = await refitSpeakerModel(model, 500);
        for (const key of LENGTH_KEYS) {
            assert.notDeepStrictEqual(low.weights[key], channel.weights[key], key);
            assert.notDeepStrictEqual(low.figL[key], channel.figL[key], key);
            assert.notEqual(low.ampRef[key], channel.ampRef[key], key);
            assert.equal(low.checkFig[key], null, key);
        }
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(refitSpeakerModel(model, 500, { signal: controller.signal }), { name: 'AbortError' });
    });

    test('fast plan: one take of each call; the woofer is corrected, the model is valid and refits bit-exact', async () => {
        const fastPlan = await buildCapturePlan({ ...SETTINGS, fast: true });
        const calls = fastPlan.captures.filter(capture => capture.kind === 'call');
        assert.equal(calls.length, 10);
        assert.ok(calls.every(capture => capture.take === 'A'));
        assert.equal(fastPlan.captures.length, 13);
        const plant = createPlant(WOOFER);
        const recordings = fastPlan.captures.map(capture =>
            plant.capture(capture.samples, { fsDev: N, group: capture.group ?? 'a' }));
        const channel = await identifySpeakerModel({ recordings, plan: fastPlan, settings: SETTINGS });
        for (const key of LENGTH_KEYS) assert.equal(channel.on[key], true, key);
        assert.deepStrictEqual(channel.report.ceiling, [null, null, null]);
        assert.ok(validateSpeakerModel({ ...createSpeakerModel(1), channels: [channel] }));
        const [same] = await refitSpeakerModel({ upperLimitHz: 8000, lastCheck: null, channels: [channel] }, 8000);
        for (const [key, value] of Object.entries(same)) assert.deepStrictEqual(value, channel[key], key);
    });

    test('microphone share: the fast plan reports the same share as the standard plan', async () => {
        const plant = createPlant({ ...WOOFER, mic: 0.5 });
        const shareOf = async capturePlan => {
            const recordings = capturePlan.captures.map(capture =>
                plant.capture(capture.samples, { fsDev: N, group: capture.group ?? 'a' }));
            return (await identifySpeakerModel({ recordings, plan: capturePlan, settings: SETTINGS })).report.micShare;
        };
        const standard = await shareOf(plan);
        const fast = await shareOf(await buildCapturePlan({ ...SETTINGS, fast: true }));
        for (const key of LENGTH_KEYS) assert.ok(Math.abs(fast[key] - standard[key]) < 1.5, `${key}: ${fast[key]} ${standard[key]}`);
    });

    const OFF_CASES = [
        ['noise only', { kind: 'quadratic', a: 0 }, ['belowLimit']],
        ['odd term only', { kind: 'quadratic', a: 0, b: 1 }, ['belowLimit']],
        ['sign flip at L − 6 dB', { ...QUADRATIC, flipGroups: ['d', 'e'] }, ['worseAtLowerVolume']],
        ['sign flip in (f)', { ...QUADRATIC, flipGroups: ['f'] }, ['worseAtLoudPeaks']]
    ];
    for (const [name, options, reasons] of OFF_CASES) {
        test(`off case: ${name} → ${reasons.join(' or ')}`, async () => {
            const { channel } = await checked(name, options);
            for (const key of LENGTH_KEYS) {
                assert.equal(channel.on[key], false, key);
                assert.ok(reasons.includes(channel.reason[key]), `${key}: ${channel.reason[key]}`);
            }
        });
    }

    test('odd block: off without odd distortion, fitted and lowered on a cubic plant', async () => {
        const { channel: noise } = await checked('noise only', OFF_CASES[0][1]);
        assert.ok(['belowLimit', 'littleGain'].includes(noise.odd.fitReason), noise.odd.fitReason);
        if (noise.odd.fitReason === 'belowLimit') assert.equal(noise.odd.weights, null);
        assert.ok(ODD_CONFIGS.every(c => !noise.odd.on[c]));

        const { channel: cubic } = await checked('low cubic', LOW_CUBIC);
        const { odd } = cubic;
        assert.equal(odd.fitReason, null);
        assert.ok(odd.figL.oddAll <= -1, `${odd.figL.oddAll}`);
        // The even block is off, so only the odd pass alone was played; the high-volume check is still due.
        assert.equal(odd.checkFig.short, null);
        assert.ok(odd.checkFig.alone.odd[3] <= -1, `${odd.checkFig.alone.odd[3]}`);
        assert.equal(odd.reason.alone, 'notChecked');
        assert.equal(loudCheckConfig(cubic), 'alone');
        // The single-tone third harmonic of the sweep record is observed and lowered by the fit.
        assert.equal(odd.sweepResponse.length, 2 * SWEEP_FREQUENCIES.length);
        const rise = sweepWorstRise(cubic.sweep, odd.sweepResponse, 3);
        assert.ok(rise && rise.riseDb < -5, JSON.stringify(rise));
        // Where the record cannot see, the block's single-tone response stays well below the observed band.
        const power = k => odd.sweepResponse[2 * k] ** 2 + odd.sweepResponse[2 * k + 1] ** 2;
        const meanDb = points => db(points.reduce((sum, k) => sum + power(k), 0) / points.length);
        const points = SWEEP_FREQUENCIES.map((_, k) => k);
        const unobserved = points.filter(k => !(cubic.sweep.noise3[k] > 0));
        const observed = points.filter(k => cubic.sweep.noise3[k] > 0 && SWEEP_FREQUENCIES[k] < 400);
        assert.ok(unobserved.length > 0);
        assert.ok(meanDb(unobserved) < meanDb(observed) - 10, `${meanDb(unobserved)} ${meanDb(observed)}`);
    });

    test('refit: odd weights unchanged, checks kept only for unchanged weights', async () => {
        const { channel } = await checked('low cubic', LOW_CUBIC);
        const [low] = await refitSpeakerModel({ upperLimitHz: 8000, lastCheck: null, channels: [channel] }, 500);
        assert.deepStrictEqual(low.odd.weights, channel.odd.weights);
        assert.deepStrictEqual(low.odd.bounds, channel.odd.bounds);
        assert.deepStrictEqual(low.odd.checkFig.alone, channel.odd.checkFig.alone);
        for (const key of LENGTH_KEYS) {
            const same = Boolean(low.weights[key]) && channel.weights[key] !== null &&
                low.weights[key].every((w, i) => Object.is(w, channel.weights[key][i]));
            if (!same) assert.equal(low.odd.checkFig[key], null, key);
        }
    });

    test('odd decision table and high-volume check order', () => {
        const fig = (oddAll, total) => ({
            dv: 0, odd: [null, null, null, oddAll], total,
            vsPlain: { fig: [0, 0, 0, 0, 0, total], level: [0, 0, 0, 0], bandSums: new Float32Array(150) }
        });
        const block = (checkFig, loud = null, fitReason = null) => evaluateOddChecks({
            weights: new Float32Array(32), bounds: new Float32Array(32).fill(1), fitReason, loud,
            on: {}, reason: {}, checkFig: { short: null, long: null, alone: null, ...checkFig }
        });
        let odd = block({ short: fig(-0.5, -1), long: fig(-3, 0.2), alone: fig(-3, -1) });
        assert.deepStrictEqual(odd.reason, { short: 'littleGain', long: 'worseOverall', alone: 'notChecked' });
        assert.equal(loudCheckConfig({ odd }), 'alone');
        odd = block({ long: fig(-3, -1) });
        assert.deepStrictEqual(odd.reason, { short: 'notChecked', long: 'notChecked', alone: 'notChecked' });
        assert.equal(loudCheckConfig({ odd }), 'long');
        assert.equal(block({ long: fig(-3, -1) }, { dv: 0, t: null }).reason.long, 'worseWhenLoud');
        assert.equal(block({ long: fig(-3, -1) }, { dv: 0, t: 6, odd: [null, null, null, -2], total: 0.6 }).reason.long,
            'worseWhenLoud');
        odd = block({ long: fig(-3, -1) }, { dv: 0, t: 6, odd: [null, null, null, -2], total: 0.5 });
        assert.deepStrictEqual(odd.on, { short: false, long: true, alone: false });
        assert.equal(loudCheckConfig({ odd }), null, 'measured once');
        assert.equal(block({ long: fig(-3, -1) }, null, 'worseInCheck').reason.long, 'worseInCheck');
        assert.equal(loudCheckConfig({ odd: block({}) }), null, 'nothing passes tests 1-3');
        assert.equal(loudCheckConfig({ odd: { ...block({ alone: fig(-3, -1) }), weights: null } }), null);

        const figL = (o1, o2, o3, oddAll) => ({ o1, o2, o3, oddAll });
        assert.deepStrictEqual(oddFitRule(figL(-2, -2, null, -0.9), null), { fitReason: 'littleGain', worst: null });
        assert.deepStrictEqual(oddFitRule(figL(-6, 1.5, null, -3), null),
            { fitReason: 'worseInCheck', worst: { set: 'L', class: 'o2' } });
        assert.deepStrictEqual(oddFitRule(figL(-6, -1, null, -3), 0.1),
            { fitReason: 'worseAtLowerVolume', worst: { set: 'L-6', class: 'oddAll' } });
        assert.deepStrictEqual(oddFitRule(figL(-6, -1, null, -3), -2), { fitReason: null, worst: null });
        assert.deepStrictEqual(oddFitRule(figL(-6, -1, null, -3), -2, true), { fitReason: 'worseForSingleTones', worst: null });
        assert.deepStrictEqual(oddFitRule(figL(-6, -1, null, -3), 0.1, true),
            { fitReason: 'worseAtLowerVolume', worst: { set: 'L-6', class: 'oddAll' } });
        assert.equal(block({ long: fig(-3, -1) }, null, 'worseForSingleTones').reason.long, 'worseForSingleTones');

        // What plays: the odd pass against plain when odd plays, the even check otherwise.
        const evenFig = { dv: 0, fig: [0, 0, 0, 0, 0, -4], level: [0, 0, 0, 0], bandSums: new Float32Array(150) };
        const channel = { checkFig: { short: evenFig, long: null }, odd };
        assert.equal(playedCheckFig(channel, 'short', false), evenFig);
        assert.deepStrictEqual(playedCheckFig(channel, 'long', true), { dv: 0, ...odd.checkFig.long.vsPlain });
        assert.equal(playedCheckFig(channel, null, true), null);
        assert.equal(playedCheckFig(channel, null, false), null);
    });

    test('amplifier change estimate on the quadratic plant', async () => {
        const { plant, channel } = await checked('quadratic', QUADRATIC);
        assert.equal(channel.on.short, true);
        const samples = plan.check.samples;
        const estimate = recording => estimateAmplifierChange(channel, 'short', recording);
        const delay = Math.round(0.0015 * N);
        for (const [label, recording, expected] of [
            ['amplifier -6 dB', plant.capture(scaled(samples, -6), { group: 'c' }), -6],
            ['amplifier -12 dB', plant.capture(scaled(samples, -12), { group: 'c' }), -12],
            ['microphone +24 dB', scaled(plant.capture(samples, { group: 'c' }), 24), 0],
            ['microphone -24 dB', scaled(plant.capture(samples, { group: 'c' }), -24), 0],
            ['1.5 ms delay', plant.capture(scaled(samples, 0, delay), { group: 'c' }), 0]
        ]) {
            const { db: V, z } = await estimate(recording);
            assert.ok(z >= 30, `${label}: z ${z}`);
            assert.ok(Math.abs(V - expected) < 0.2, `${label}: ${V}`);
        }
        const oddOnly = createPlant({ kind: 'quadratic', a: 0, b: 1 });
        const { z } = await estimate(oddOnly.capture(samples, { group: 'c' }));
        assert.ok(z === null || z < 30, `${z}`);
    });

    test('swept-sine record and single-tone fit on the quadratic plant (mid-band blind spot)', async () => {
        const { identified: channel } = await checked('quadratic', QUADRATIC);
        // True electrical second-order transfer of y = x + a·(B x)²: t_e(f) = a·A/2·B(f)² at peak A.
        const band = [biquad('highpass', 40, N, Math.SQRT1_2), biquad('lowpass', 1500, N, Math.SQRT1_2)];
        const A = 10 ** (plan.levelDbfs / 20);
        const truth = f => {
            const [re, im] = cascadeResponse(band, f, N);
            return [QUADRATIC.a * A / 2 * (re * re - im * im), QUADRATIC.a * A * re * im];
        };
        // Error energy relative to the true energy over the points of [lo, hi] Hz, in dB.
        const errorDb = (re, im, lo, hi) => {
            let error = 0, energy = 0;
            for (const [k, f] of SWEEP_FREQUENCIES.entries()) {
                if (f < lo || f > hi) continue;
                const [tr, ti] = truth(f);
                error += (re[k] - tr) ** 2 + (im[k] - ti) ** 2;
                energy += tr * tr + ti * ti;
            }
            return 10 * Math.log10(error / energy);
        };
        const { sweep } = channel;
        assert.equal(sweep.levelDbfs, plan.levelDbfs);
        const record = errorDb(sweep.teRe, sweep.teIm, 100, 1000);
        assert.ok(record < -25, `record: ${record}`);
        // The multitone alone barely observes the 500-800 Hz diagonal; the swept-sine rows pin it. Below the
        // record's lowest observed point the rows hold the model silent though this plant still distorts there.
        for (const key of LENGTH_KEYS) {
            const response = channel.sweepResponse[key];
            const re = SWEEP_FREQUENCIES.map((_, k) => response[2 * k]), im = SWEEP_FREQUENCIES.map((_, k) => response[2 * k + 1]);
            const model = errorDb(re, im, 500, 800);
            assert.ok(model < -28, `${key} model: ${model}`);
        }
        for (const key of LENGTH_KEYS) {
            assert.equal(channel.on[key], true, key);
            assert.ok(sweepWorstRise(sweep, channel.sweepResponse[key]).riseDb < -6, key);
        }
    });

    test('combineAmplifierChange outcomes', () => {
        const accepted = value => ({ db: value, accepted: true });
        assert.deepStrictEqual(combineAmplifierChange([accepted(2), accepted(-6)], -3), { dv: 0, outcome: 'louder' });
        assert.deepStrictEqual(combineAmplifierChange([{ db: -6, accepted: false }, null], -3),
            { dv: -3, outcome: 'undetermined' });
        assert.deepStrictEqual(combineAmplifierChange([accepted(-0.5), accepted(-1.2)], -3), { dv: 0, outcome: 'same' });
        assert.deepStrictEqual(combineAmplifierChange([accepted(-6.2), accepted(-6.5)], 0), { dv: -6.5, outcome: 'lower' });
        assert.deepStrictEqual(combineAmplifierChange([accepted(-30)], 0), { dv: -24, outcome: 'lower' });
    });

    test('level check: overloaded, too quiet and passed with the headroom and the signal-to-noise ratio', async () => {
        const levelPlan = plan;
        const loud = createPlant({ kind: 'quadratic', a: 0, noiseDbfs: null }).capture(plan.levelCheck, { group: 'a' });
        let peak = 0;
        for (const value of loud) peak = value > peak ? value : -value > peak ? -value : peak;
        const passed = judgeLevelCheck(loud, levelPlan);
        assert.equal(passed.outcome, 'passed');
        assert.equal(passed.headroomDb, -20 * Math.log10(peak));
        assert.equal(judgeLevelCheck(scaled(loud, -20 * Math.log10(peak / 0.708)), levelPlan).outcome, 'overloaded');
        const random = gaussian(5);
        // Signal-to-noise ratio: the excited lines against white noise of deviation σ between 50 Hz and 8 kHz.
        const sigma = 1e-4;
        const clean = analyzeCall(loud, { fsDev: N, K: 2, chirp: plan.levelChirp });
        const excited = combLines(1, FULL_BAND).excited;
        let signal = 0;
        for (let f = 50; f <= 8000; f++) if (excited[f]) signal += clean.Y[2 * f] ** 2 + clean.Y[2 * f + 1] ** 2;
        const noisy = Float32Array.from(loud, value => value + sigma * random());
        const noisePower = 7951 * sigma * sigma / N;
        const noisyJudged = judgeLevelCheck(noisy, levelPlan);
        assert.ok(Math.abs(noisyJudged.snrDb - db(signal / noisePower)) < 0.5);
        assert.ok(Math.abs(db(noisyJudged.noisePower / noisePower)) < 0.5);
        // A call of the run measures the same noise power, whatever its period count.
        const call = createPlant({ kind: 'quadratic', a: 0, noiseDbfs: null }).capture(plan.check.samples);
        const { noise: callNoise } = await callSignalNoise(Float32Array.from(call, value => value + sigma * random()),
            plan.check, { rateHz: N, bandwidth: FULL_BAND });
        assert.ok(Math.abs(db(callNoise / noisePower)) < 0.5);
        const noise = Float32Array.from({ length: loud.length }, () => 1e-3 * random());
        assert.equal(judgeLevelCheck(noise, levelPlan).outcome, 'tooQuiet');
        // Digital silence (a muted or unconnected input) has no noise to compare against.
        assert.deepStrictEqual(judgeLevelCheck(new Float32Array(loud.length), levelPlan),
            { outcome: 'tooQuiet', headroomDb: null });
    });

    test('call noise requires a signal and all measured periods, without requiring the fade-out', async () => {
        const { check } = plan;
        const settings = { rateHz: N, bandwidth: FULL_BAND };
        const latency = 137;
        const delayed = scaled(check.samples, 0, latency);
        const end = latency + (check.K + 1.5) * N;
        await assert.rejects(callSignalNoise(new Float32Array(check.samples.length), check, settings),
            { code: 'analysisFailed' });
        await assert.rejects(callSignalNoise(delayed.subarray(0, end - 1), check, settings),
            { code: 'analysisFailed' });
        const complete = await callSignalNoise(check.samples, check, settings);
        assert.ok(complete.signal > 0);
        assert.deepEqual(await callSignalNoise(delayed.subarray(0, end), check, settings), complete);
    });

    test('measured figures equal a direct sum; a class below the limit gives null', () => {
        const bins = binSets(8000);
        const excited = combLines(10, FULL_BAND).excited;
        const random = gaussian(9);
        const record = scale => {
            const Y = Float32Array.from({ length: 16002 }, () => scale * random());
            const Pn = Float32Array.from({ length: 8001 }, () => 1e-4 * scale * scale);
            return { Y, Pn, excited };
        };
        const plain = record(1), corrected = record(0.5);
        for (const f of bins.score[C1]) plain.Y[2 * f] = plain.Y[2 * f + 1] = 0;
        const active = [true, true, true];
        const { fig } = checkFigures(plain, corrected, bins, active, 0);
        const floored = (rec, set) => set.reduce((sum, f) => {
            const value = rec.Y[2 * f] ** 2 + rec.Y[2 * f + 1] ** 2 - rec.Pn[f];
            return sum + (value > 0 ? value : 0);
        }, 0);
        assert.equal(fig[C1], null);
        for (const c of [1, 2]) {
            const direct = db(floored(corrected, bins.score[c]) / floored(plain, bins.score[c]));
            assert.ok(Math.abs(fig[c] - direct) < 1e-9, `${c}`);
        }
        const directEven = db(floored(corrected, bins.even8k) / floored(plain, bins.even8k));
        assert.ok(Math.abs(fig[EVEN_8K] - directEven) < 1e-9);
        assert.ok(fig[EVEN_ALL] !== null && fig[TOTAL] !== null);
    });

    test('the correction check is worse when the total or the 50 Hz-8 kHz figure rises by more than 1 dB', () => {
        const power = [new Array(54).fill(1), new Array(54).fill(0.5)];
        const input = { failure: null, figL1: null, predictedWorst: null, powerL6: power, powerPeaks: power };
        const rule = fig => evaluateRule(input, { fig });
        assert.deepStrictEqual(rule([-6, -6, -6, -6, -3, 1]), { on: true, reason: null, worst: null });
        assert.deepStrictEqual(rule([-6, -6, -6, -6, 1.2, -1]),
            { on: false, reason: 'worseInCheck', worst: { set: 'L', class: 'total' } });
        assert.deepStrictEqual(rule([-6, 1.1, -6, -6, -3, 1.5]),
            { on: false, reason: 'worseInCheck', worst: { set: 'L', class: 'even8k' } });
    });

    test('recommended Filter Length', () => {
        const model = createSpeakerModel(2);
        const set = (channel, key, on, predicted, measured = null) => {
            channel.on[key] = on;
            channel.figL[key][REDUCE] = [0, 0, 0, 0, 0, predicted];
            channel.checkFig[key] = measured === null ? null
                : { dv: 0, fig: [0, 0, 0, 0, 0, measured], level: [0, 0, 0, 0], bandSums: new Float32Array(150) };
        };
        const [first, second] = model.channels;
        set(first, 'short', true, -10); set(second, 'short', true, -10);
        set(first, 'long', true, -11); set(second, 'long', true, -10.9);
        assert.equal(recommendLength(model), 'short', 'less than 1 dB better');
        set(second, 'long', true, -11);
        assert.equal(recommendLength(model), 'long', '1 dB better');
        set(second, 'long', false, -30);
        assert.equal(recommendLength(model), 'short', 'an off channel counts 0');
        set(second, 'long', true, -11, -9);
        assert.equal(recommendLength(model), 'short', 'measured figures take precedence');
    });
});
