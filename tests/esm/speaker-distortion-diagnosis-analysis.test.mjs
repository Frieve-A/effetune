// Speaker distortion diagnosis: the measurement-DSP options it relies on and
// self-checks of the simulated plants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { createEssSignal, createEssCapturePlan, analyzeEssRecording } from '../../js/utils/measurement-dsp/ess.js';
import { analyzeDistortion } from '../../js/utils/measurement-dsp/analysis.js';
import {
    BAND_EDGES, N_BANDS, REF_ODD, REF_ODD_VAR, SETS
} from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';
import { analyzeDiagnosis } from '../../js/utils/measurement-dsp/speaker-distortion/diagnosis-analysis.js';
import { HANDLERS } from '../../js/utils/measurement-dsp/speaker-distortion/identify-worker.js';
import {
    buildCapturePlan, referenceSums, setExecutorFactory
} from '../../js/utils/measurement-dsp/speaker-distortion/identify.js';
import { createSdcContext } from '../../js/utils/measurement-dsp/speaker-distortion/kernels.js';
import { binSets } from '../../js/utils/measurement-dsp/speaker-distortion/preprocess.js';
import { combLines } from '../../js/utils/measurement-dsp/speaker-distortion/signals.js';
import { biquad, createPlant, linearResponse } from '../helpers/distortion-plant-sim.mjs';
import { analyzeCall, buildCall, combDrive, estimateG } from '../helpers/speaker-distortion-reference.mjs';

const sweep = createEssSignal({ length: 32768, sampleRate: 16000, startFrequency: 40, endFrequency: 7000 });
const OFFSET = Math.round(sweep.sampleRate * 0.55);
const DELAY = 120;

function recording(gain = 0.5) {
    const plan = createEssCapturePlan(sweep, 1);
    const data = new Float32Array(OFFSET + plan.playbackSamples + sweep.sampleRate / 2);
    for (let i = 0; i < sweep.length; i++) {
        const x = sweep.signal[i] * gain;
        data[OFFSET + i + DELAY] = x + 0.1 * x * x;
    }
    return data;
}

const options = { playbackOffsetSamples: OFFSET, levelDb: 20 * Math.log10(0.5), outputTimeReference: 'audio-context' };

test('analyzeDistortion returns one fundamental per frequency', () => {
    const result = analyzeDistortion(analyzeEssRecording(recording(), sweep, options).harmonicAnalysis);
    assert.equal(result.fundamentals.length, result.frequencies.length);
    const at1k = result.frequencies.findIndex(f => f >= 1000);
    assert.ok(Math.abs(result.fundamentals[at1k] - 1) < 0.01, `fundamental ${result.fundamentals[at1k]}`);
});

test('analyzeEssRecording uses fixedLatencySamples as the response offset', () => {
    const data = recording();
    const searched = analyzeEssRecording(data, sweep, options);
    assert.equal(searched.trimStartSamples + searched.onsetIndex, DELAY);
    // The searched offset as a fixed latency reproduces the result exactly.
    assert.deepEqual(analyzeEssRecording(data, sweep, { ...options, fixedLatencySamples: DELAY }), searched);
    // A different fixed latency moves the windows by the difference.
    const shifted = analyzeEssRecording(data, sweep, { ...options, fixedLatencySamples: DELAY - 5 });
    const peakOf = data_ => data_.reduce((best, value, i) => (Math.abs(value) > Math.abs(data_[best]) ? i : best), 0);
    assert.equal(shifted.trimStartSamples + shifted.onsetIndex, DELAY - 5);
    assert.equal(peakOf(shifted.harmonicAnalysis.orders[0].data), peakOf(searched.harmonicAnalysis.orders[0].data) + 5);
    // A silent capture has no peak to search but stays aligned with a fixed latency.
    const silent = new Float32Array(data.length);
    assert.throws(() => analyzeEssRecording(silent, sweep, options), /No usable ESS response/);
    const aligned = analyzeEssRecording(silent, sweep, { ...options, fixedLatencySamples: DELAY });
    assert.equal(aligned.trimStartSamples + aligned.onsetIndex, DELAY);
    for (const invalid of [-1, 1.5, Number.NaN]) {
        assert.throws(() => analyzeEssRecording(data, sweep, { ...options, fixedLatencySamples: invalid }), TypeError);
    }
});

// |H(e^jω)| of a biquad cascade at f.
function cascadeMagnitude(sections, f, fs) {
    const w = 2 * Math.PI * f / fs;
    let re = 1, im = 0;
    for (const { b0, b1, b2, a1, a2 } of sections) {
        const nr = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w), ni = -b1 * Math.sin(w) - b2 * Math.sin(2 * w);
        const dr = 1 + a1 * Math.cos(w) + a2 * Math.cos(2 * w), di = -a1 * Math.sin(w) - a2 * Math.sin(2 * w);
        const den = dr * dr + di * di;
        const hr = (nr * dr + ni * di) / den, hi = (ni * dr - nr * di) / den;
        [re, im] = [re * hr - im * hi, re * hi + im * hr];
    }
    return Math.hypot(re, im);
}

function amplitudeAt(signal, start, length, f, fs) {
    let re = 0, im = 0;
    for (let n = 0; n < length; n++) {
        const phase = 2 * Math.PI * f * n / fs;
        re += signal[start + n] * Math.cos(phase);
        im -= signal[start + n] * Math.sin(phase);
    }
    return 2 * Math.hypot(re, im) / length;
}

test('the square-law plant adds the second harmonic at its expected level', () => {
    const fs = 48000, amplitude = 0.3, a = 0.2, latencySamples = 50;
    const plant = createPlant({ kind: 'quadratic', a, noiseDbfs: null, jitter: false, latencySamples });
    const sine = Float32Array.from({ length: 2 * fs }, (_, n) => amplitude * Math.sin(2 * Math.PI * 1000 * n / fs));
    const capture = plant.capture(sine, { fsDev: fs });
    const band = [biquad('highpass', 40, fs, Math.SQRT1_2), biquad('lowpass', 1500, fs, Math.SQRT1_2)];
    const expected = a * (amplitude * cascadeMagnitude(band, 1000, fs)) ** 2 / 2 * cascadeMagnitude(linearResponse(fs), 2000, fs);
    const measured = amplitudeAt(capture, fs / 2 + latencySamples, fs, 2000, fs);
    assert.ok(Math.abs(measured / expected - 1) < 0.01, `${measured} versus ${expected}`);
    // The same plant without the even term leaves no second harmonic.
    const linear = createPlant({ kind: 'quadratic', a: 0, noiseDbfs: null, jitter: false, latencySamples });
    assert.ok(amplitudeAt(linear.capture(sine, { fsDev: fs }), fs / 2 + latencySamples, fs, 2000, fs) < 1e-6 * expected);
});

test('plants are deterministic and add noise at the configured level', () => {
    const input = Float32Array.from({ length: 4800 }, (_, n) => 0.2 * Math.sin(2 * Math.PI * 300 * n / 48000));
    const captures = () => {
        const plant = createPlant({ kind: 'speaker', seed: 3 });
        return [plant.capture(input), plant.capture(input), plant.capture(input)];
    };
    assert.deepEqual(captures(), captures());
    const quiet = createPlant({ kind: 'quadratic', a: 0, seed: 3 });
    const noise = quiet.capture(new Float32Array(48000));
    const rmsDb = 10 * Math.log10(noise.reduce((sum, value) => sum + value * value, 0) / noise.length);
    assert.ok(Math.abs(rmsDb + 59) < 0.2, `noise ${rmsDb} dBFS`);
});

test('the simulated reference woofer distorts mainly at even orders of a bass tone', () => {
    const fs = 48000;
    const plant = createPlant({ kind: 'speaker', noiseDbfs: null, jitter: false, latencySamples: 0 });
    const tone = Float32Array.from({ length: fs }, (_, n) => 0.3 * Math.sin(2 * Math.PI * 100 * n / fs));
    const capture = plant.capture(tone, { fsDev: fs });
    const [h1, h2] = [100, 200].map(f => amplitudeAt(capture, fs / 2, fs / 2, f, fs));
    assert.ok(Number.isFinite(h1) && h1 > 0);
    const secondDb = 20 * Math.log10(h2 / h1);
    assert.ok(secondDb > -70 && secondDb < -15, `second harmonic ${secondDb} dB`);
});

test('a COMB call through a linear plant gives the latency and the linear response', () => {
    const latencySamples = 300;
    const plant = createPlant({ kind: 'quadratic', a: 0, latencySamples, seed: 5 });
    const drive = combDrive(8);
    const call = buildCall(drive, { targetDbfs: -10 });
    const capture = plant.capture(call.samples);
    const { latency, Y, Pn } = analyzeCall(capture, { K: call.K, chirp: call.chirp });
    assert.ok(latency === latencySamples || latency === latencySamples + 1, `latency ${latency}`);
    const g = estimateG([{ X: call.X, excited: drive.excited, Y, Pn }]);
    const response = linearResponse(48000);
    for (const f of [101, 301, 1001, 2501, 4001]) {
        const f0 = drive.excited[f] ? f : f + 2;
        const db = 10 * Math.log10(g[2 * f0] ** 2 + g[2 * f0 + 1] ** 2) - 20 * Math.log10(cascadeMagnitude(response, f0, 48000));
        assert.ok(Math.abs(db) < 0.1, `${f0} Hz: ${db} dB`);
    }
});

// ---------------------------------------------------------------- diagnosis block

const DSP_WASM = new URL('../../plugins/dsp/effetune-dsp.simd.wasm', import.meta.url);
const SETTINGS = {
    index: 0, label: 'L', signalLevelDbfs: -20, bandwidth: [20, 20000], sweepLength: 65536, averaging: 1,
    upperLimitHz: 8000, inputDeviceId: '', inputDeviceLabel: ''
};
const dsp = (async () => {
    const binding = await instantiateDsp(fs.readFileSync(DSP_WASM));
    const context = createSdcContext(binding);
    setExecutorFactory(() => ({ run: async (type, payload) => HANDLERS[type](context, payload), close() {} }));
    return { binding, context };
})();
test.after(async () => {
    const { binding, context } = await dsp;
    context.destroy();
    binding.close?.();
});

const plans = new Map();
async function capturePlan(rateHz) {
    await dsp;
    if (!plans.has(rateHz)) plans.set(rateHz, await buildCapturePlan({ ...SETTINGS, rateHz }));
    return plans.get(rateHz);
}

// All 22 captures of the capture plan through `plant` (or given `recordings`), optionally changed by
// `addToOutput`, with the analyzed calls and the diagnosis block.
async function diagnose(plant, { rateHz = 48000, recordings = null, addToOutput = null } = {}) {
    const { context } = await dsp;
    const plan = await capturePlan(rateHz);
    let captured = recordings ?? plan.captures.map(capture => plant.capture(capture.samples, { fsDev: rateHz, group: capture.group }));
    if (addToOutput) captured = captured.map(capture => addToOutput(Float32Array.from(capture), rateHz));
    const calls = plan.captures.slice(0, 19).map((capture, i) => {
        const { Y, Pn } = HANDLERS.analyze(context, { capture: captured[i], fsDev: rateHz, K: capture.K, chirp: capture.chirp });
        const { seed, take, group, peakDbfs, K } = capture;
        return { seed, take, group, peakDbfs, K, Y, Pn, excited: combLines(seed, SETTINGS.bandwidth).excited };
    });
    const { diagnosis, sweep } = analyzeDiagnosis({
        essL: captured[19], ess6: captured[20], silence: captured[21], calls, rateHz,
        bandwidth: SETTINGS.bandwidth, sweepLength: SETTINGS.sweepLength, levelDbfs: plan.levelDbfs
    });
    return { diagnosis, sweep, calls, captured };
}

const dB = (num, den) => 10 * Math.log10(num / den);
const totalExcited = calls => calls.reduce((sum, call) => {
    let x = 0;
    for (let f = 1; f < call.excited.length; f++) if (call.excited[f]) x += call.Y[2 * f] ** 2 + call.Y[2 * f + 1] ** 2;
    return sum + x;
}, 0) / calls.length;
// Order-n sweep ratio (mean r_n² over the band's points) of one sweep's sums.
const sweepRatio = (sums, n, i) => sums.h[n - 1][i] / sums.h1[n - 2][i];
// Band i of order n is well above its noise sum at both sweep levels.
const sweepAboveNoise = (ess, n, i) => ess.pts[i] >= 4 &&
    [ess.essL, ess.ess6].every(sums => sums.h[n - 1][i] > 10 * sums.z[n - 2][i] && sums.h1[n - 2][i] > 0);
const sumOf = values => values.reduce((sum, value) => sum + value, 0);

let squareLaw = null;
const squareLawRun = () => (squareLaw ??= diagnose(createPlant({ kind: 'quadratic', a: 0.5, seed: 11 })));
let linear = null;
const linearRun = () => (linear ??= diagnose(createPlant({ kind: 'quadratic', a: 0, seed: 12 })));

test('the diagnosis block has the fields and lengths expected', async () => {
    const { diagnosis } = await squareLawRun();
    assert.ok(diagnosis.nx instanceof Uint16Array && diagnosis.nx.length === N_BANDS);
    for (const set of SETS) {
        for (const key of ['ev', 'evPn', 'odPn', 'noise']) assert.equal(diagnosis.sets[set][key].length, N_BANDS, `${set} ${key}`);
    }
    assert.ok(diagnosis.silence instanceof Float32Array && diagnosis.silence.length === N_BANDS);
    assert.ok(diagnosis.hum50 instanceof Float32Array && diagnosis.hum50.length === 20);
    assert.ok(diagnosis.hum60 instanceof Float32Array && diagnosis.hum60.length === 16);
    for (const key of ['essL', 'ess6']) {
        const sums = diagnosis.ess[key];
        assert.equal(sums.h.length, 10);
        assert.equal(sums.h1.length, 9);
        assert.equal(sums.z.length, 9);
        for (const values of [...sums.h, ...sums.h1, ...sums.z]) assert.ok(values instanceof Float32Array && values.length === N_BANDS);
    }
    assert.ok(diagnosis.ess.pts instanceof Uint16Array && diagnosis.ess.pts.length === N_BANDS);
});

test('a square-law plant: even sums fall 6 dB per 6 dB of drive and odd sums stay below the noise', async () => {
    const { diagnosis, calls } = await squareLawRun();
    const { L, 'L-6': six } = diagnosis.sets;
    // Relative to the fundamentals: the drive of L-6 against that of L.
    const drop = dB(totalExcited(calls.filter(call => call.group === 'a')), totalExcited(calls.filter(call => call.group === 'd')));
    // L and L-6 play different seeds, so single bands differ by their line layout; their sum does not.
    const strong = [...Array(N_BANDS).keys()].filter(i => L.ev[i] > 100 * L.evPn[i] && six.ev[i] > 100 * six.evPn[i]);
    assert.ok(strong.length >= 5, `${strong.length} bands with enough signal`);
    const fallEven = dB(sumOf(strong.map(i => L.ev[i])), sumOf(strong.map(i => six.ev[i]))) - drop;
    assert.ok(Math.abs(fallEven - 6) <= 1, `even sums fall ${fallEven} dB`);
    let checked = 0;
    for (let i = 0; i < N_BANDS; i++) {
        if (!sweepAboveNoise(diagnosis.ess, 2, i)) continue;
        const fall = dB(sweepRatio(diagnosis.ess.essL, 2, i), sweepRatio(diagnosis.ess.ess6, 2, i));
        assert.ok(Math.abs(fall - 6) <= 1, `band ${i}: H2 falls ${fall} dB`);
        checked++;
    }
    assert.ok(checked >= 5, `${checked} sweep bands`);
    const ref = referenceSums(calls.filter(call => call.group === 'a'), binSets(8000));
    for (let i = 0; i < N_BANDS; i++) {
        assert.ok(ref[REF_ODD + i] <= 3 * Math.sqrt(ref[REF_ODD_VAR + i]), `band ${i}: odd sum above the noise`);
    }
});

test('a cubic plant: H3 falls 12 dB per 6 dB of drive and the linear gain stays put', async () => {
    const { diagnosis } = await diagnose(createPlant({ kind: 'quadratic', a: 0, b: 1, noiseDbfs: -100, seed: 13 }));
    const { essL, ess6, pts } = diagnosis.ess;
    let checked = 0;
    for (let i = 0; i < N_BANDS; i++) {
        // Bands at the sweep's lower edge hold only part of their points.
        if (pts[i] < 8) continue;
        const gain = dB(essL.h[0][i], ess6.h[0][i]);
        assert.ok(Math.abs(gain) <= 0.1, `band ${i}: chart D ${gain} dB`);
        if (!sweepAboveNoise(diagnosis.ess, 3, i)) continue;
        const fall = dB(sweepRatio(essL, 3, i), sweepRatio(ess6, 3, i));
        assert.ok(Math.abs(fall - 12) <= 1, `band ${i}: H3 falls ${fall} dB`);
        checked++;
    }
    assert.ok(checked >= 5, `${checked} sweep bands`);
});

test('hum shows in hum50 only and leaves the mains bands of ev and the odd sums unchanged', async () => {
    const base = await squareLawRun();
    const hum = await diagnose(null, {
        recordings: base.captured,
        addToOutput: (capture, fs) => capture.map((value, n) => value + 0.003 * Math.sin(2 * Math.PI * 50 * n / fs))
    });
    assert.ok(hum.diagnosis.hum50[0] >= 10, `hum50[0] ${hum.diagnosis.hum50[0]} dB`);
    // The peak is the largest of three noise bins against a median, so noise alone reaches about 5 dB.
    for (const [h, excess] of hum.diagnosis.hum60.entries()) assert.ok(excess < 6, `hum60[${h}] ${excess} dB`);
    const bins = binSets(8000);
    const refOf = run => referenceSums(run.calls.filter(call => call.group === 'a'), bins);
    const [refBase, refHum] = [refOf(base), refOf(hum)];
    const close = (a, b, scale) => Math.abs(a - b) <= 0.023 * Math.abs(b) + 1e-3 * scale;
    for (let i = 0; BAND_EDGES[i] < 1001; i++) {
        for (const set of SETS) {
            const [a, b] = [hum.diagnosis.sets[set].ev[i], base.diagnosis.sets[set].ev[i]];
            assert.ok(close(a, b, base.diagnosis.sets[set].evPn[i]), `${set} band ${i}: ev ${a} versus ${b}`);
        }
        assert.ok(close(refHum[REF_ODD + i], refBase[REF_ODD + i], Math.sqrt(refBase[REF_ODD_VAR + i])), `band ${i}: odd sum`);
    }
});

test('without distortion the sweep harmonic sums stay at their noise sums', async () => {
    // A band holds about one independent noise value per point, so the check uses the sum over the bands.
    const { diagnosis } = await linearRun();
    for (const [key, sums] of Object.entries({ essL: diagnosis.ess.essL, ess6: diagnosis.ess.ess6 })) {
        for (let n = 2; n <= 10; n++) {
            const [h, z] = [sumOf(sums.h[n - 1]), sumOf(sums.z[n - 2])];
            assert.ok(h > 0 && h <= 4 * z && z <= 4 * h, `${key} order ${n}: ${h} versus noise ${z}`);
        }
    }
});

test('the sweep noise sums do not depend on the device rate', async () => {
    const at48 = (await linearRun()).diagnosis.ess;
    const at44 = (await diagnose(createPlant({ kind: 'quadratic', a: 0, seed: 12 }), { rateHz: 44100 })).diagnosis.ess;
    // Noise sums relative to the fundamental, over every band and order.
    const noise = ess => sumOf(ess.essL.z.map(sumOf)) / sumOf(ess.essL.h1.map(sumOf));
    const difference = dB(noise(at44), noise(at48));
    assert.ok(Math.abs(difference) <= 1, `${difference} dB`);
});
