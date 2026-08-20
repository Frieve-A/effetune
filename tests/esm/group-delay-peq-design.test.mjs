import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIrAssetPayload, IR_ASSET_MAGIC, IR_ASSET_TOPOLOGY } from '../../js/ir-library/ir-asset-payload.js';
import {
    GROUP_DELAY_PEQ_BAND_COUNT,
    GROUP_DELAY_PEQ_TYPES,
    designGroupDelayPeqFilter,
    groupDelayPeqResponseFrequencies,
    groupDelayPeqTargetMs
} from '../../js/group-delay-peq/design-core.js';

const sampleRate = 48000;
const taps = 8192;
/** Same expression as the plugin delay input maximum: floored to the 0.1 ms step. */
const limitMs = Math.floor((taps / 2 - taps / 16) * 1000 / sampleRate * 10) / 10;
const fadeEnd = Math.min(20000, sampleRate * 0.45);
const fadeStart = fadeEnd * 0.9;
const MONOTONIC_Q = 1 / Math.sqrt(3);

function band(type, frequency, delayMs, q, enabled = true) {
    return { type, frequency, delayMs, q, enabled };
}

/** Group delay of a second order section, in seconds (independent reference). */
function tau2(frequency, centreFrequency, q) {
    const w = 2 * Math.PI * frequency;
    const w0 = 2 * Math.PI * centreFrequency;
    return (w0 / q) * (w * w + w0 * w0) / ((w0 * w0 - w * w) ** 2 + (w0 * w / q) ** 2);
}

function tau2PeakFrequency(centreFrequency, q) {
    if (q <= MONOTONIC_Q) return 0;
    return centreFrequency * Math.sqrt(Math.sqrt(4 - 1 / (q * q)) - 1);
}

function tau2Peak(centreFrequency, q) {
    return tau2(tau2PeakFrequency(centreFrequency, q), centreFrequency, q);
}

/** First order all-pass group delay, in seconds. */
function tau1(frequency, centreFrequency) {
    const w = 2 * Math.PI * frequency;
    const w0 = 2 * Math.PI * centreFrequency;
    return 2 * w0 / (w0 * w0 + w * w);
}

/** Filter GD band that cancels `scale` copies of a second order section group delay. */
function filterGdCorrection(frequency, q, scale = 1) {
    return band('fl', frequency, -scale * tau2Peak(frequency, q) * 1000, q);
}

function targetAt(bands, frequencies, options = {}) {
    const grid = Float64Array.from(frequencies);
    return groupDelayPeqTargetMs({ bands, taps, sampleRate, frequencies: grid, ...options });
}

/**
 * Worst realized-versus-target group delay error above `minimumFrequency`.
 *
 * Every point is allowed a tenth of what it asks for, plus an absolute floor so that
 * points asking for nearly nothing do not demand impossible relative accuracy. The
 * floor is capped at a tenth of the largest delay the case asks for, because a fixed
 * floor as large as the whole shape would let a filter that realizes no group delay
 * at all sit inside the tolerance and pass.
 */
function worstGroupDelayError(result, minimumFrequency) {
    const { frequencies, targetMs, realizedMs } = result.response;
    let peakTargetMs = 0;
    for (let point = 0; point < frequencies.length; point += 1) {
        if (frequencies[point] < minimumFrequency) continue;
        peakTargetMs = Math.max(peakTargetMs, Math.abs(targetMs[point]));
    }
    const floorMs = Math.min(0.5, 0.1 * peakTargetMs);
    let worstErrorMs = 0;
    let worstRatio = 0;
    for (let point = 0; point < frequencies.length; point += 1) {
        if (frequencies[point] < minimumFrequency) continue;
        const error = Math.abs(realizedMs[point] - targetMs[point]);
        const tolerance = Math.max(floorMs, 0.1 * Math.abs(targetMs[point]));
        worstErrorMs = Math.max(worstErrorMs, error);
        worstRatio = Math.max(worstRatio, error / tolerance);
    }
    return { worstErrorMs, worstRatio };
}

test('Group Delay PEQ exposes the five band four type contract', () => {
    assert.equal(GROUP_DELAY_PEQ_BAND_COUNT, 5);
    assert.deepEqual(Array.from(GROUP_DELAY_PEQ_TYPES), ['pk', 'ls', 'hs', 'fl']);
    assert.equal(groupDelayPeqResponseFrequencies(sampleRate).length, 128);
});

test('Group Delay PEQ measures the response over the plot range', () => {
    // The plugin graph spans 10 Hz to 40 kHz, so the response grid does too and the
    // realized curve reaches both edges instead of stopping inside the plot. Above
    // 0.45 fs there is nothing to measure, so the grid ends there instead.
    const wide = groupDelayPeqResponseFrequencies(96000);
    assert.equal(wide[0], 10);
    assert.ok(Math.abs(wide[wide.length - 1] - 40000) < 1e-6, `top ${wide[wide.length - 1]}`);

    const limited = groupDelayPeqResponseFrequencies(sampleRate);
    assert.equal(limited[0], 10);
    assert.ok(Math.abs(limited[limited.length - 1] - sampleRate * 0.45) < 1e-6);

    // Both ends carry real measurements, so the whole drawn curve means something.
    const result = designGroupDelayPeqFilter({
        bands: [band('pk', 1000, 5, 0.7)], taps, sampleRate: 96000
    });
    assert.ok(Array.from(result.response.realizedMs).every(Number.isFinite));
    assert.ok(Math.abs(result.response.realizedMs[0]) < 0.5);
    assert.ok(Math.abs(result.response.realizedMs[result.response.realizedMs.length - 1]) < 0.5);
});

test('Group Delay PEQ leaves audio as a pure delay when no band asks for delay', () => {
    const zeroed = [
        band('pk', 100, 0, 0.7), band('ls', 316, 0, 1), band('hs', 1000, 0, 2),
        band('fl', 40, 0, 0.7071), band('pk', 10000, 0, 0.7)
    ];
    const disabled = [
        band('pk', 100, 5, 0.7, false), band('ls', 316, -8, 1, false), band('hs', 1000, 2, 2, false),
        band('fl', 40, -6, 0.7071, false), band('pk', 10000, 1, 0.7, false)
    ];
    for (const bands of [zeroed, disabled]) {
        const result = designGroupDelayPeqFilter({ bands, taps, sampleRate });
        assert.equal(result.bulkDelaySamples, taps / 2);
        assert.equal(result.ir[taps / 2], 1);
        let strayPeak = 0;
        for (let index = 0; index < result.ir.length; index += 1) {
            if (index === taps / 2) continue;
            strayPeak = Math.max(strayPeak, Math.abs(result.ir[index]));
        }
        assert.ok(strayPeak <= 1e-5, `stray tap ${strayPeak}`);
    }
});

test('Group Delay PEQ keeps the magnitude flat and realizes the peak band delay', () => {
    const bands = [band('pk', 1000, 5, 0.7)];
    const result = designGroupDelayPeqFilter({ bands, taps, sampleRate });
    assert.equal(result.clamped, false);
    assert.ok(result.rippleDb <= 0.1, `ripple ${result.rippleDb} dB`);
    const { worstRatio, worstErrorMs } = worstGroupDelayError(result, 100);
    assert.ok(worstRatio <= 1, `group delay error ${worstErrorMs} ms`);
});

test('Group Delay PEQ realizes Filter GD and mixed type corrections', () => {
    const sealed = designGroupDelayPeqFilter({
        bands: [filterGdCorrection(40, 0.7071)],
        taps,
        sampleRate
    });
    assert.ok(sealed.rippleDb <= 0.1, `sealed ripple ${sealed.rippleDb} dB`);
    assert.ok(worstGroupDelayError(sealed, 100).worstRatio <= 1);

    // Study U7 style full chain: bass reflex B4 30 Hz, LR4 100 Hz, first order DC cut, touch-up.
    const fullChain = [
        filterGdCorrection(30, 0.5412),
        filterGdCorrection(30, 1.3066),
        filterGdCorrection(100, 0.7071, 2),
        filterGdCorrection(20, 0.5, 0.5),
        band('pk', 1000, 0.5, 1)
    ];
    const mixed = designGroupDelayPeqFilter({ bands: fullChain, taps, sampleRate });
    assert.ok(mixed.rippleDb <= 0.1, `mixed ripple ${mixed.rippleDb} dB`);
    assert.ok(worstGroupDelayError(mixed, 100).worstRatio <= 1);
    assert.ok(Array.from(mixed.response.targetMs).every(Number.isFinite));
});

test('Group Delay PEQ peak bands follow the bell shape', () => {
    const centre = 1000;
    const delayMs = 5;
    const q = 0.7;
    const bandwidth = (2 / Math.LN2) * Math.asinh(1 / (2 * q));
    const lower = centre * 2 ** (-bandwidth / 2);
    const upper = centre * 2 ** (bandwidth / 2);
    assert.ok(lower >= 20 && upper <= fadeStart);
    const values = targetAt([band('pk', centre, delayMs, q)], [lower, centre, upper]);
    assert.ok(Math.abs(values[1] - delayMs) <= 0.05 * delayMs);
    assert.ok(Math.abs(values[0] - delayMs / 2) <= 0.05 * delayMs / 2);
    assert.ok(Math.abs(values[2] - delayMs / 2) <= 0.05 * delayMs / 2);
});

test('Group Delay PEQ shelf bands are logistic and exactly complementary', () => {
    const centre = 316;
    const delayMs = 8;
    const q = 1;
    const lower = centre * 2 ** (-1 / q);
    const upper = centre * 2 ** (1 / q);
    assert.ok(lower >= 20 && upper <= fadeStart);
    const probes = [20, lower, centre, upper, fadeStart];
    const lowShelf = targetAt([band('ls', centre, delayMs, q)], probes);
    const highShelf = targetAt([band('hs', centre, delayMs, q)], probes);

    assert.ok(Math.abs(lowShelf[2] - delayMs / 2) <= 1e-6);
    assert.ok(Math.abs(lowShelf[1] - delayMs * 4 / 5) <= 1e-6);
    assert.ok(Math.abs(lowShelf[3] - delayMs / 5) <= 1e-6);
    assert.ok(Math.abs(lowShelf[0] - delayMs) <= 0.05 * delayMs);
    assert.ok(Math.abs(lowShelf[4]) <= 0.01 * delayMs);

    for (let point = 1; point < probes.length; point += 1) {
        assert.ok(lowShelf[point] <= lowShelf[point - 1], 'low shelf must fall monotonically');
    }
    // High Shelf is the mirror image: tau_hs = d - tau_ls, and at Q = 1 the Low Shelf
    // is the normalised scale form of the first order all-pass group delay.
    for (let point = 0; point < probes.length; point += 1) {
        assert.ok(Math.abs(highShelf[point] - (delayMs - lowShelf[point])) <= 1e-12);
        const scaled = delayMs * tau1(probes[point], centre) / tau1(0, centre);
        assert.ok(Math.abs(lowShelf[point] - scaled) <= 1e-12);
    }
});

test('Group Delay PEQ Filter GD bands match the analytic second order group delay', () => {
    // The low Q bass reflex section sits between 0.5 and 1/sqrt(3), where a 0.5
    // threshold would produce a NaN normalisation constant.
    for (const [centre, q] of [[30, 0.5412], [30, 1.3066], [40, 0.7071], [1000, 8]]) {
        const bands = [band('fl', centre, -3, q)];
        // The comparison stays inside [20 Hz, fadeStart]: below 20 Hz the curve holds
        // tau(20 Hz) and above fadeStart the raised cosine taper is in effect.
        const probes = [20, Math.max(20, centre / 2), centre, centre * 2, 5000];
        const values = targetAt(bands, probes);
        for (let point = 0; point < probes.length; point += 1) {
            const expected = -3 * tau2(probes[point], centre, q) / tau2Peak(centre, q);
            assert.ok(Number.isFinite(values[point]), `Filter GD ${centre} Hz Q${q} produced ${values[point]}`);
            assert.ok(Math.abs(values[point] - expected) <= 1e-6,
                `Filter GD ${centre} Hz Q${q} at ${probes[point]} Hz: ${values[point]} vs ${expected}`);
        }
    }
});

test('Group Delay PEQ Filter GD normalises to the curve extremum', () => {
    for (const [centre, q, delayMs] of [[1000, 2, 3], [200, 0.7071, -4], [5000, 8, 2]]) {
        const extremum = tau2PeakFrequency(centre, q);
        assert.ok(extremum >= 20 && extremum <= fadeStart);
        const bands = [band('fl', centre, delayMs, q)];
        assert.ok(Math.abs(Math.abs(targetAt(bands, [extremum])[0]) - Math.abs(delayMs)) <= 1e-9);
        const sweep = new Float64Array(1000);
        const ratio = Math.log10(fadeStart / 20) / (sweep.length - 1);
        for (let point = 0; point < sweep.length; point += 1) sweep[point] = 20 * 10 ** (ratio * point);
        const values = groupDelayPeqTargetMs({ bands, taps, sampleRate, frequencies: sweep });
        for (const value of values) {
            assert.ok(Math.abs(value) <= Math.abs(delayMs) + 1e-9, `curve ${value} exceeds |d| ${delayMs}`);
        }
    }
    // Q = 0.5 is the first order all-pass shape (LR2 sum).
    const firstOrder = [band('fl', 100, -8, 0.5)];
    for (const frequency of [20, 50, 100, 400, 2000]) {
        const expected = -8 * tau1(frequency, 100) / tau1(0, 100);
        assert.ok(Math.abs(targetAt(firstOrder, [frequency])[0] - expected) <= 1e-12);
    }
});

test('Group Delay PEQ holds below 20 Hz and fades to zero before Nyquist', () => {
    const bands = [band('hs', 5000, 1, 1)];
    const held = targetAt(bands, [0, 5, 10, 20]);
    for (const value of held) assert.ok(Math.abs(value - held[3]) <= 1e-12);

    const taperFactor = frequency =>
        0.5 + 0.5 * Math.cos(Math.PI * (frequency - fadeStart) / (fadeEnd - fadeStart));
    const shape = frequency => 1 / (1 + 4 ** (-Math.log2(frequency / 5000)));
    const tapered = targetAt(bands, [17000, 19000, fadeEnd]);
    assert.ok(Math.abs(tapered[0] - shape(17000)) <= 1e-9);
    assert.ok(Math.abs(tapered[1] - shape(19000) * taperFactor(19000)) <= 1e-9);
    assert.equal(tapered[2], 0);
});

test('Group Delay PEQ pulls the fade below Nyquist at 44.1 kHz', () => {
    // 44.1 kHz is the only supported rate whose 0.9 * Nyquist falls under 20 kHz, so it
    // is the only one that exercises the second branch of the fade end.
    const rate = 44100;
    const end = Math.min(20000, rate / 2 * 0.9);
    const start = end * 0.9;
    assert.equal(end, 19845);
    assert.equal(start, 17860.5);

    const bands = [band('hs', 5000, 1, 1)];
    const shape = frequency => 1 / (1 + 4 ** (-Math.log2(frequency / 5000)));
    const taperFactor = frequency => 0.5 + 0.5 * Math.cos(Math.PI * (frequency - start) / (end - start));
    const middle = (start + end) / 2;
    const probes = Float64Array.of(17000, start, middle, 19000, end);
    const values = groupDelayPeqTargetMs({ bands, taps, sampleRate: rate, frequencies: probes });
    assert.ok(Math.abs(values[0] - shape(17000)) <= 1e-9);
    assert.ok(Math.abs(values[1] - shape(start)) <= 1e-9, 'the fade starts above the fade start');
    assert.ok(Math.abs(values[2] - shape(middle) * 0.5) <= 1e-9);
    assert.ok(Math.abs(values[3] - shape(19000) * taperFactor(19000)) <= 1e-9);
    assert.equal(values[4], 0);
});

test('Group Delay PEQ keeps the magnitude flat and realizes the shelf band delay', () => {
    const result = designGroupDelayPeqFilter({ bands: [band('hs', 2000, 0.5, 8)], taps, sampleRate });
    assert.equal(result.clamped, false);
    assert.ok(result.rippleDb <= 0.1, `ripple ${result.rippleDb} dB`);
    const { worstRatio, worstErrorMs } = worstGroupDelayError(result, 100);
    assert.ok(worstRatio <= 1, `group delay error ${worstErrorMs} ms`);
});

test('Group Delay PEQ clamps oversized and superposed delays', () => {
    const shortTaps = 4096;
    const fastRate = 192000;
    const shortLimitMs = Math.floor((shortTaps / 2 - shortTaps / 16) * 1000 / fastRate * 10) / 10;
    const oversized = designGroupDelayPeqFilter({
        bands: [band('pk', 1000, 20, 0.7)],
        taps: shortTaps,
        sampleRate: fastRate
    });
    assert.equal(oversized.clamped, true);
    assert.ok(oversized.limitMs < 20);
    // The reported limit sits on the 0.1 ms step the delay input offers, so the warning
    // text and the input maximum quote the same number.
    assert.equal(oversized.limitMs, shortLimitMs);
    // Each delay is clamped on its own before the sum, so the bell keeps its shape at the
    // clamped height. Clipping the sum alone would flatten it into a plateau at the limit,
    // and only a probe away from the band centre tells the two apart.
    const shape = band('pk', 1000, 20, 0.7);
    const halfWidth = (1 / Math.LN2) * Math.asinh(1 / (2 * shape.q));
    const halfPoint = shape.frequency * 2 ** halfWidth;
    assert.ok(halfPoint < fastRate / 2 * 0.9 * 0.9);
    const halfValue = groupDelayPeqTargetMs({
        bands: [shape],
        taps: shortTaps,
        sampleRate: fastRate,
        frequencies: Float64Array.of(halfPoint)
    })[0];
    assert.ok(Math.abs(halfValue - oversized.limitMs / 2) <= 1e-9,
        `half point ${halfValue} ms is not the half height of the clamped bell`);

    const superposed = designGroupDelayPeqFilter({
        bands: [band('pk', 1000, limitMs * 0.6, 0.7), band('pk', 1000, limitMs * 0.6, 0.7)],
        taps,
        sampleRate
    });
    assert.equal(superposed.clamped, true);

    const mixed = designGroupDelayPeqFilter({
        bands: [band('fl', 40, -limitMs * 0.7, 0.7071), band('ls', 40, -limitMs * 0.7, 1)],
        taps,
        sampleRate
    });
    assert.equal(mixed.clamped, true);

    const inside = designGroupDelayPeqFilter({ bands: [band('pk', 1000, 5, 0.7)], taps, sampleRate });
    assert.equal(inside.clamped, false);

    // A disabled band takes part in neither the sum nor the clamp decision, however far
    // beyond the limit the delay it still carries happens to be.
    const disabledOversized = designGroupDelayPeqFilter({
        bands: [band('pk', 1000, 5, 0.7), band('pk', 2000, 1e6, 0.7, false)],
        taps,
        sampleRate
    });
    assert.equal(disabledOversized.clamped, false);
});

test('Group Delay PEQ designs are deterministic', () => {
    const config = {
        bands: [band('pk', 316, 8, 0.7), band('hs', 2000, 0.3, 2), filterGdCorrection(40, 0.7071)],
        taps,
        sampleRate
    };
    const first = designGroupDelayPeqFilter(config);
    const second = designGroupDelayPeqFilter(config);
    assert.deepEqual(Array.from(first.ir), Array.from(second.ir));
    assert.equal(first.rippleDb, second.rippleDb);
});

test('Group Delay PEQ impulse responses build a mono IR asset payload', () => {
    const result = designGroupDelayPeqFilter({ bands: [band('pk', 1000, 5, 0.7)], taps, sampleRate });
    const payload = buildIrAssetPayload({
        channels: [result.ir],
        sampleRate,
        topology: IR_ASSET_TOPOLOGY.mono
    });
    const view = new DataView(payload);
    assert.equal(view.getUint32(0, true), IR_ASSET_MAGIC);
    assert.equal(view.getUint32(4, true), 1);
    assert.equal(view.getUint32(8, true), taps);
    assert.equal(view.getUint32(12, true), sampleRate);
    assert.equal(view.getUint32(16, true), IR_ASSET_TOPOLOGY.mono);
    assert.equal(payload.byteLength, 32 + taps * 4);
});

test('Group Delay PEQ rejects unsupported tap counts and sample rates', () => {
    assert.throws(() => designGroupDelayPeqFilter({ bands: [], taps: 1024, sampleRate }), RangeError);
    assert.throws(() => designGroupDelayPeqFilter({ bands: [], taps, sampleRate: 0 }), RangeError);
});
