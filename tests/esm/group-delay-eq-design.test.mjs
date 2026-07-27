import assert from 'node:assert/strict';
import test from 'node:test';

import FFT from '../../js/utils/measurement-dsp/fft.js';
import {
    GROUP_DELAY_EQ_BANDS,
    designGroupDelayFilter,
    groupDelayResponseFrequencies,
    groupDelayTargetMs
} from '../../js/group-delay-eq/design-core.js';

const sampleRate = 48000;
const taps = 8192;

function flatDelays() {
    return new Array(GROUP_DELAY_EQ_BANDS.length).fill(0);
}

function realizedAt(result, frequency) {
    const { frequencies, realizedMs } = result.response;
    let nearest = 0;
    for (let point = 1; point < frequencies.length; point += 1) {
        if (Math.abs(frequencies[point] - frequency) < Math.abs(frequencies[nearest] - frequency)) {
            nearest = point;
        }
    }
    return realizedMs[nearest];
}

test('Group Delay EQ leaves audio as a pure delay when every band is zero', () => {
    const result = designGroupDelayFilter({ delaysMs: flatDelays(), taps, sampleRate });
    assert.equal(result.bulkDelaySamples, taps / 2);
    assert.equal(result.ir[taps / 2], 1);
    let worst = 0;
    for (let index = 0; index < result.ir.length; index += 1) {
        if (index === taps / 2) continue;
        const magnitude = Math.abs(result.ir[index]);
        if (magnitude > worst) worst = magnitude;
    }
    assert.ok(20 * Math.log10(worst + 1e-30) < -100, `worst stray tap ${worst}`);
    assert.ok(result.rippleDb < 1e-6);
});

test('Group Delay EQ keeps the magnitude response flat while delaying the low bands', () => {
    const delaysMs = flatDelays();
    delaysMs[0] = 8;
    delaysMs[1] = 8;
    delaysMs[2] = 6;
    delaysMs[3] = 4;
    delaysMs[4] = 2;
    const result = designGroupDelayFilter({ delaysMs, taps, sampleRate });

    assert.equal(result.clamped, false);
    assert.ok(result.rippleDb < 0.1, `ripple ${result.rippleDb} dB`);

    const padded = new Float64Array(taps * 2);
    padded.set(result.ir);
    const spectrum = new FFT(padded.length).realTransform(padded);
    for (const frequency of [50, 200, 1000, 5000, 15000]) {
        const bin = Math.round(frequency * padded.length / sampleRate);
        const magnitudeDb = 20 * Math.log10(Math.hypot(spectrum.real[bin], spectrum.imag[bin]));
        assert.ok(Math.abs(magnitudeDb) < 0.1, `${frequency} Hz magnitude ${magnitudeDb} dB`);
    }

    assert.ok(Math.abs(realizedAt(result, 40) - 8) < 0.5);
    assert.ok(Math.abs(realizedAt(result, 1000)) < 0.1);
});

test('Group Delay EQ designs are deterministic', () => {
    const delaysMs = flatDelays();
    delaysMs[5] = -6;
    delaysMs[10] = 4;
    const first = designGroupDelayFilter({ delaysMs, taps, sampleRate });
    const second = designGroupDelayFilter({ delaysMs, taps, sampleRate });
    assert.deepEqual(Array.from(first.ir), Array.from(second.ir));
});

test('Group Delay EQ clamps delays that do not fit inside the tap count', () => {
    const delaysMs = flatDelays().map(() => 20);
    const result = designGroupDelayFilter({ delaysMs, taps: 4096, sampleRate: 192000 });
    assert.equal(result.clamped, true);
    assert.ok(result.limitMs < 20);
    assert.ok(Math.abs(realizedAt(result, 1000) - result.limitMs) < 0.5);
});

test('Group Delay EQ target curve passes through the slider values', () => {
    const delaysMs = flatDelays();
    delaysMs[3] = 10;
    delaysMs[8] = -5;
    const frequencies = groupDelayResponseFrequencies(sampleRate);
    const target = groupDelayTargetMs({ delaysMs, taps, sampleRate, frequencies });
    assert.equal(target.length, frequencies.length);
    for (const [band, expected] of [[3, 10], [8, -5]]) {
        const center = GROUP_DELAY_EQ_BANDS[band];
        let nearest = 0;
        for (let point = 1; point < frequencies.length; point += 1) {
            if (Math.abs(frequencies[point] - center) < Math.abs(frequencies[nearest] - center)) {
                nearest = point;
            }
        }
        assert.ok(Math.abs(target[nearest] - expected) < 0.5,
            `band ${center} Hz target ${target[nearest]} ms`);
    }
});

test('Group Delay EQ rejects unsupported tap counts', () => {
    assert.throws(() => designGroupDelayFilter({ delaysMs: flatDelays(), taps: 1024, sampleRate }),
        RangeError);
});
