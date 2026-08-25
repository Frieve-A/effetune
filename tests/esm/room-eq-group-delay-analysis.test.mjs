import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveFrequencyResponse } from '../../js/pipeline-analyzer/analysis-core.js';
import { designRoomEq } from '../../js/room-eq/design-core.js';
import FFT from '../../js/utils/measurement-dsp/fft.js';
import {
    analyzeRoomEqGroupDelay,
    combineRoomEqGroupDelay,
    minimumPhaseGroupDelaySecondsFromMagnitudes,
    smoothAndReferenceRoomEqGroupDelay,
    smoothRoomEqGroupDelay
} from '../../js/room-eq/group-delay-analysis.js';

function secondOrderAllPass(sampleRate, frequency, radius, length) {
    const impulse = new Float32Array(length);
    const cosine = Math.cos(2 * Math.PI * frequency / sampleRate);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let index = 0; index < impulse.length; index += 1) {
        const input = index === 0 ? 1 : 0;
        const output = radius * radius * input - 2 * radius * cosine * x1 + x2 +
            2 * radius * cosine * y1 - radius * radius * y2;
        impulse[index] = output;
        x2 = x1;
        x1 = input;
        y2 = y1;
        y1 = output;
    }
    return impulse;
}

function cascadedAllPass(sampleRate, frequency, radius, sections, length) {
    const impulse = new Float32Array(length);
    const cosine = Math.cos(2 * Math.PI * frequency / sampleRate);
    const states = Array.from({ length: sections }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
    for (let index = 0; index < impulse.length; index += 1) {
        let value = index === 0 ? 1 : 0;
        for (const state of states) {
            const output = radius * radius * value - 2 * radius * cosine * state.x1 +
                state.x2 + 2 * radius * cosine * state.y1 - radius * radius * state.y2;
            state.x2 = state.x1;
            state.x1 = value;
            state.y2 = state.y1;
            state.y1 = output;
            value = output;
        }
        impulse[index] = value;
    }
    return impulse;
}

function nearestIndex(values, target) {
    let nearest = 0;
    for (let index = 1; index < values.length; index += 1) {
        if (Math.abs(values[index] - target) < Math.abs(values[nearest] - target)) {
            nearest = index;
        }
    }
    return nearest;
}

function firstOrderAllPass(coefficient, onset, length) {
    const impulse = new Float32Array(length);
    impulse[onset] = coefficient;
    for (let index = 1; onset + index < length; index += 1) {
        impulse[onset + index] = (1 - coefficient * coefficient) *
            (-coefficient) ** (index - 1);
    }
    return impulse;
}

test('Room EQ independently resolves group delay beyond the adjacent-bin unwrap limit', () => {
    const sampleRate = 96000;
    const fftSize = 65536;
    const delaySamples = 40001;
    const impulse = new Float32Array(fftSize);
    impulse[delaySamples] = 1;
    const pipeline = deriveFrequencyResponse(impulse, sampleRate, {
        fftSize,
        maximumPoints: 2048
    });
    const point = nearestIndex(pipeline.frequencies, 20);
    const frequency = pipeline.frequencies[point];
    const room = analyzeRoomEqGroupDelay(
        impulse,
        0,
        sampleRate,
        new Float64Array([frequency]),
        { minimumFftSize: fftSize }
    );

    assert.equal(room.valid[0], 1);
    assert.ok(room.excessMs[0] > 400, `${room.excessMs[0]} ms`);
    assert.ok(Math.abs(room.excessMs[0] - pipeline.excessGroupDelayMs[point]) < 0.01);
    const adjacentBinPhaseChange = room.totalMs[0] / 1000 *
        2 * Math.PI * sampleRate / fftSize;
    assert.ok(adjacentBinPhaseChange > Math.PI);
});

test('Room EQ group delay is stable across zero-padding FFT sizes', () => {
    const sampleRate = 96000;
    const impulse = secondOrderAllPass(sampleRate, 20, 0.99995, 262144);
    const frequency = 20.1416015625;
    const first = analyzeRoomEqGroupDelay(
        impulse,
        0,
        sampleRate,
        new Float64Array([frequency]),
        { minimumFftSize: 524288 }
    );
    const second = analyzeRoomEqGroupDelay(
        impulse,
        0,
        sampleRate,
        new Float64Array([frequency]),
        { minimumFftSize: 2097152 }
    );
    assert.ok(Math.abs(first.totalMs[0] - second.totalMs[0]) < 1e-6);
    assert.ok(Math.abs(first.minimumMs[0] - second.minimumMs[0]) < 0.001);
});

test('magnitude-only minimum delay uses the same padded cepstral factorization', () => {
    const sampleRate = 48000;
    const fftSize = 8192;
    const impulse = new Float64Array(fftSize);
    for (let index = 0; index < impulse.length; index += 1) {
        impulse[index] = 0.1 * 0.9 ** index;
    }
    const spectrum = new FFT(fftSize).realTransform(impulse);
    const magnitudes = Float64Array.from(
        spectrum.real,
        (real, index) => Math.hypot(real, spectrum.imag[index])
    );
    const delays = minimumPhaseGroupDelaySecondsFromMagnitudes(
        magnitudes,
        sampleRate,
        fftSize
    );
    const bins = new Uint32Array([9, 85, 853, 2048]);
    const frequencies = Float64Array.from(bins, bin => bin * sampleRate / fftSize);
    const analysis = analyzeRoomEqGroupDelay(impulse, 0, sampleRate, frequencies);
    for (let index = 0; index < bins.length; index += 1) {
        const difference = Math.abs(delays[bins[index]] - analysis.minimumMs[index] / 1000);
        assert.ok(difference < 2e-6, `${frequencies[index]} Hz: ${difference} s`);
    }
});

test('Room EQ decomposes basic responses and removes explicit time origins', () => {
    const sampleRate = 48000;
    const frequencies = new Float64Array([100, 1000, 5000]);
    const impulse = new Float32Array(4096);
    impulse[317] = 1;
    const delayed = analyzeRoomEqGroupDelay(impulse, 0, sampleRate, frequencies);
    const aligned = analyzeRoomEqGroupDelay(impulse, 317, sampleRate, frequencies);
    for (let index = 0; index < frequencies.length; index += 1) {
        assert.ok(Math.abs(delayed.totalMs[index] - 317 / sampleRate * 1000) < 1e-6);
        assert.ok(Math.abs(aligned.totalMs[index]) < 1e-6);
        assert.ok(Math.abs(
            aligned.totalMs[index] - aligned.minimumMs[index] - aligned.excessMs[index]
        ) < 1e-9);
    }

    const minimumPhase = new Float32Array(4096);
    for (let index = 0; index < minimumPhase.length; index += 1) {
        minimumPhase[index] = 0.2 ** index;
    }
    const minimumAnalysis = analyzeRoomEqGroupDelay(
        minimumPhase,
        0,
        sampleRate,
        frequencies
    );
    for (const excess of minimumAnalysis.excessMs) assert.ok(Math.abs(excess) < 1e-5);

    const allPass = secondOrderAllPass(sampleRate, 1000, 0.9, 4096);
    const allPassAnalysis = analyzeRoomEqGroupDelay(allPass, 0, sampleRate, frequencies);
    assert.ok(Math.abs(allPassAnalysis.minimumMs[1]) < 1e-4);
    assert.ok(allPassAnalysis.excessMs[1] > 0.1);
});

test('negative referenced Excess values do not imply a noncausal raw response', () => {
    const sampleRate = 48000;
    const frequencies = new Float64Array([100, 1000, 10000]);
    const allPass = firstOrderAllPass(-0.72, 0, 4096);
    const raw = analyzeRoomEqGroupDelay(allPass, 0, sampleRate, frequencies);
    for (const value of raw.excessMs) assert.ok(value >= -1e-6, `${value} ms raw`);
    const referenced = smoothAndReferenceRoomEqGroupDelay(raw, frequencies, 0.02);
    assert.ok(Math.abs(referenced.excess[1]) < 1e-6);
    assert.ok(referenced.excess[2] < 0);
});

test('substantial pre-onset energy remains visible as negative onset-relative Excess', () => {
    const sampleRate = 48000;
    const fftSize = 65536;
    const onset = 4800;
    const impulse = new Float32Array(fftSize);
    impulse[0] = 0.4;
    impulse[onset] = 1;
    const pipeline = deriveFrequencyResponse(impulse, sampleRate, {
        fftSize,
        timeOriginSamples: -onset,
        maximumPoints: 512
    });
    const room = analyzeRoomEqGroupDelay(
        impulse,
        onset,
        sampleRate,
        Float64Array.from(pipeline.frequencies),
        { minimumFftSize: fftSize }
    );
    let minimum = 0;
    for (let index = 0; index < pipeline.frequencies.length; index += 1) {
        if (!room.valid[index] || !pipeline.valid[index]) continue;
        if (room.excessMs[index] < minimum) minimum = room.excessMs[index];
    }
    assert.ok(minimum < -10, `${minimum} ms`);
});

test('cepstral padding keeps a causal room tail nonnegative after display smoothing', () => {
    const sampleRate = 48000;
    const onset = 1024;
    const impulse = new Float32Array(32768);
    impulse[onset] = 1;
    let random = 1;
    for (let index = onset + 1; index < impulse.length; index += 1) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        impulse[index] = (random / 0x100000000 * 2 - 1) * 0.04 *
            Math.exp(-(index - onset) / (sampleRate * 0.12));
    }
    const frequencies = Float64Array.from({ length: 800 }, (_, index) =>
        20 * 1000 ** (index / 799));
    const analysis = analyzeRoomEqGroupDelay(impulse, onset, sampleRate, frequencies);
    assert.ok(analysis.fftSize >= impulse.length * 4);
    const display = smoothRoomEqGroupDelay(analysis, frequencies, 0.3);
    for (let index = 0; index < frequencies.length; index += 1) {
        if (!display.valid[index]) continue;
        assert.ok(display.excess[index] >= -0.05,
            `${frequencies[index]} Hz: ${display.excess[index]} ms`);
    }
});

test('Room EQ invalidates spectral zeros without spreading them through smoothing', () => {
    const sampleRate = 48000;
    const impulse = new Float32Array(4096);
    impulse[0] = 1;
    impulse[32] = -1;
    const notchFrequency = 128 * sampleRate / 4096;
    const frequencies = new Float64Array([
        notchFrequency - sampleRate / 4096,
        notchFrequency,
        notchFrequency + sampleRate / 4096,
        2000
    ]);
    const analysis = analyzeRoomEqGroupDelay(impulse, 0, sampleRate, frequencies);
    assert.equal(analysis.valid[1], 0);
    const display = smoothRoomEqGroupDelay(analysis, frequencies, 0.3);
    assert.ok(Number.isNaN(display.total[1]));
    assert.ok(Number.isFinite(display.total[0]));
    assert.ok(Number.isFinite(display.total[2]));
});

test('Room EQ and Pipeline Analyzer remain independent but agree on absolute delay', () => {
    const sampleRate = 48000;
    const impulse = new Float32Array(8192);
    impulse[256] = 1;
    impulse[319] = -0.35;
    const filter = secondOrderAllPass(sampleRate, 700, 0.75, 1024);
    const fftSize = 16384;
    const pipelineBefore = deriveFrequencyResponse(impulse, sampleRate, {
        fftSize,
        timeOriginSamples: -256,
        maximumPoints: 512
    });
    const frequencies = Float64Array.from(pipelineBefore.frequencies);
    const before = analyzeRoomEqGroupDelay(impulse, 256, sampleRate, frequencies, {
        minimumFftSize: fftSize
    });
    const filterAnalysis = analyzeRoomEqGroupDelay(filter, 0, sampleRate, frequencies, {
        minimumFftSize: fftSize
    });
    const roomAfter = combineRoomEqGroupDelay(before, filterAnalysis);
    const pipelineFilter = deriveFrequencyResponse(filter, sampleRate, {
        fftSize,
        maximumPoints: 512
    });
    const pipelineAfter = {
        valid: Uint8Array.from(before.valid, (value, index) =>
            value && pipelineFilter.valid[index] ? 1 : 0),
        totalMs: Float64Array.from(pipelineBefore.groupDelayMs, (value, index) =>
            value + pipelineFilter.groupDelayMs[index]),
        minimumMs: Float64Array.from(
            pipelineBefore.minimumGroupDelayMs,
            (value, index) => value + pipelineFilter.minimumGroupDelayMs[index]
        )
    };
    pipelineAfter.excessMs = Float64Array.from(
        pipelineAfter.totalMs,
        (value, index) => value - pipelineAfter.minimumMs[index]
    );
    const roomDisplay = smoothRoomEqGroupDelay(roomAfter, frequencies, 0.3);
    const pipelineDisplay = smoothRoomEqGroupDelay(
        pipelineAfter,
        frequencies,
        0.3
    );
    for (let index = 0; index < frequencies.length; index += 1) {
        if (!roomDisplay.valid[index] || !pipelineDisplay.valid[index]) continue;
        assert.ok(Math.abs(roomDisplay.total[index] - pipelineDisplay.total[index]) < 0.002);
        assert.ok(Math.abs(roomDisplay.minimum[index] - pipelineDisplay.minimum[index]) < 0.002);
        assert.ok(Math.abs(roomDisplay.excess[index] - pipelineDisplay.excess[index]) < 0.002);
    }
});

test('Room EQ leaves an explicit residual and diagnostic when the FIR window is insufficient', () => {
    const sampleRate = 96000;
    const impulse = cascadedAllPass(sampleRate, 20, 0.9996, 12, 262144);
    const result = designRoomEq({
        config: {
            sampleRate,
            taps: 8192,
            phase: 'full',
            smoothing: 0.3,
            phaseSmoothing: 0.3,
            directWindowMs: 6,
            lowFrequency: 20,
            lowFrequencyPhaseExtension: true
        },
        sources: [{
            measurement: { id: 'unrealizable-group-delay' },
            impulses: [{ data: impulse, sampleRate, onsetIndex: 0, pointId: 0 }]
        }]
    });
    const preview = result.previews[0];
    const point = nearestIndex(preview.frequencies, 20);
    assert.ok(preview.groupDelayResponse.excess.before[point] > 400);
    assert.ok(preview.groupDelayResponse.excess.after[point] > 300);
    assert.equal(result.diagnostics.phaseCorrection[0].state, 'reduced');
    assert.equal(result.diagnostics.phaseCorrection[0].reason, 'firWindow');
    assert.ok(result.diagnostics.phaseCorrection[0].residualMaximumMs > 300);
});

test('Room EQ corrects realizable delay and its After curve matches Pipeline Analyzer', () => {
    const sampleRate = 48000;
    const onset = 128;
    const impulse = firstOrderAllPass(0.72, onset, 4096);
    const result = designRoomEq({
        config: {
            sampleRate,
            taps: 8192,
            phase: 'full',
            smoothing: 0.05,
            phaseSmoothing: 0.05,
            directWindowMs: 6,
            lowFrequency: 20,
            highFrequency: 16000
        },
        sources: [{
            measurement: { id: 'realizable-group-delay' },
            impulses: [{ data: impulse, sampleRate, onsetIndex: onset, pointId: 0 }]
        }]
    });
    const preview = result.previews[0];
    const referencePoint = nearestIndex(preview.frequencies, 1000);
    const beforeReference = preview.groupDelayResponse.excess.before[referencePoint];
    const afterReference = preview.groupDelayResponse.excess.after[referencePoint];
    let beforeSquared = 0;
    let afterSquared = 0;
    let count = 0;
    for (let index = 0; index < preview.frequencies.length; index += 1) {
        if (preview.frequencies[index] < 800 || preview.frequencies[index] > 12000) continue;
        beforeSquared += (
            preview.groupDelayResponse.excess.before[index] - beforeReference
        ) ** 2;
        afterSquared += (
            preview.groupDelayResponse.excess.after[index] - afterReference
        ) ** 2;
        count += 1;
    }
    assert.ok(Math.sqrt(afterSquared / count) < Math.sqrt(beforeSquared / count) * 0.2);

    const fftSize = 16384;
    const pipelineBefore = deriveFrequencyResponse(impulse, sampleRate, {
        fftSize,
        timeOriginSamples: -onset,
        maximumPoints: 2048
    });
    const pipelineFilter = deriveFrequencyResponse(result.channels[0], sampleRate, {
        fftSize,
        timeOriginSamples: -result.channels[0].length / 2,
        maximumPoints: 2048
    });
    const pipelineAfter = {
        valid: Uint8Array.from(pipelineBefore.valid, (value, index) =>
            value && pipelineFilter.valid[index] ? 1 : 0),
        totalMs: Float64Array.from(pipelineBefore.groupDelayMs, (value, index) =>
            value + pipelineFilter.groupDelayMs[index]),
        minimumMs: Float64Array.from(
            pipelineBefore.minimumGroupDelayMs,
            (value, index) => value + pipelineFilter.minimumGroupDelayMs[index]
        )
    };
    pipelineAfter.excessMs = Float64Array.from(
        pipelineAfter.totalMs,
        (value, index) => value - pipelineAfter.minimumMs[index]
    );
    const pipelineDisplay = smoothRoomEqGroupDelay(
        pipelineAfter,
        pipelineBefore.frequencies,
        0.05
    );
    for (const frequency of [100, 300, 1000, 3000, 10000]) {
        const roomPoint = nearestIndex(preview.frequencies, frequency);
        const pipelinePoint = nearestIndex(pipelineBefore.frequencies, frequency);
        assert.ok(Math.abs(
            preview.groupDelayResponse.excess.after[roomPoint] -
            pipelineDisplay.excess[pipelinePoint]
        ) < 0.08, `${frequency} Hz`);
    }
});
