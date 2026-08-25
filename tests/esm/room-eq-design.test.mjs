import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import FFT from '../../js/utils/measurement-dsp/fft.js';
import { createConsoleHarness, withGlobals } from '../helpers/global-test-utils.mjs';
import {
    interpolateLogResponse,
    smoothFrequencyResponse
} from '../../js/utils/measurement-dsp/smoothing.js';
import {
    clearRoomEqAnalysisCache,
    clearRoomEqDesignCache,
    designRoomEq,
    setRoomEqFftBackend,
    softLimitBoost
} from '../../js/room-eq/design-core.js';
import { analyzeRoomEqGroupDelay } from '../../js/room-eq/group-delay-analysis.js';
import {
    IR_ASSET_MAGIC,
    IR_ASSET_TOPOLOGY
} from '../../js/ir-library/ir-asset-payload.js';

function spectrumFor(taps, fftSize = taps.length * 2) {
    const input = new Float64Array(fftSize);
    input.set(taps);
    return new FFT(input.length).realTransform(input);
}

function maximumMagnitudeDifferenceDb(
    first,
    second,
    fftSize,
    sampleRate,
    lowFrequency = 20,
    highFrequency = 20000
) {
    const firstSpectrum = spectrumFor(first, fftSize);
    const secondSpectrum = spectrumFor(second, fftSize);
    let maximum = 0;
    let frequencyAtMaximum = 0;
    for (let bin = 1; bin < firstSpectrum.real.length; bin += 1) {
        const frequency = bin * sampleRate / fftSize;
        if (frequency < lowFrequency || frequency > highFrequency) continue;
        const firstMagnitude = Math.hypot(firstSpectrum.real[bin], firstSpectrum.imag[bin]);
        const secondMagnitude = Math.hypot(secondSpectrum.real[bin], secondSpectrum.imag[bin]);
        if (firstMagnitude < 1e-8 || secondMagnitude < 1e-8) continue;
        const difference = Math.abs(20 * Math.log10(secondMagnitude / firstMagnitude));
        if (difference > maximum) {
            maximum = difference;
            frequencyAtMaximum = frequency;
        }
    }
    return { maximum, frequencyAtMaximum };
}

function wrapPhase(phase) {
    let wrapped = phase;
    while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
    while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
    return wrapped;
}

function unwrapPhases(phases) {
    const result = Float64Array.from(phases);
    for (let index = 1; index < result.length; index += 1) {
        let difference = result[index] - result[index - 1];
        while (difference > Math.PI) {
            result[index] -= 2 * Math.PI;
            difference -= 2 * Math.PI;
        }
        while (difference < -Math.PI) {
            result[index] += 2 * Math.PI;
            difference += 2 * Math.PI;
        }
    }
    return result;
}

function linearPhaseResidualRms(spectrum, sampleRate, lowFrequency, highFrequency) {
    const points = [];
    let offset = 0;
    let previous = 0;
    for (let bin = 1; bin < spectrum.real.length; bin += 1) {
        const frequency = bin * sampleRate / ((spectrum.real.length - 1) * 2);
        if (frequency < lowFrequency || frequency > highFrequency) continue;
        let phase = Math.atan2(spectrum.imag[bin], spectrum.real[bin]);
        if (points.length) {
            const difference = phase + offset - previous;
            if (difference > Math.PI) offset -= 2 * Math.PI;
            else if (difference < -Math.PI) offset += 2 * Math.PI;
        }
        phase += offset;
        previous = phase;
        points.push([2 * Math.PI * frequency, phase]);
    }
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (const [x, y] of points) {
        sumX += x;
        sumY += y;
        sumXX += x * x;
        sumXY += x * y;
    }
    const count = points.length;
    const denominator = count * sumXX - sumX * sumX;
    const slope = (count * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / count;
    let squaredError = 0;
    for (const [x, y] of points) squaredError += (y - intercept - slope * x) ** 2;
    return Math.sqrt(squaredError / count);
}

function dominantSampleIndex(samples) {
    let peak = 0;
    for (let index = 1; index < samples.length; index += 1) {
        if (Math.abs(samples[index]) > Math.abs(samples[peak])) peak = index;
    }
    return peak;
}

function flatLegacyMeasurement() {
    return {
        id: 'legacy-flat',
        averageFrequencyResponse: [[20, 0], [100, 0], [1000, 0], [10000, 0], [20000, 0]]
    };
}

function nearestFrequencyIndex(frequencies, target) {
    let nearest = 0;
    for (let index = 1; index < frequencies.length; index += 1) {
        if (Math.abs(frequencies[index] - target) <
            Math.abs(frequencies[nearest] - target)) nearest = index;
    }
    return nearest;
}

test('inversion boost limiter has exact identity and clamp regions around its 1 dB knee', () => {
    const maximum = 6;
    assert.equal(softLimitBoost(5, maximum), 5);
    assert.equal(softLimitBoost(4.5, maximum), 4.5);
    assert.equal(softLimitBoost(6, maximum), 6);
    assert.equal(softLimitBoost(7, maximum), 6);
    const middle = softLimitBoost(5.5, maximum);
    assert.ok(middle > 5.5 && middle < 6);
    assert.ok(softLimitBoost(5.25, maximum) < middle);
    assert.ok(softLimitBoost(5.75, maximum) > middle);
});

test('Room EQ design accepts Max Boost through 18 dB and caps higher settings', () => {
    const measurement = {
        id: 'maximum-boost-fixture',
        averageFrequencyResponse: [[20, 0], [100, -40], [10000, -40], [20000, 0]]
    };
    const maximumCorrection = maxBoostDb => Math.max(...designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'lin',
            smoothing: 0.02,
            maxBoostDb
        },
        sources: [{ measurement, impulses: [] }]
    }).previews[0].baseCorrectionDb);

    assert.equal(maximumCorrection(18), 18);
    assert.equal(maximumCorrection(30), 18);
});

test('magnitude correction clips and zero-pads its range before smoothing sets the boundary tails', () => {
    const measurement = {
        id: 'correction-boundary-fixture',
        averageFrequencyResponse: [
            [20, 0],
            [1000, -12],
            [2000, -12],
            [4000, 0],
            [8000, -12],
            [20000, 0]
        ]
    };
    const design = smoothing => designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'min',
            smoothing,
            lowFrequency: 1000,
            highFrequency: 8000,
            maxBoostDb: 3
        },
        sources: [{ measurement, impulses: [] }]
    }).previews[0];
    const narrow = design(0.05);
    const broad = design(0.5);
    const rawMeasured = interpolateLogResponse(
        measurement.averageFrequencyResponse,
        Array.from(broad.frequencies)
    );
    const paddedInversion = Array.from(broad.frequencies, (frequency, index) => [
        frequency,
        frequency > 1000 && frequency < 8000
            ? softLimitBoost(broad.targetDb[index] - rawMeasured[index][1], 3)
            : 0
    ]);
    assert.ok(paddedInversion.some(([, correction]) => correction === 3));
    const expected = smoothFrequencyResponse(paddedInversion, 0.5);
    for (const frequency of [500, 1000, 2000, 8000, 12000]) {
        const index = nearestFrequencyIndex(broad.frequencies, frequency);
        assert.ok(Math.abs(
            broad.baseCorrectionDb[index] - expected[index][1]
        ) < 0.002);
    }
    const lowTail = nearestFrequencyIndex(broad.frequencies, 500);
    const highTail = nearestFrequencyIndex(broad.frequencies, 12000);
    assert.ok(Math.abs(broad.baseCorrectionDb[lowTail]) >
        Math.abs(narrow.baseCorrectionDb[lowTail]) + 0.05);
    assert.ok(Math.abs(broad.baseCorrectionDb[highTail]) >
        Math.abs(narrow.baseCorrectionDb[highTail]) + 0.05);
    assert.ok(Math.max(...broad.baseCorrectionDb) <= 3);
});

test('correction amount scales automatic correction in dB without scaling Additional EQ', () => {
    const measurement = {
        id: 'correction-amount-fixture',
        averageFrequencyResponse: [[20, 0], [1000, -12], [20000, 0]]
    };
    const design = correctionAmount => designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'lin',
            smoothing: 0.05,
            maxBoostDb: 12,
            correctionAmount,
            eqBands: [{ enabled: true, type: 'pk', frequency: 1000, gain: 4, q: 1 }]
        },
        sources: [{ measurement, impulses: [] }]
    }).previews[0];
    const full = design(1);
    const half = design(0.5);
    const none = design(0);
    const index = nearestFrequencyIndex(full.frequencies, 1000);

    assert.ok(full.baseCorrectionDb[index] > 1);
    assert.ok(Math.abs(half.baseCorrectionDb[index] - full.baseCorrectionDb[index] * 0.5) < 0.001);
    assert.ok(Math.abs(none.baseCorrectionDb[index]) < 0.001);
    // Differencing the predictions cancels the measurement and the Additional EQ that all
    // three share, leaving only the automatic correction, which must scale with the amount.
    assert.ok(Math.abs((full.predictedDb[index] - none.predictedDb[index]) -
        2 * (half.predictedDb[index] - none.predictedDb[index])) < 0.001);
    assert.ok(half.predictedDb[index] - none.predictedDb[index] > 0.5);
});

test('corrected prediction keeps residue the smoothed correction cannot reach', () => {
    const sampleRate = 48000;
    const onsetIndex = 64;
    const length = 16384;
    // A narrow +10 dB resonance: far narrower than the 0.17 oct design smoothing, so the
    // correction cannot remove it and the prediction has to keep showing it.
    const samples = new Float64Array(length);
    samples[onsetIndex] = 1;
    const w0 = 2 * Math.PI * 120 / sampleRate;
    const a = 10 ** (10 / 40);
    const alpha = Math.sin(w0) / (2 * 8);
    const a0 = 1 + alpha / a;
    const feedForward = [(1 + alpha * a) / a0, -2 * Math.cos(w0) / a0, (1 - alpha * a) / a0];
    const feedBack = [1, -2 * Math.cos(w0) / a0, (1 - alpha / a) / a0];
    let firstInput = 0;
    let secondInput = 0;
    let firstOutput = 0;
    let secondOutput = 0;
    for (let index = 0; index < length; index += 1) {
        const input = samples[index];
        const output = feedForward[0] * input + feedForward[1] * firstInput +
            feedForward[2] * secondInput - feedBack[1] * firstOutput - feedBack[2] * secondOutput;
        secondInput = firstInput;
        firstInput = input;
        secondOutput = firstOutput;
        firstOutput = output;
        samples[index] = output;
    }
    const preview = designRoomEq({
        config: {
            sampleRate,
            taps: 8192,
            phase: 'full',
            smoothing: 0.17,
            lowFrequency: 20,
            highFrequency: 16000,
            maxBoostDb: 6,
            correctionAmount: 1,
            eqBands: []
        },
        sources: [{
            measurement: { id: 'residue-fixture' },
            impulses: [{
                data: Float32Array.from(samples),
                sampleRate,
                onsetIndex,
                refScale: 1,
                pointId: 0
            }]
        }]
    }).previews[0];
    const index = nearestFrequencyIndex(preview.frequencies, 120);
    assert.ok(preview.measuredDb[index] - preview.referenceLevelDb > 3);
    // The old prediction added the correction back to the same smoothed curve it came
    // from, which always landed on the target. A real residue has to survive.
    assert.ok(preview.predictedDb[index] - preview.targetDb[index] > 0.3);
    // Away from the resonance the correction still reaches the target.
    const settled = nearestFrequencyIndex(preview.frequencies, 1000);
    assert.ok(Math.abs(preview.predictedDb[settled] - preview.targetDb[settled]) < 0.2);
});

test('legacy magnitude design emits finite minimum-phase taps with no leading taper', () => {
    const result = designRoomEq({
        config: { sampleRate: 48000, taps: 8192, phase: 'min', smoothing: 0.17 },
        sources: [{ measurement: flatLegacyMeasurement(), impulses: [] }]
    });
    assert.equal(result.channels[0].length, 8192);
    assert.ok(result.channels[0].every(Number.isFinite));
    assert.ok(Math.abs(result.channels[0][0]) > 0.9);
    assert.equal(result.previews[0].referenceLevelDb, 0);
    assert.equal(result.latencyInfo.filterDelaySamples, 0);
    assert.equal(result.supportsFullPhase, false);
});

test('quality warnings use translatable codes instead of channel-specific UI text', () => {
    const result = designRoomEq({
        config: { sampleRate: 48000, taps: 8192, phase: 'full', smoothing: 0.17 },
        sources: [{ measurement: flatLegacyMeasurement(), impulses: [] }]
    });
    assert.deepEqual(result.qualityWarnings, ['impulseResponseRequired']);
});

test('linear design centers the FIR and keeps intentional EQ outside the inversion boost cap', () => {
    const result = designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'lin',
            smoothing: 0.17,
            maxBoostDb: 0,
            eqBands: [{ enabled: true, type: 'pk', frequency: 1000, gain: 10, q: 1 }]
        },
        sources: [{ measurement: flatLegacyMeasurement(), impulses: [] }]
    });
    const preview = result.previews[0];
    let nearest = 0;
    for (let index = 1; index < preview.frequencies.length; index += 1) {
        if (Math.abs(preview.frequencies[index] - 1000) <
            Math.abs(preview.frequencies[nearest] - 1000)) nearest = index;
    }
    assert.ok(preview.predictedDb[nearest] > 9);
    assert.ok(Math.abs(preview.baseCorrectionDb[nearest]) < 0.05);
    assert.equal(result.latencyInfo.filterDelaySamples, 4096);
    assert.ok(Math.abs(result.channels[0][4096]) > Math.abs(result.channels[0][0]));
});

test('Additional EQ is zero-phase in linear mode and minimum-phase in minimum mode', () => {
    const config = {
        sampleRate: 48000,
        taps: 8192,
        smoothing: 0.17,
        eqBands: [{ enabled: true, type: 'pk', frequency: 1000, gain: 10, q: 1 }]
    };
    const source = [{ measurement: flatLegacyMeasurement(), impulses: [] }];
    const linear = spectrumFor(designRoomEq({
        config: { ...config, phase: 'lin' },
        sources: source
    }).channels[0]);
    const minimum = spectrumFor(designRoomEq({
        config: { ...config, phase: 'min' },
        sources: source
    }).channels[0]);
    const bin = Math.round(700 * 16384 / 48000);
    const bulkPhase = 2 * Math.PI * bin / 16384 * 4096;
    const linearIntrinsicPhase = wrapPhase(
        Math.atan2(linear.imag[bin], linear.real[bin]) + bulkPhase
    );
    const minimumPhase = Math.atan2(minimum.imag[bin], minimum.real[bin]);
    assert.ok(Math.abs(linearIntrinsicPhase) < 0.001);
    assert.ok(Math.abs(minimumPhase) > 0.2);
});

test('IR-backed direct-phase design is available and finite', () => {
    const impulse = new Float32Array(4096);
    impulse[128] = 1;
    impulse[180] = 0.2;
    const result = designRoomEq({
        config: { sampleRate: 48000, taps: 8192, phase: 'full', directWindowMs: 6 },
        sources: [{
            measurement: flatLegacyMeasurement(),
            impulses: [{ sampleRate: 48000, onsetIndex: 128, data: impulse }]
        }]
    });
    assert.equal(result.supportsFullPhase, true);
    assert.ok(result.channels[0].every(Number.isFinite));
    assert.equal(result.qualityWarnings.length, 0);
});

test('IR preview spans from 2 ms before onset through at least 5 ms', () => {
    const impulse = new Float32Array(10000);
    const onset = 512;
    impulse[onset] = 1;
    impulse[onset + 53] = -0.2;
    const measurement = {
        id: 'impulse-preview-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    const source = [{
        measurement,
        impulses: [{
            measurementId: measurement.id,
            pointId: 1,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data: impulse
        }]
    }];

    for (const phase of ['min', 'lin']) {
        const result = designRoomEq({
            config: {
                sampleRate: 48000,
                taps: 8192,
                phase,
                directWindowMs: 6,
                correctionAmount: 0
            },
            sources: source
        });
        const preview = result.previews[0].impulseResponse;
        assert.equal(preview.sampleRate, 48000);
        assert.equal(preview.startMs, -2);
        assert.equal(preview.durationMs, 6);
        assert.equal(preview.before.length, 384);
        assert.equal(preview.after.length, preview.before.length);
        let maximumDifference = 0;
        for (let index = 0; index < preview.before.length; index += 1) {
            const difference = Math.abs(preview.before[index] - preview.after[index]);
            if (difference > maximumDifference) maximumDifference = difference;
        }
        assert.ok(maximumDifference < 1e-6, `${phase}: ${maximumDifference}`);
    }

    const shortWindowPreview = designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'lin',
            directWindowMs: 1,
            correctionAmount: 0
        },
        sources: source
    }).previews[0].impulseResponse;
    assert.equal(shortWindowPreview.startMs, -2);
    assert.equal(shortWindowPreview.durationMs, 5);
    assert.equal(shortWindowPreview.before.length, 336);
});

test('phase preview removes measurement onset and known FIR delay', () => {
    const impulse = new Float32Array(10000);
    const onset = 512;
    impulse[onset] = 1;
    const measurement = {
        id: 'phase-preview-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    const sources = [{
        measurement,
        impulses: [{
            measurementId: measurement.id,
            pointId: 1,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data: impulse
        }]
    }];

    for (const phase of ['min', 'lin']) {
        const preview = designRoomEq({
            config: {
                sampleRate: 48000,
                taps: 8192,
                phase,
                correctionAmount: 0
            },
            sources
        }).previews[0];
        assert.equal(preview.phaseResponse.before.length, preview.frequencies.length);
        assert.equal(preview.phaseResponse.after.length, preview.frequencies.length);
        for (const values of [
            preview.phaseResponse.before,
            preview.phaseResponse.after
        ]) {
            let maximum = 0;
            for (const value of values) {
                const magnitude = Math.abs(value);
                if (magnitude > maximum) maximum = magnitude;
            }
            assert.ok(maximum < 0.01, `${phase}: maximum phase was ${maximum}°`);
        }
    }
});

test('group delay preview follows the measured absolute onset-relative slope', () => {
    // A single 1 ms echo makes group delay swing between its 1 kHz value and a
    // deep negative excursion halfway between the comb peaks.
    const impulse = new Float32Array(10000);
    const onset = 512;
    impulse[onset] = 1;
    impulse[onset + 48] = 0.5;
    const measurement = {
        id: 'group-delay-preview-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    const sources = [{
        measurement,
        impulses: [{
            measurementId: measurement.id,
            pointId: 1,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data: impulse
        }]
    }];

    const design = smoothing => designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'lin',
            correctionAmount: 0,
            smoothing
        },
        sources
    }).previews[0];
    const preview = design(0.02);

    const { before, after } = preview.groupDelayResponse;
    assert.equal(before.length, preview.frequencies.length);
    assert.equal(after.length, preview.frequencies.length);
    for (const component of ['minimum', 'excess']) {
        assert.equal(
            preview.groupDelayResponse[component].before.length,
            preview.frequencies.length
        );
        assert.equal(
            preview.groupDelayResponse[component].after.length,
            preview.frequencies.length
        );
    }
    const nearest = frequency => {
        let best = 0;
        for (let index = 0; index < preview.frequencies.length; index += 1) {
            if (Math.abs(preview.frequencies[index] - frequency) <
                Math.abs(preview.frequencies[best] - frequency)) best = index;
        }
        return best;
    };
    assert.ok(Math.abs(before[nearest(1000)] - 1 / 3) < 0.01,
        `1 kHz delay was ${before[nearest(1000)]} ms`);
    assert.ok(Math.abs(before[nearest(2000)] - 1 / 3) < 0.01,
        `2 kHz comb peak was ${before[nearest(2000)]} ms`);
    // The comb null is -1 ms in absolute onset-relative delay;
    // any smoothing beyond the configured pass would blunt it.
    assert.ok(before[nearest(500)] < -0.95,
        `500 Hz comb null was ${before[nearest(500)]} ms`);
    for (let index = 0; index < before.length; index += 1) {
        const decomposedBefore = preview.groupDelayResponse.minimum.before[index] +
            preview.groupDelayResponse.excess.before[index];
        const decomposedAfter = preview.groupDelayResponse.minimum.after[index] +
            preview.groupDelayResponse.excess.after[index];
        assert.ok(Math.abs(before[index] - decomposedBefore) < 1e-4);
        assert.ok(Math.abs(after[index] - decomposedAfter) < 1e-4);
    }
    let maximumDifference = 0;
    for (let index = 0; index < before.length; index += 1) {
        const difference = Math.abs(before[index] - after[index]);
        if (difference > maximumDifference) maximumDifference = difference;
    }
    assert.ok(maximumDifference < 1e-3,
        `linear correction changed group delay by ${maximumDifference} ms`);

    const smoothed = design(0.5).groupDelayResponse.before;
    assert.ok(smoothed[nearest(500)] > -0.5,
        `Smoothing 0.5 oct left the null at ${smoothed[nearest(500)]} ms`);
});

test('IR preview removes frequencies above 20 kHz from before and after waveforms', () => {
    const sampleRate = 48000;
    const lowFrequency = 9000;
    const highFrequency = 22500;
    const onset = 8288;
    const impulse = new Float32Array(20000);
    for (let index = 0; index < impulse.length; index += 1) {
        impulse[index] = 0.25 * Math.sin(2 * Math.PI * lowFrequency * index / sampleRate) +
            Math.sin(2 * Math.PI * highFrequency * index / sampleRate);
    }
    const measurement = {
        id: 'band-limited-impulse-preview',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    const preview = designRoomEq({
        config: {
            sampleRate,
            taps: 8192,
            phase: 'min',
            directWindowMs: 5,
            correctionAmount: 0
        },
        sources: [{
            measurement,
            impulses: [{
                measurementId: measurement.id,
                pointId: 1,
                sampleRate,
                onsetIndex: onset,
                refScale: 1,
                data: impulse
            }]
        }]
    }).previews[0].impulseResponse;
    const firstSample = onset + Math.round(preview.startMs * sampleRate / 1000);

    for (const samples of [preview.before, preview.after]) {
        let maximumError = 0;
        for (let index = 0; index < samples.length; index += 1) {
            const expected = 0.25 * Math.sin(
                2 * Math.PI * lowFrequency * (firstSample + index) / sampleRate
            );
            const error = Math.abs(samples[index] - expected);
            if (error > maximumError) maximumError = error;
        }
        assert.ok(maximumError < 1e-5, `maximum preview error was ${maximumError}`);
    }
});

test('IR preview keeps before and after waveforms on the measured onset reference', () => {
    const impulse = new Float32Array(10000);
    const onset = 512;
    impulse[onset] = 1;
    const measurement = {
        id: 'independent-preview-onsets',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    const result = designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'lin',
            directWindowMs: 6,
            correctionAmount: 0,
            eqBands: [{
                enabled: true,
                type: 'pk',
                frequency: 1000,
                gain: 12,
                q: 1
            }]
        },
        sources: [{
            measurement,
            impulses: [{
                measurementId: measurement.id,
                pointId: 1,
                sampleRate: 48000,
                onsetIndex: onset,
                refScale: 1,
                data: impulse
            }]
        }]
    });
    const preview = result.previews[0].impulseResponse;
    const onsetSample = Math.round(-preview.startMs * preview.sampleRate / 1000);
    let correctedPeakIndex = 0;
    for (let index = 1; index < preview.after.length; index += 1) {
        if (Math.abs(preview.after[index]) > Math.abs(preview.after[correctedPeakIndex])) {
            correctedPeakIndex = index;
        }
    }
    assert.ok(Math.abs(correctedPeakIndex - onsetSample) <= 1);
    assert.ok(preview.after.subarray(0, onsetSample).some(value => Math.abs(value) > 1e-6));
});

test('full mode retains minimum-phase magnitude realization apart from timing alignment', () => {
    const impulse = new Float32Array(4096);
    impulse[128] = 1;
    impulse[180] = 0.2;
    const measurement = {
        id: 'minimum-phase-direct-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    const sources = [{
        measurement,
        impulses: [{
            measurementId: measurement.id,
            pointId: 1,
            sampleRate: 48000,
            onsetIndex: 128,
            refScale: 1,
            data: impulse
        }]
    }];
    const minimum = spectrumFor(designRoomEq({
        config: { sampleRate: 48000, taps: 8192, phase: 'min', directWindowMs: 6 },
        sources
    }).channels[0]);
    const fullResult = designRoomEq({
        config: { sampleRate: 48000, taps: 8192, phase: 'full', directWindowMs: 6 },
        sources
    });
    const full = spectrumFor(fullResult.channels[0]);
    const relative = {
        real: new Float64Array(full.real.length),
        imag: new Float64Array(full.imag.length)
    };
    for (let bin = 0; bin < full.real.length; bin += 1) {
        const denominator = minimum.real[bin] ** 2 + minimum.imag[bin] ** 2;
        relative.real[bin] = (
            full.real[bin] * minimum.real[bin] +
            full.imag[bin] * minimum.imag[bin]
        ) / denominator;
        relative.imag[bin] = (
            full.imag[bin] * minimum.real[bin] -
            full.real[bin] * minimum.imag[bin]
        ) / denominator;
    }
    assert.ok(linearPhaseResidualRms(relative, 48000, 800, 12000) < 0.01);
    assert.equal(fullResult.qualityWarnings.length, 0);
});

test('full mode flattens nonlinear direct-sound group delay', () => {
    const impulse = new Float32Array(4096);
    const onset = 128;
    const coefficient = 0.72;
    impulse[onset] = coefficient;
    for (let index = 1; index < 300; index += 1) {
        impulse[onset + index] = (1 - coefficient * coefficient) *
            (-coefficient) ** (index - 1);
    }
    const measurement = {
        id: 'all-pass-direct-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    const sources = [{
        measurement,
        impulses: [{
            measurementId: measurement.id,
            pointId: 1,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data: impulse
        }]
    }];
    const inputSpectrum = spectrumFor(impulse, 16384);
    const residuals = {};
    for (const phase of ['lin', 'full']) {
        const result = designRoomEq({
            config: {
                sampleRate: 48000,
                taps: 8192,
                phase,
                smoothing: 0.05,
                directWindowMs: 6
            },
            sources
        });
        const correction = spectrumFor(result.channels[0]);
        const corrected = {
            real: new Float64Array(correction.real.length),
            imag: new Float64Array(correction.imag.length)
        };
        for (let bin = 0; bin < corrected.real.length; bin += 1) {
            corrected.real[bin] = inputSpectrum.real[bin] * correction.real[bin] -
                inputSpectrum.imag[bin] * correction.imag[bin];
            corrected.imag[bin] = inputSpectrum.real[bin] * correction.imag[bin] +
                inputSpectrum.imag[bin] * correction.real[bin];
        }
        residuals[phase] = linearPhaseResidualRms(corrected, 48000, 800, 12000);
        assert.equal(result.qualityWarnings.length, 0);
    }
    assert.ok(residuals.full < residuals.lin * 0.1);
});

test('manual Phase Low overrides the automatic three-cycle boundary', () => {
    const impulse = new Float32Array(4096);
    const onset = 128;
    const coefficient = 0.72;
    impulse[onset] = coefficient;
    for (let index = 1; index < 600; index += 1) {
        impulse[onset + index] = (1 - coefficient * coefficient) *
            (-coefficient) ** (index - 1);
    }
    const measurement = {
        id: 'manual-phase-low-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    const sources = [{
        measurement,
        impulses: [{
            measurementId: measurement.id,
            pointId: 1,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data: impulse
        }]
    }];
    const design = phaseLowFrequency => designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'full',
            smoothing: 0.05,
            directWindowMs: 6,
            correctionAmount: 0,
            ...(phaseLowFrequency !== undefined && { phaseLowFrequency })
        },
        sources
    });
    const automatic = design();
    const manualEquivalent = design(500);
    const manualLower = design(200);
    const manualBelowWindowLimit = design(100);
    const manualAtWindowLimit = design(1000 / 6);

    assert.equal(automatic.config.phaseLowFrequency, null);
    assert.equal(manualEquivalent.config.phaseLowFrequency, 500);
    assert.deepEqual(manualEquivalent.channels[0], automatic.channels[0]);
    assert.ok(manualLower.channels[0].some((value, index) =>
        Math.abs(value - automatic.channels[0][index]) > 1e-6));
    assert.deepEqual(
        manualBelowWindowLimit.channels[0],
        manualAtWindowLimit.channels[0]
    );
});

test('full mode defaults and falls back to the multipoint excess-phase consensus', () => {
    const onset = 128;
    const flat = new Float32Array(4096);
    flat[onset] = 1;
    const allPass = new Float32Array(4096);
    const coefficient = 0.72;
    allPass[onset] = coefficient;
    for (let index = 1; index < 300; index += 1) {
        allPass[onset + index] = (1 - coefficient * coefficient) *
            (-coefficient) ** (index - 1);
    }
    const measurement = {
        id: 'phase-consensus-fallback',
        timestamp: 'fixed',
        points: [
            { pointId: 0, name: 'Center', timestamp: 'one' },
            { pointId: 5, name: 'Right', timestamp: 'two' }
        ],
        averageFrequencyResponse: []
    };
    const sources = [{
        measurement,
        impulses: [flat, allPass].map((data, index) => ({
            measurementId: measurement.id,
            pointId: index ? 5 : 0,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data
        }))
    }];
    const design = referencePoint => designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'full',
            smoothing: 0.05,
            directWindowMs: 6,
            ...(referencePoint !== undefined && { referencePoint })
        },
        sources
    });
    const consensus = design(0);
    const defaulted = design();
    const missingPoint = design(999);
    const center = design(1);
    const right = design(6);

    assert.deepEqual(defaulted.channels[0], consensus.channels[0]);
    assert.deepEqual(missingPoint.channels[0], consensus.channels[0]);
    assert.ok(consensus.channels[0].some((value, index) =>
        Math.abs(value - center.channels[0][index]) > 1e-6));
    assert.ok(consensus.channels[0].some((value, index) =>
        Math.abs(value - right.channels[0][index]) > 1e-6));
    const tapDistance = (left, rightChannel) => Math.sqrt(
        left.reduce((sum, value, index) => {
            const difference = value - rightChannel[index];
            return sum + difference * difference;
        }, 0)
    );
    assert.ok(
        tapDistance(consensus.channels[0], center.channels[0]) <
        tapDistance(right.channels[0], center.channels[0])
    );
});

test('multipoint excess-phase consensus preserves a phase feature shared by every point', () => {
    const onset = 128;
    const impulse = new Float32Array(4096);
    const coefficient = 0.72;
    impulse[onset] = coefficient;
    for (let index = 1; index < 300; index += 1) {
        impulse[onset + index] = (1 - coefficient * coefficient) *
            (-coefficient) ** (index - 1);
    }
    const measurement = {
        id: 'shared-phase-consensus',
        timestamp: 'fixed',
        points: [{ pointId: 0 }, { pointId: 1 }],
        averageFrequencyResponse: []
    };
    const sources = [{
        measurement,
        impulses: [0, 1].map(pointId => ({
            measurementId: measurement.id,
            pointId,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data: Float32Array.from(impulse)
        }))
    }];
    const design = referencePoint => designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'full',
            smoothing: 0.05,
            directWindowMs: 6,
            referencePoint
        },
        sources
    });

    const consensus = design(0).channels[0];
    const selected = design(1).channels[0];
    let maximumDifference = 0;
    for (let index = 0; index < consensus.length; index += 1) {
        maximumDifference = Math.max(
            maximumDifference,
            Math.abs(consensus[index] - selected[index])
        );
    }
    assert.ok(maximumDifference < 1e-4, `maximum tap difference was ${maximumDifference}`);
});

test('multipoint consensus remains realizable as Taps increase', () => {
    const sampleRate = 48000;
    const onsetIndex = 128;
    const coefficients = [0.98, -0.98];
    const measurement = {
        id: 'consensus-tap-monotonicity',
        timestamp: 'fixed',
        points: coefficients.map((_, pointId) => ({ pointId })),
        averageFrequencyResponse: []
    };
    const impulses = coefficients.map((coefficient, pointId) => {
        const data = new Float32Array(4096);
        data[onsetIndex] = coefficient;
        for (let index = 1; index < 1000; index += 1) {
            data[onsetIndex + index] = (1 - coefficient * coefficient) *
                (-coefficient) ** (index - 1);
        }
        return {
            measurementId: measurement.id,
            pointId,
            sampleRate,
            onsetIndex,
            refScale: 1,
            data
        };
    });

    for (const taps of [8192, 16384, 32768]) {
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
        const result = designRoomEq({
            config: {
                sampleRate,
                taps,
                phase: 'full',
                smoothing: 0.17,
                directWindowMs: 6,
                correctionAmount: 0,
                phaseCorrectionAmount: 1,
                referencePoint: 0
            },
            sources: [{ measurement, impulses }]
        });
        assert.deepEqual(result.qualityWarnings, [], `${taps} taps`);
    }
});

test('full correction keeps each channel main impulse aligned across amount controls', () => {
    const sampleRate = 48000;
    const taps = 8192;
    const onset = 512;
    const directWindowMs = 10;
    const fixtures = [
        [[0, 1], [37, 0.55], [121, -0.28], [238, 0.12]],
        [[0, 1], [19, -0.48], [94, 0.34], [207, -0.16]]
    ];
    for (let channel = 0; channel < fixtures.length; channel += 1) {
        const impulse = new Float32Array(10000);
        for (const [offset, value] of fixtures[channel]) impulse[onset + offset] = value;
        const measurement = {
            id: `independent-timing-fixture-${channel}`,
            timestamp: 'fixed',
            points: [{ pointId: 1, timestamp: 'fixed' }],
            averageFrequencyResponse: []
        };
        const sources = [{
            measurement,
            impulses: [{
                measurementId: measurement.id,
                pointId: 1,
                sampleRate,
                onsetIndex: onset,
                refScale: 1,
                data: impulse
            }]
        }];
        for (const correctionAmount of [0, 0.5, 1]) {
            const minimum = designRoomEq({
                config: {
                    sampleRate,
                    taps,
                    phase: 'min',
                    smoothing: 0.05,
                    directWindowMs,
                    correctionAmount
                },
                sources
            });
            const minimumPreview = minimum.previews[0].impulseResponse;
            const referencePeak = dominantSampleIndex(minimumPreview.after);
            assert.ok(
                Math.abs(referencePeak - dominantSampleIndex(minimumPreview.before)) <= 1,
                `channel ${channel + 1} Minimum moved at ` +
                    `Level Correction ${correctionAmount}`
            );
            for (const phaseCorrectionAmount of [0, 0.5, 1]) {
                const result = designRoomEq({
                    config: {
                        sampleRate,
                        taps,
                        phase: 'full',
                        smoothing: 0.05,
                        directWindowMs,
                        correctionAmount,
                        phaseCorrectionAmount
                    },
                    sources
                });
                const correctedPeak = dominantSampleIndex(
                    result.previews[0].impulseResponse.after
                );
                assert.ok(
                    Math.abs(correctedPeak - referencePeak) <= 1,
                    `channel ${channel + 1} Correction moved at ` +
                        `Level ${correctionAmount}, Phase ${phaseCorrectionAmount}`
                );
                assert.equal(result.qualityWarnings.length, 0);
            }
        }
    }
});

test('level and measured phase correction amounts are independent', () => {
    const impulse = new Float32Array(4096);
    const onset = 128;
    const coefficient = 0.72;
    impulse[onset] = coefficient;
    for (let index = 1; index < 300; index += 1) {
        impulse[onset + index] = (1 - coefficient * coefficient) *
            (-coefficient) ** (index - 1);
    }
    const measurement = {
        id: 'zero-direct-correction-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    const sources = [{
        measurement,
        impulses: [{
            measurementId: measurement.id,
            pointId: 1,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data: impulse
        }]
    }];
    const linear = designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'lin',
            correctionAmount: 0
        },
        sources
    }).channels[0];
    const directDisabled = designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'full',
            correctionAmount: 0,
            phaseCorrectionAmount: 0,
            directWindowMs: 6
        },
        sources
    }).channels[0];
    const directEnabled = designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 8192,
            phase: 'full',
            correctionAmount: 0,
            phaseCorrectionAmount: 1,
            directWindowMs: 6
        },
        sources
    }).channels[0];
    let maximumDifference = 0;
    for (let index = 0; index < linear.length; index += 1) {
        const difference = Math.abs(linear[index] - directDisabled[index]);
        if (difference > maximumDifference) maximumDifference = difference;
    }
    assert.ok(maximumDifference < 1e-6);
    assert.ok(directEnabled.some((value, index) => Math.abs(value - linear[index]) > 1e-4));
});

test('IR power averaging remains distinct from the dB display average', () => {
    const strong = new Float32Array(4096);
    const weak = new Float32Array(4096);
    strong[128] = 1;
    weak[128] = 0.1;
    const measurement = {
        id: 'power-mean-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'one' }, { pointId: 2, timestamp: 'two' }],
        averageFrequencyResponse: []
    };
    const result = designRoomEq({
        config: { sampleRate: 48000, taps: 8192, phase: 'min', smoothing: 0.02 },
        sources: [{
            measurement,
            impulses: [strong, weak].map((data, index) => ({
                measurementId: measurement.id,
                pointId: index + 1,
                sampleRate: 48000,
                onsetIndex: 128,
                refScale: 1,
                data
            }))
        }]
    });
    const preview = result.previews[0];
    let bin = 0;
    for (let index = 1; index < preview.frequencies.length; index += 1) {
        if (Math.abs(preview.frequencies[index] - 1000) <
            Math.abs(preview.frequencies[bin] - 1000)) bin = index;
    }
    assert.ok(Math.abs(preview.measuredDb[bin] + 10) < 0.05);
    assert.ok(Math.abs(preview.targetDb[bin] + 2.967) < 0.05);
});

test('stored deconvolution reference scale restores comparable IR levels', () => {
    const normalized = new Float32Array(4096);
    const scaled = new Float32Array(4096);
    normalized[128] = 1;
    scaled[128] = 0.5;
    const measurement = {
        id: 'reference-scale-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'one' }, { pointId: 2, timestamp: 'two' }],
        averageFrequencyResponse: []
    };
    const result = designRoomEq({
        config: { sampleRate: 48000, taps: 8192, phase: 'min', smoothing: 0.02 },
        sources: [{
            measurement,
            impulses: [
                {
                    measurementId: measurement.id,
                    pointId: 1,
                    sampleRate: 48000,
                    onsetIndex: 128,
                    refScale: 1,
                    data: normalized
                },
                {
                    measurementId: measurement.id,
                    pointId: 2,
                    sampleRate: 48000,
                    onsetIndex: 128,
                    refScale: 0.5,
                    data: scaled
                }
            ]
        }]
    });
    assert.ok(Math.abs(result.previews[0].measuredDb[400]) < 0.05);
});

test('measured phase correction fixture keeps early pre-response energy bounded', () => {
    const impulse = new Float32Array(4096);
    impulse[128] = 1;
    impulse[180] = 0.2;
    impulse[250] = -0.12;
    const measurement = {
        id: 'direct-phase-prering-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    const result = designRoomEq({
        config: { sampleRate: 48000, taps: 8192, phase: 'full', directWindowMs: 6 },
        sources: [{
            measurement,
            impulses: [{
                measurementId: measurement.id,
                pointId: 1,
                sampleRate: 48000,
                onsetIndex: 128,
                refScale: 1,
                data: impulse
            }]
        }]
    });
    const taps = result.channels[0];
    const center = taps.length / 2;
    let earlyEnergy = 0;
    let totalEnergy = 0;
    for (let index = 0; index < taps.length; index += 1) {
        const energy = taps[index] * taps[index];
        totalEnergy += energy;
        if (index < center - 64) earlyEnergy += energy;
    }
    assert.ok(earlyEnergy / totalEnergy < 0.02);
});

function lowFrequencyAllPassSource(id, coefficient = -0.98, sampleCount = 12000) {
    const onset = 128;
    const impulse = new Float32Array(sampleCount);
    impulse[onset] = coefficient;
    for (let index = 1; index < sampleCount - onset; index += 1) {
        impulse[onset + index] = (1 - coefficient * coefficient) *
            (-coefficient) ** (index - 1);
    }
    const measurement = {
        id,
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    return {
        measurement,
        impulses: [{
            measurementId: id,
            pointId: 1,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data: impulse
        }]
    };
}

function lowFrequencyAllPassCascadeSource(id, coefficient, stages, sampleCount = 12000) {
    const source = lowFrequencyAllPassSource(id, coefficient, sampleCount);
    let input = new Float32Array(sampleCount);
    input[128] = 1;
    for (let stage = 0; stage < stages; stage += 1) {
        const output = new Float32Array(sampleCount);
        let previousInput = 0;
        let previousOutput = 0;
        for (let index = 128; index < sampleCount; index += 1) {
            output[index] = coefficient * input[index] + previousInput -
                coefficient * previousOutput;
            previousInput = input[index];
            previousOutput = output[index];
        }
        input = output;
    }
    source.impulses[0].data = input;
    return source;
}

function lowFrequencyMinimumPhaseSource(id, coefficient, stages, sampleCount = 24000) {
    const onset = 128;
    let input = new Float32Array(sampleCount);
    input[onset] = 1;
    for (let stage = 0; stage < stages; stage += 1) {
        const output = new Float32Array(sampleCount);
        let previousOutput = 0;
        for (let index = onset; index < sampleCount; index += 1) {
            output[index] = (1 - coefficient) * input[index] +
                coefficient * previousOutput;
            previousOutput = output[index];
        }
        input = output;
    }
    const measurement = {
        id,
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    return {
        measurement,
        impulses: [{
            measurementId: id,
            pointId: 1,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data: input
        }]
    };
}

function multipointAllPassSource(id, stages, coefficient = -0.98) {
    const measurement = {
        id,
        timestamp: 'fixed',
        points: stages.map((unused, pointId) => ({ pointId })),
        averageFrequencyResponse: []
    };
    const impulses = stages.map((stageCount, pointId) => {
        const source = lowFrequencyAllPassCascadeSource(
            `${id}-point-${pointId}`,
            coefficient,
            stageCount,
            24000
        );
        return {
            ...source.impulses[0],
            measurementId: measurement.id,
            pointId
        };
    });
    return { measurement, impulses };
}

function deepNullDelaySource(id, delaySamples, sampleCount) {
    const sampleRate = 48000;
    const onsetIndex = 128;
    const nullSpacingSamples = 256;
    const common = new Float32Array(sampleCount);
    common[onsetIndex + delaySamples] = 1;
    const deepNull = Float32Array.from(common);
    deepNull[onsetIndex + delaySamples + nullSpacingSamples] = -(1 - 1e-7);
    const measurement = {
        id,
        timestamp: 'fixed',
        points: [{ pointId: 0 }, { pointId: 1 }],
        averageFrequencyResponse: []
    };
    return {
        measurement,
        impulses: [common, deepNull].map((data, pointId) => ({
            measurementId: id,
            pointId,
            sampleRate,
            onsetIndex,
            refScale: 1,
            data
        }))
    };
}

function lowPhaseExtensionConfig(overrides = {}) {
    return {
        sampleRate: 48000,
        taps: 8192,
        phase: 'full',
        smoothing: 0.05,
        lowFrequency: 50,
        highFrequency: 16000,
        directWindowMs: 6,
        phaseLowFrequency: 500,
        correctionAmount: 0,
        phaseCorrectionAmount: 1,
        ...overrides
    };
}

function lowPhaseExtensionDesign(source, overrides = {}) {
    return designRoomEq({
        config: lowPhaseExtensionConfig(overrides),
        sources: [source]
    });
}

test('consensus group-delay Before is the pointwise mean of measurement points', () => {
    const source = multipointAllPassSource(
        'consensus-group-delay-display-mean',
        [2, 8, 14]
    );
    const common = {
        taps: 32768,
        smoothing: 0.3,
        directWindowMs: 20,
        lowFrequencyPhaseExtension: true
    };
    const consensus = lowPhaseExtensionDesign(source, {
        ...common,
        referencePoint: 0
    }).previews[0];
    const points = [1, 2, 3].map(referencePoint =>
        lowPhaseExtensionDesign(source, {
            ...common,
            referencePoint
        }).previews[0]);
    let maximumDifference = 0;
    for (let index = 0; index < consensus.frequencies.length; index += 1) {
        const expected = points.reduce((sum, preview) =>
            sum + preview.groupDelayResponse.excess.before[index], 0) / points.length;
        const difference = Math.abs(
            consensus.groupDelayResponse.excess.before[index] - expected
        );
        if (difference > maximumDifference) maximumDifference = difference;
    }
    assert.ok(maximumDifference < 1e-4,
        `consensus Before differed from the point mean by ${maximumDifference} ms`);
});

function responseResidualRms(impulse, correction, lowFrequency, highFrequency) {
    const fftSize = correction.length * 2;
    const input = spectrumFor(impulse, fftSize);
    const filter = spectrumFor(correction, fftSize);
    const corrected = {
        real: new Float64Array(filter.real.length),
        imag: new Float64Array(filter.imag.length)
    };
    for (let bin = 0; bin < corrected.real.length; bin += 1) {
        corrected.real[bin] = input.real[bin] * filter.real[bin] -
            input.imag[bin] * filter.imag[bin];
        corrected.imag[bin] = input.real[bin] * filter.imag[bin] +
            input.imag[bin] * filter.real[bin];
    }
    return linearPhaseResidualRms(corrected, 48000, lowFrequency, highFrequency);
}

function groupDelayBandStats(result, lowFrequency, highFrequency) {
    const preview = result.previews[0];
    const before = [];
    const after = [];
    for (let index = 0; index < preview.frequencies.length; index += 1) {
        const frequency = preview.frequencies[index];
        if (frequency < lowFrequency || frequency > highFrequency) continue;
        before.push(preview.groupDelayResponse.before[index]);
        after.push(preview.groupDelayResponse.after[index]);
    }
    const rms = values => Math.sqrt(
        values.reduce((sum, value) => sum + value * value, 0) / values.length
    );
    return {
        beforeRms: rms(before),
        afterRms: rms(after),
        afterMaximum: Math.max(...after.map(Math.abs)),
        afterSpan: Math.max(...after) - Math.min(...after)
    };
}

function groupDelayDifferenceRms(first, second, lowFrequency, highFrequency) {
    const firstPreview = first.previews[0];
    const secondPreview = second.previews[0];
    let squaredDifference = 0;
    let count = 0;
    for (let index = 0; index < firstPreview.frequencies.length; index += 1) {
        const frequency = firstPreview.frequencies[index];
        if (frequency < lowFrequency || frequency > highFrequency) continue;
        const difference = firstPreview.groupDelayResponse.after[index] -
            secondPreview.groupDelayResponse.after[index];
        squaredDifference += difference * difference;
        count += 1;
    }
    return Math.sqrt(squaredDifference / count);
}

function filterRelativeGroupDelayStats(first, second, lowFrequency, highFrequency) {
    const fftSize = first.length * 2;
    const firstSpectrum = spectrumFor(first, fftSize);
    const secondSpectrum = spectrumFor(second, fftSize);
    const wrapped = new Float64Array(firstSpectrum.real.length);
    for (let bin = 0; bin < wrapped.length; bin += 1) {
        wrapped[bin] = Math.atan2(
            firstSpectrum.imag[bin] * secondSpectrum.real[bin] -
                firstSpectrum.real[bin] * secondSpectrum.imag[bin],
            firstSpectrum.real[bin] * secondSpectrum.real[bin] +
                firstSpectrum.imag[bin] * secondSpectrum.imag[bin]
        );
    }
    const phase = unwrapPhases(wrapped);
    const magnitudes = [];
    for (let bin = 1; bin < phase.length; bin += 1) {
        const frequency = bin * 48000 / fftSize;
        const previousFrequency = (bin - 1) * 48000 / fftSize;
        if (previousFrequency < lowFrequency || frequency >= highFrequency) continue;
        const delayMs = -(phase[bin] - phase[bin - 1]) * 1000 /
            (2 * Math.PI * (frequency - previousFrequency));
        magnitudes.push(Math.abs(delayMs));
    }
    magnitudes.sort((left, right) => left - right);
    const rms = Math.sqrt(
        magnitudes.reduce((sum, value) => sum + value * value, 0) /
        (magnitudes.length || 1)
    );
    return {
        rms,
        p95: magnitudes[Math.min(
            magnitudes.length - 1,
            Math.floor(magnitudes.length * 0.95)
        )] || 0
    };
}

function maximumSubsonicSpectrumDifference(first, second, highFrequency = 20) {
    const fftSize = first.length * 2;
    const firstSpectrum = spectrumFor(first, fftSize);
    const secondSpectrum = spectrumFor(second, fftSize);
    let maximum = 0;
    for (let bin = 0; bin * 48000 / fftSize < highFrequency; bin += 1) {
        const difference = Math.hypot(
            firstSpectrum.real[bin] - secondSpectrum.real[bin],
            firstSpectrum.imag[bin] - secondSpectrum.imag[bin]
        );
        if (difference > maximum) maximum = difference;
    }
    return maximum;
}

function maximumFilterDifference(first, second) {
    let maximum = 0;
    for (let index = 0; index < first.length; index += 1) {
        const difference = Math.abs(first[index] - second[index]);
        if (difference > maximum) maximum = difference;
    }
    return maximum;
}

function filterEnergyProfile(taps) {
    const edgeLength = Math.ceil(taps.length * 0.05);
    let total = 0;
    let edge = 0;
    for (let index = 0; index < taps.length; index += 1) {
        const energy = taps[index] * taps[index];
        total += energy;
        if (index < edgeLength || index >= taps.length - edgeLength) edge += energy;
    }
    return edge / total;
}

function countingFftBackend(counts) {
    return {
        realTransform(input) {
            counts.real += 1;
            return new FFT(input.length).realTransform(input);
        },
        inverseRealTransform(real, imag, size) {
            counts.inverse += 1;
            return new FFT(size).inverseRealTransform(real, imag);
        }
    };
}

test('low-frequency phase extension is opt-in and disabled designs remain unchanged', () => {
    const source = lowFrequencyAllPassSource('low-phase-opt-in');
    const omitted = lowPhaseExtensionDesign(source);
    const disabled = lowPhaseExtensionDesign(source, {
        lowFrequencyPhaseExtension: false
    });

    assert.equal(omitted.config.lowFrequencyPhaseExtension, false);
    assert.deepEqual(disabled.channels[0], omitted.channels[0]);
});

test('frequency-dependent phase window reduces low-frequency all-pass residual', () => {
    const source = lowFrequencyAllPassSource('low-phase-all-pass');
    const disabled = lowPhaseExtensionDesign(source);
    const enabled = lowPhaseExtensionDesign(source, {
        lowFrequencyPhaseExtension: true
    });
    const impulse = source.impulses[0].data;
    const disabledResidual = responseResidualRms(
        impulse,
        disabled.channels[0],
        70,
        350
    );
    const enabledResidual = responseResidualRms(
        impulse,
        enabled.channels[0],
        70,
        350
    );

    assert.ok(enabledResidual < disabledResidual * 0.8,
        `residual changed from ${disabledResidual} to ${enabledResidual}`);
    const diagnostic = enabled.diagnostics.lowFrequencyPhaseExtension[0];
    assert.notEqual(diagnostic.state, 'disabled');
    assert.ok(diagnostic.scale > 0.9 && diagnostic.scale <= 1);
});

test('low-frequency phase extension aligns clean 10 and 20 ms-class group delay to zero', () => {
    for (const [stages, maximumResidualMs] of [[5, 1], [10, 2]]) {
        const source = lowFrequencyAllPassCascadeSource(
            `low-phase-absolute-delay-${stages}`,
            -0.98,
            stages,
            24000
        );
        const result = lowPhaseExtensionDesign(source, {
            taps: 32768,
            lowFrequency: 50,
            lowFrequencyPhaseExtension: true
        });
        const low = groupDelayBandStats(result, 70, 350);
        const deepLow = groupDelayBandStats(result, 70, 150);
        const crossing = groupDelayBandStats(result, 450, 550);

        assert.ok(low.afterRms <= maximumResidualMs,
            `${stages} stages left ${low.afterRms} ms RMS (before ${low.beforeRms}); ` +
            `deep low ${deepLow.afterRms} ms (before ${deepLow.beforeRms}); ` +
            JSON.stringify(result.diagnostics.lowFrequencyPhaseExtension[0]));
        assert.ok(low.afterRms < low.beforeRms * 0.25);
        assert.ok(deepLow.afterRms <= maximumResidualMs);
        assert.ok(deepLow.afterRms < deepLow.beforeRms * 0.25);
        assert.ok(crossing.afterSpan <= 1,
            `${stages} stages left ${crossing.afterSpan} ms across Phase Low`);
        assert.notEqual(result.diagnostics.lowFrequencyPhaseExtension[0].state, 'disabled');
    }
});

test('low-frequency consensus excludes a GD-invalid deep-null observation', () => {
    const sampleRate = 48000;
    const taps = 65536;
    const source = deepNullDelaySource('low-phase-deep-null', 192, 14528);
    const frequency = 497 * sampleRate / (2 * taps);
    const frequencies = new Float64Array([frequency]);
    const onsetIndex = source.impulses[0].onsetIndex;
    const windowStart = onsetIndex - Math.round(sampleRate * 0.001);
    const windowEnd = onsetIndex + Math.round(sampleRate * 0.04);
    const nullWindow = analyzeRoomEqGroupDelay(
        source.impulses[1].data.slice(windowStart, windowEnd),
        onsetIndex - windowStart,
        sampleRate,
        frequencies
    );
    assert.equal(nullWindow.valid[0], 0, 'premise: the deep-null delay is unavailable');

    clearRoomEqAnalysisCache();
    clearRoomEqDesignCache();
    const result = lowPhaseExtensionDesign(source, {
        taps,
        smoothing: 0.02,
        phaseSmoothing: 0.02,
        lowFrequency: 50,
        directWindowMs: 20,
        phaseLowFrequency: 500,
        correctionAmount: 0,
        lowFrequencyPhaseExtension: true
    });
    const common = analyzeRoomEqGroupDelay(
        source.impulses[0].data,
        onsetIndex,
        sampleRate,
        frequencies
    );
    const correction = analyzeRoomEqGroupDelay(
        result.channels[0],
        taps / 2,
        sampleRate,
        frequencies,
        { minimumFftSize: taps * 2 }
    );
    assert.equal(result.diagnostics.lowFrequencyPhaseExtension[0].state, 'applied');
    assert.ok(Math.abs(common.excessMs[0] - 4) < 0.01);
    assert.ok(Math.abs(correction.excessMs[0] + common.excessMs[0]) < 0.25,
        `the valid common delay must not be averaged with zero (${correction.excessMs[0]} ms)`);
});

test('low-frequency phase extension starts at Correction Low without a hidden upper gate', () => {
    const source = lowFrequencyAllPassCascadeSource(
        'low-phase-correction-low-boundary',
        -0.98,
        5,
        24000
    );
    const common = {
        taps: 32768,
        lowFrequency: 29,
        smoothing: 0.02,
        phaseSmoothing: 0.02
    };
    const disabled = lowPhaseExtensionDesign(source, common);
    const enabled = lowPhaseExtensionDesign(source, {
        ...common,
        lowFrequencyPhaseExtension: true
    });
    const disabledBoundary = groupDelayBandStats(disabled, 30, 36);
    const enabledBoundary = groupDelayBandStats(enabled, 30, 36);

    assert.ok(enabledBoundary.afterRms < disabledBoundary.afterRms * 0.5,
        `Correction Low boundary RMS changed from ${disabledBoundary.afterRms} to ` +
        `${enabledBoundary.afterRms}`);
    assert.deepEqual(enabled.diagnostics.lowFrequencyPhaseExtension[0], {
        state: 'applied',
        scale: 1,
        reason: null
    });
});

test('larger supported FIR retains the same low-frequency consensus analysis', () => {
    const source = multipointAllPassSource(
        'low-phase-large-taps-consensus',
        [5, 5]
    );
    const designs = [65536, 131072].map(taps => lowPhaseExtensionDesign(source, {
        taps,
        lowFrequency: 50,
        directWindowMs: 3,
        phaseSmoothing: 0.17,
        lowFrequencyPhaseExtension: true
    }));
    const shortStats = groupDelayBandStats(designs[0], 70, 350);
    const longStats = groupDelayBandStats(designs[1], 70, 350);

    for (const design of designs) {
        const diagnostic = design.diagnostics.lowFrequencyPhaseExtension[0];
        assert.notEqual(diagnostic.reason, 'dftWorkBudget');
        assert.ok(diagnostic.scale > 0, JSON.stringify(diagnostic));
    }
    assert.ok(longStats.afterRms < longStats.beforeRms * 0.5,
        `131072 taps left ${longStats.afterRms} ms RMS from ${longStats.beforeRms}`);
    assert.ok(longStats.afterRms <= shortStats.afterRms + 0.5,
        `residual changed from ${shortStats.afterRms} to ${longStats.afterRms} ms`);
});

test('subsonic phase closure keeps below-band realization leakage small', () => {
    const source = lowFrequencyAllPassCascadeSource(
        'low-phase-subsonic-closure',
        -0.98,
        5,
        24000
    );
    for (const lowFrequency of [20, 29, 50, 100]) {
        for (const phaseCorrectionAmount of [0.25, 0.5, 1]) {
            const common = {
                taps: 32768,
                lowFrequency,
                phaseCorrectionAmount
            };
            const disabled = lowPhaseExtensionDesign(source, common);
            const enabled = lowPhaseExtensionDesign(source, {
                ...common,
                lowFrequencyPhaseExtension: true
            });
            const inactive = filterRelativeGroupDelayStats(
                enabled.channels[0],
                disabled.channels[0],
                20,
                lowFrequency
            );
            const activeLow = Math.max(lowFrequency * 2 ** (1 / 3), 70);
            const disabledActive = groupDelayBandStats(disabled, activeLow, 350);
            const enabledActive = groupDelayBandStats(enabled, activeLow, 350);
            assert.ok(inactive.rms <= 0.5,
                `${lowFrequency} Hz/${phaseCorrectionAmount} inactive RMS ` +
                `${inactive.rms} ms`);
            assert.ok(inactive.p95 <= 1.5,
                `${lowFrequency} Hz/${phaseCorrectionAmount} inactive p95 ` +
                `${inactive.p95} ms`);
            assert.ok(enabledActive.afterRms <= disabledActive.afterRms + 0.1,
                `${lowFrequency} Hz/${phaseCorrectionAmount} active RMS changed from ` +
                `${disabledActive.afterRms} to ${enabledActive.afterRms}`);
            assert.ok(enabled.diagnostics.lowFrequencyPhaseExtension[0].scale > 0);
        }
    }
});

test('subsonic chord stays continuous when applied phase wraps', () => {
    const source = lowFrequencyAllPassCascadeSource(
        'low-phase-subsonic-branch',
        -0.98,
        5,
        24000
    );
    const designs = [0.559, 0.56, 0.561].map(phaseCorrectionAmount =>
        lowPhaseExtensionDesign(source, {
            taps: 32768,
            lowFrequency: 29,
            phaseCorrectionAmount,
            lowFrequencyPhaseExtension: true
        }));

    assert.ok(maximumSubsonicSpectrumDifference(
        designs[0].channels[0],
        designs[1].channels[0]
    ) <= 0.05);
    assert.ok(maximumSubsonicSpectrumDifference(
        designs[1].channels[0],
        designs[2].channels[0]
    ) <= 0.05);
    for (const design of designs) {
        assert.equal(design.diagnostics.lowFrequencyPhaseExtension[0].scale, 1);
    }
});

test('low-frequency phase extension does not invert a non-flat minimum-phase response', () => {
    const source = lowFrequencyMinimumPhaseSource(
        'low-phase-minimum-phase-response',
        0.995,
        1
    );
    const disabled = lowPhaseExtensionDesign(source, {
        taps: 32768,
        lowFrequency: 50,
        correctionAmount: 0
    });
    const enabled = lowPhaseExtensionDesign(source, {
        taps: 32768,
        lowFrequency: 50,
        correctionAmount: 0,
        lowFrequencyPhaseExtension: true
    });
    const disabledLow = groupDelayBandStats(disabled, 70, 350);
    const enabledLow = groupDelayBandStats(enabled, 70, 350);

    assert.ok(enabledLow.afterRms <= 1,
        `minimum-phase response left ${enabledLow.afterRms} ms RMS ` +
        `(disabled ${disabledLow.afterRms}, ` +
        `${JSON.stringify(enabled.diagnostics.lowFrequencyPhaseExtension[0])})`);
    assert.ok(enabledLow.afterRms <= disabledLow.afterRms + 0.1,
        `minimum-phase RMS changed from ${disabledLow.afterRms} to ${enabledLow.afterRms}`);
});

test('low-frequency phase extension preserves Additional EQ minimum phase', () => {
    const source = lowFrequencyMinimumPhaseSource(
        'low-phase-additional-eq',
        0.995,
        1
    );
    const config = {
        taps: 32768,
        lowFrequency: 50,
        correctionAmount: 0,
        eqBands: [{
            enabled: true,
            type: 'ls',
            frequency: 120,
            gain: 6,
            q: 0.707
        }]
    };
    const disabled = lowPhaseExtensionDesign(source, config);
    const enabled = lowPhaseExtensionDesign(source, {
        ...config,
        lowFrequencyPhaseExtension: true
    });
    const differenceRms = groupDelayDifferenceRms(enabled, disabled, 70, 350);

    assert.ok(differenceRms <= 0.1,
        `Additional EQ group delay changed by ${differenceRms} ms RMS`);
});

test('low-frequency phase consensus does not turn point-specific late sound into delay', () => {
    const onset = 128;
    const sampleCount = 12000;
    const measurement = {
        id: 'low-phase-nuisance-only',
        timestamp: 'fixed',
        points: [{ pointId: 0 }, { pointId: 1 }, { pointId: 2 }],
        averageFrequencyResponse: []
    };
    const impulses = [
        [480, 0.45],
        [960, -0.4],
        [1920, 0.35]
    ].map(([offset, amplitude], pointId) => {
        const data = new Float32Array(sampleCount);
        data[onset] = 1;
        data[onset + offset] = amplitude;
        return {
            measurementId: measurement.id,
            pointId,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data
        };
    });
    const source = { measurement, impulses };
    const disabled = lowPhaseExtensionDesign(source, {
        taps: 32768,
        lowFrequency: 50
    });
    const enabled = lowPhaseExtensionDesign(source, {
        taps: 32768,
        lowFrequency: 50,
        lowFrequencyPhaseExtension: true
    });
    const disabledLow = groupDelayBandStats(disabled, 70, 350);
    const enabledLow = groupDelayBandStats(enabled, 70, 350);

    assert.ok(enabledLow.afterRms <= disabledLow.afterRms + 0.1,
        `nuisance RMS changed from ${disabledLow.afterRms} to ${enabledLow.afterRms}`);
});

test('low-frequency phase consensus averages an exactly split delay pair', () => {
    const onset = 128;
    const measurement = {
        id: 'low-phase-split-delay-pair',
        timestamp: 'fixed',
        points: [{ pointId: 0 }, { pointId: 1 }],
        averageFrequencyResponse: []
    };
    const impulses = [0.2, -0.2].map((amplitude, pointId) => {
        const data = new Float32Array(12000);
        data[onset] = 1;
        data[onset + 480] = amplitude;
        return {
            measurementId: measurement.id,
            pointId,
            sampleRate: 48000,
            onsetIndex: onset,
            refScale: 1,
            data
        };
    });
    const source = { measurement, impulses };
    const disabled = lowPhaseExtensionDesign(source, {
        taps: 32768,
        lowFrequency: 50
    });
    const enabled = lowPhaseExtensionDesign(source, {
        taps: 32768,
        lowFrequency: 50,
        lowFrequencyPhaseExtension: true
    });
    const differenceRms = groupDelayDifferenceRms(enabled, disabled, 70, 350);

    assert.ok(differenceRms <= 0.1,
        `split-pair consensus changed group delay by ${differenceRms} ms RMS`);
    assert.ok(enabled.diagnostics.lowFrequencyPhaseExtension[0].scale >= 0);
});

test('low-frequency phase consensus corrects common delay through point-specific late sound', () => {
    const base = lowFrequencyAllPassCascadeSource(
        'low-phase-common-delay-base',
        -0.98,
        5,
        24000
    );
    const measurement = {
        id: 'low-phase-common-delay-nuisance',
        timestamp: 'fixed',
        points: [{ pointId: 0 }, { pointId: 1 }, { pointId: 2 }],
        averageFrequencyResponse: []
    };
    const impulses = [
        [480, 0.35],
        [960, -0.3],
        [1920, 0.25]
    ].map(([offset, amplitude], pointId) => {
        const data = Float32Array.from(base.impulses[0].data);
        data[128 + offset] += amplitude;
        return {
            measurementId: measurement.id,
            pointId,
            sampleRate: 48000,
            onsetIndex: 128,
            refScale: 1,
            data
        };
    });
    const source = { measurement, impulses };
    const disabled = lowPhaseExtensionDesign(source, {
        taps: 32768,
        lowFrequency: 50,
        directWindowMs: 20
    });
    const enabled = lowPhaseExtensionDesign(source, {
        taps: 32768,
        lowFrequency: 50,
        directWindowMs: 20,
        lowFrequencyPhaseExtension: true
    });
    const disabledLow = groupDelayBandStats(disabled, 70, 350);
    const enabledLow = groupDelayBandStats(enabled, 70, 350);

    assert.ok(enabledLow.afterRms < disabledLow.afterRms * 0.5,
        `common-delay RMS changed from ${disabledLow.afterRms} to ${enabledLow.afterRms}`);
});

test('low-frequency phase consensus keeps the Phase Low boundary connected when agreement falls', () => {
    const result = lowPhaseExtensionDesign(multipointAllPassSource(
        'low-phase-boundary-agreement',
        [1, 5, 15]
    ), {
        taps: 32768,
        lowFrequency: 50,
        directWindowMs: 20,
        lowFrequencyPhaseExtension: true
    });
    const crossing = groupDelayBandStats(result, 475, 525);

    assert.ok(crossing.afterSpan <= 2,
        `consensus left ${crossing.afterSpan} ms across Phase Low`);
    assert.deepEqual(result.diagnostics.lowFrequencyPhaseExtension[0], {
        state: 'applied',
        scale: 1,
        reason: null
    });
});

test('low-frequency phase consensus keeps a moderately varying common delay', () => {
    const source = multipointAllPassSource(
        'low-phase-moderate-consensus',
        [5, 10, 15]
    );
    const disabled = lowPhaseExtensionDesign(source, {
        taps: 32768,
        lowFrequency: 50
    });
    const enabled = lowPhaseExtensionDesign(source, {
        taps: 32768,
        lowFrequency: 50,
        lowFrequencyPhaseExtension: true
    });
    const middleImpulse = source.impulses[1].data;
    const disabledResidual = responseResidualRms(
        middleImpulse,
        disabled.channels[0],
        70,
        350
    );
    const enabledResidual = responseResidualRms(
        middleImpulse,
        enabled.channels[0],
        70,
        350
    );
    const disabledTotal = groupDelayBandStats(disabled, 70, 350);
    const enabledTotal = groupDelayBandStats(enabled, 70, 350);

    assert.ok(enabledResidual < disabledResidual,
        `moderate consensus residual changed from ${disabledResidual} to ` +
        `${enabledResidual}; ${JSON.stringify(
            enabled.diagnostics.lowFrequencyPhaseExtension[0]
        )}`);
    assert.ok(enabledTotal.afterRms < disabledTotal.afterRms,
        `moderate total RMS changed from ${disabledTotal.afterRms} to ` +
        `${enabledTotal.afterRms}`);
    assert.ok(enabled.diagnostics.lowFrequencyPhaseExtension[0].scale > 0);
});

test('low-frequency phase consensus guard scores aligned-average excess delay', () => {
    const source = multipointAllPassSource(
        'low-phase-consensus-guard-median',
        [1, 8, 10]
    );
    for (const phaseCorrectionAmount of [0.5, 1]) {
        const common = {
            taps: 32768,
            lowFrequency: 50,
            phaseCorrectionAmount
        };
        const disabled = lowPhaseExtensionDesign(source, common);
        const enabled = lowPhaseExtensionDesign(source, {
            ...common,
            lowFrequencyPhaseExtension: true
        });
        const disabledActive = groupDelayBandStats(disabled, 50, 395);
        const enabledActive = groupDelayBandStats(enabled, 50, 395);
        const diagnostic = enabled.diagnostics.lowFrequencyPhaseExtension[0];

        assert.ok(enabledActive.afterRms <= disabledActive.afterRms + 0.1,
            `${phaseCorrectionAmount} active RMS changed from ` +
            `${disabledActive.afterRms} to ${enabledActive.afterRms}; ` +
            JSON.stringify(diagnostic));
        assert.ok(diagnostic.scale > 0);
        assert.ok(diagnostic.reason === null || diagnostic.reason === 'groupDelay');
    }
});

test('low-frequency phase extension preserves established high-frequency phase shape', () => {
    const source = lowFrequencyAllPassSource('low-phase-high-frequency');
    source.impulses[0].data[128 + 480] += 0.2;
    const disabled = spectrumFor(lowPhaseExtensionDesign(source).channels[0]);
    const enabled = spectrumFor(lowPhaseExtensionDesign(source, {
        lowFrequencyPhaseExtension: true
    }).channels[0]);
    const relative = {
        real: new Float64Array(disabled.real.length),
        imag: new Float64Array(disabled.imag.length)
    };
    for (let bin = 0; bin < disabled.real.length; bin += 1) {
        const denominator = disabled.real[bin] ** 2 + disabled.imag[bin] ** 2;
        relative.real[bin] = (
            disabled.real[bin] * enabled.real[bin] +
            disabled.imag[bin] * enabled.imag[bin]
        ) / denominator;
        relative.imag[bin] = (
            enabled.imag[bin] * disabled.real[bin] -
            enabled.real[bin] * disabled.imag[bin]
        ) / denominator;
    }
    const residual = linearPhaseResidualRms(relative, 48000, 650, 16000);
    assert.ok(residual < 0.01, `high-frequency phase residual was ${residual}`);
});

test('low-frequency onset realignment keeps established high-band phase shape', () => {
    const source = lowFrequencyAllPassSource(
        'low-phase-timing-alignment',
        -0.954369238433428
    );
    for (const [offset, value] of [
        [51, -0.2441999531],
        [22, 0.2861377761],
        [65, -0.1944137604],
        [55, 0.1039664840],
        [91, -0.2955503101],
        [73, -0.5462668184],
        [217, 0.4871767650],
        [234, 0.2278593527]
    ]) {
        source.impulses[0].data[128 + offset] += value;
    }
    const disabled = spectrumFor(lowPhaseExtensionDesign(source).channels[0]);
    const enabled = spectrumFor(lowPhaseExtensionDesign(source, {
        lowFrequencyPhaseExtension: true
    }).channels[0]);
    const relative = {
        real: new Float64Array(disabled.real.length),
        imag: new Float64Array(disabled.imag.length)
    };
    for (let bin = 1; bin < disabled.real.length; bin += 1) {
        const denominator = disabled.real[bin] ** 2 + disabled.imag[bin] ** 2;
        relative.real[bin] = (
            disabled.real[bin] * enabled.real[bin] +
            disabled.imag[bin] * enabled.imag[bin]
        ) / denominator;
        relative.imag[bin] = (
            enabled.imag[bin] * disabled.real[bin] -
            enabled.real[bin] * disabled.imag[bin]
        ) / denominator;
    }
    const residual = linearPhaseResidualRms(relative, 48000, 650, 16000);
    assert.ok(residual < 0.01, `high-band phase residual was ${residual}`);
});

test('low-frequency phase consensus weakens a point-specific phase feature', () => {
    const first = lowFrequencyAllPassSource('low-phase-consensus-first');
    const second = lowFrequencyAllPassSource('low-phase-consensus-second', 0.98);
    const measurement = {
        id: 'low-phase-consensus',
        timestamp: 'fixed',
        points: [{ pointId: 0 }, { pointId: 1 }],
        averageFrequencyResponse: []
    };
    const source = {
        measurement,
        impulses: [first.impulses[0], second.impulses[0]].map((impulse, pointId) => ({
            ...impulse,
            measurementId: measurement.id,
            pointId
        }))
    };
    const single = spectrumFor(lowPhaseExtensionDesign(source, {
        lowFrequencyPhaseExtension: true,
        referencePoint: 1
    }).channels[0]);
    const consensus = spectrumFor(lowPhaseExtensionDesign(source, {
        lowFrequencyPhaseExtension: true,
        referencePoint: 0
    }).channels[0]);

    assert.ok(
        linearPhaseResidualRms(consensus, 48000, 70, 350) <
        linearPhaseResidualRms(single, 48000, 70, 350)
    );
});

test('low-frequency phase extension safely degrades for short impulse responses', () => {
    const source = lowFrequencyAllPassSource('low-phase-short-ir', -0.98, 420);
    const result = lowPhaseExtensionDesign(source, {
        lowFrequencyPhaseExtension: true,
        taps: 8192,
        lowFrequency: 20
    });
    const phaseDisabled = lowPhaseExtensionDesign(source, {
        lowFrequencyPhaseExtension: true,
        taps: 8192,
        lowFrequency: 20,
        phaseCorrectionAmount: 0
    });
    const baseline = lowPhaseExtensionDesign(source, {
        lowFrequencyPhaseExtension: false,
        taps: 8192,
        lowFrequency: 20,
        phaseCorrectionAmount: 0
    });

    assert.ok(result.channels[0].every(Number.isFinite));
    assert.deepEqual(phaseDisabled.channels[0], baseline.channels[0]);
    const diagnostic = result.diagnostics.lowFrequencyPhaseExtension[0];
    assert.equal(diagnostic.state, 'reduced');
    assert.equal(diagnostic.scale, 1);
    assert.equal(diagnostic.reason, 'insufficientData');
});

test('low-frequency phase extension uses measured data beyond the FIR half-window', () => {
    const result = lowPhaseExtensionDesign(
        lowFrequencyAllPassSource('low-phase-fir-window-coverage'),
        {
            lowFrequencyPhaseExtension: true,
            sampleRate: 48000,
            taps: 8192,
            lowFrequency: 20,
            phaseLowFrequency: 500
        }
    );

    const diagnostic = result.diagnostics.lowFrequencyPhaseExtension[0];
    assert.deepEqual(diagnostic, { state: 'applied', scale: 1, reason: null });
});

test('low-frequency phase analysis cache follows remeasurement revisions and IR identity', () => {
    clearRoomEqAnalysisCache();
    clearRoomEqDesignCache();
    const first = lowFrequencyAllPassSource('low-phase-remeasurement', -0.98);
    first.measurement.timestamp = 'v1';
    first.measurement.points[0].timestamp = 'v1';
    const firstTaps = lowPhaseExtensionDesign(first, {
        lowFrequencyPhaseExtension: true
    }).channels[0];

    const revisedData = lowFrequencyAllPassSource('unused', 0.98).impulses[0].data;
    first.impulses[0].data.set(revisedData);
    const revisedTaps = lowPhaseExtensionDesign(first, {
        lowFrequencyPhaseExtension: true
    }).channels[0];
    const fresh = lowFrequencyAllPassSource('low-phase-remeasurement-fresh', 0.98);
    fresh.measurement.timestamp = 'v1';
    fresh.measurement.points[0].timestamp = 'v1';
    const freshTaps = lowPhaseExtensionDesign(fresh, {
        lowFrequencyPhaseExtension: true
    }).channels[0];

    assert.ok(maximumFilterDifference(firstTaps, revisedTaps) > 0.1);
    assert.ok(maximumFilterDifference(revisedTaps, freshTaps) < 1e-7);

    const replacement = lowFrequencyAllPassSource('low-phase-remeasurement', -0.95);
    replacement.measurement.timestamp = 'v1';
    replacement.measurement.points[0].timestamp = 'v1';
    const replacementTaps = lowPhaseExtensionDesign(replacement, {
        lowFrequencyPhaseExtension: true
    }).channels[0];
    const replacementFresh = lowFrequencyAllPassSource(
        'low-phase-remeasurement-replacement-fresh',
        -0.95
    );
    replacementFresh.measurement.timestamp = 'v1';
    replacementFresh.measurement.points[0].timestamp = 'v1';
    const replacementFreshTaps = lowPhaseExtensionDesign(replacementFresh, {
        lowFrequencyPhaseExtension: true
    }).channels[0];
    assert.ok(maximumFilterDifference(revisedTaps, replacementTaps) > 0.1);
    assert.ok(maximumFilterDifference(replacementTaps, replacementFreshTaps) < 1e-7);
});

test('analysis cache reuses structured-cloned IR content across worker requests', () => {
    const source = lowFrequencyAllPassSource('low-phase-structured-clone-cache');
    const counts = { real: 0, inverse: 0 };
    setRoomEqFftBackend(countingFftBackend(counts));
    try {
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
        lowPhaseExtensionDesign(source, { lowFrequencyPhaseExtension: true });
        const firstRealTransforms = counts.real;

        counts.real = 0;
        counts.inverse = 0;
        clearRoomEqDesignCache();
        lowPhaseExtensionDesign(structuredClone(source), {
            lowFrequencyPhaseExtension: true
        });

        assert.ok(counts.real <= firstRealTransforms - 2,
            `structured clone repeated analysis (${firstRealTransforms} then ${counts.real})`);

        const revisedClone = structuredClone(source);
        revisedClone.measurement.timestamp = 'revised';
        counts.real = 0;
        counts.inverse = 0;
        clearRoomEqDesignCache();
        lowPhaseExtensionDesign(revisedClone, { lowFrequencyPhaseExtension: true });
        assert.ok(counts.real >= firstRealTransforms,
            `timestamp revision reused analysis (${firstRealTransforms} then ${counts.real})`);
    } finally {
        setRoomEqFftBackend(null);
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
    }
});

test('impulse analysis cache follows onset changes on the same stored IR', () => {
    clearRoomEqAnalysisCache();
    clearRoomEqDesignCache();
    const data = new Float32Array(4096);
    data[128] = 1;
    data[170] = 0.3;
    data[256] = -0.8;
    data[298] = 0.2;
    const source = lowFrequencyAllPassSource('low-phase-onset-cache');
    source.impulses[0].data = data;
    lowPhaseExtensionDesign(source, { lowFrequencyPhaseExtension: true });

    source.impulses[0].onsetIndex = 256;
    const revisedTaps = lowPhaseExtensionDesign(source, {
        lowFrequencyPhaseExtension: true
    }).channels[0];
    const fresh = lowFrequencyAllPassSource('low-phase-onset-cache-fresh');
    fresh.impulses[0] = {
        ...source.impulses[0],
        measurementId: fresh.measurement.id,
        data: Float32Array.from(data)
    };
    const freshTaps = lowPhaseExtensionDesign(fresh, {
        lowFrequencyPhaseExtension: true
    }).channels[0];

    assert.ok(maximumFilterDifference(revisedTaps, freshTaps) < 1e-7);
});

test('low-frequency octave-window FFT analysis handles a wide extension band', () => {
    const source = lowFrequencyAllPassSource('low-phase-work-budget');
    const overrides = {
        taps: 131072,
        directWindowMs: 50,
        lowFrequency: 20,
        highFrequency: 16000,
        phaseLowFrequency: 16000
    };
    const enabled = lowPhaseExtensionDesign(source, {
        ...overrides,
        lowFrequencyPhaseExtension: true
    });

    assert.ok(enabled.channels[0].every(Number.isFinite));
    assert.notEqual(
        enabled.diagnostics.lowFrequencyPhaseExtension[0].reason,
        'dftWorkBudget'
    );
});

test('zero phase correction skips low-frequency extension analysis', () => {
    const source = lowFrequencyAllPassSource('low-phase-zero-amount');
    const counts = { real: 0, inverse: 0 };
    setRoomEqFftBackend(countingFftBackend(counts));
    try {
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
        const disabled = lowPhaseExtensionDesign(source, {
            phaseCorrectionAmount: 0
        });
        const disabledCounts = { ...counts };

        counts.real = 0;
        counts.inverse = 0;
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
        const enabled = lowPhaseExtensionDesign(structuredClone(source), {
            lowFrequencyPhaseExtension: true,
            phaseCorrectionAmount: 0
        });

        assert.deepEqual(enabled.channels[0], disabled.channels[0]);
        assert.deepEqual(counts, disabledCounts);
        assert.deepEqual(enabled.diagnostics.lowFrequencyPhaseExtension[0], {
            state: 'disabled',
            scale: 0,
            reason: 'phaseCorrectionDisabled'
        });
    } finally {
        setRoomEqFftBackend(null);
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
    }
});

test('low-frequency phase extension keeps a stress candidate inside FIR energy limits', () => {
    const source = lowFrequencyAllPassCascadeSource('low-phase-fir-safety', -0.98, 128);
    try {
        clearRoomEqAnalysisCache();
        const disabled = lowPhaseExtensionDesign(source);
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
        const enabled = lowPhaseExtensionDesign(source, {
            lowFrequencyPhaseExtension: true
        });
        const edge = filterEnergyProfile(enabled.channels[0]);
        const baselineEdge = filterEnergyProfile(disabled.channels[0]);

        assert.ok(edge <= Math.max(0.002, baselineEdge * 1.05 + 1e-8));
        assert.notDeepEqual(enabled.channels[0], disabled.channels[0]);
        const diagnostic = enabled.diagnostics.lowFrequencyPhaseExtension[0];
        assert.deepEqual(diagnostic, { state: 'applied', scale: 1, reason: null });
    } finally {
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
    }
});

test('whole-design cache returns independent result arrays', () => {
    clearRoomEqDesignCache();
    const request = {
        config: { sampleRate: 48000, taps: 8192, phase: 'lin' },
        sources: [{ measurement: flatLegacyMeasurement(), impulses: [] }]
    };
    const first = designRoomEq(request);
    const second = designRoomEq(request);
    assert.notEqual(first.channels[0].buffer, second.channels[0].buffer);
    const expected = second.channels[0][4096];
    first.channels[0][4096] = 123;
    second.channels[0][4096] = 456;
    const third = designRoomEq(request);
    assert.equal(third.channels[0][4096], expected);
});

test('design worker preserves low-phase fallback diagnostics across postMessage', async () => {
    const messages = [];
    await withGlobals({
        console: createConsoleHarness({ warn() {} }),
        onmessage: undefined,
        postMessage(message, transferables = []) {
            messages.push(structuredClone(message, { transfer: transferables }));
        }
    }, async () => {
        try {
            await import(`../../js/room-eq/design-worker.js?test=${Date.now()}`);
            await globalThis.onmessage({
                data: structuredClone({
                    type: 'design',
                    requestId: 1,
                    config: lowPhaseExtensionConfig({
                        taps: 131072,
                        directWindowMs: 50,
                        lowFrequency: 20,
                        phaseLowFrequency: 16000,
                        lowFrequencyPhaseExtension: true
                    }),
                    sources: [lowFrequencyAllPassSource('worker-low-phase-budget')]
                })
            });
            await globalThis.onmessage({
                data: structuredClone({
                    type: 'design',
                    requestId: 2,
                    config: lowPhaseExtensionConfig({
                        lowFrequencyPhaseExtension: true
                    }),
                    sources: [lowFrequencyAllPassCascadeSource(
                        'worker-low-phase-reduced',
                        -0.98,
                        128
                    )]
                })
            });

            assert.deepEqual(messages.map(message => ({
                requestId: message.requestId,
                diagnostic: message.diagnostics.lowFrequencyPhaseExtension[0]
            })), [
                {
                    requestId: 1,
                    diagnostic: {
                        state: 'reduced',
                        scale: 0.9873046875,
                        reason: 'groupDelay'
                    }
                },
                {
                    requestId: 2,
                    diagnostic: { state: 'applied', scale: 1, reason: null }
                }
            ]);
        } finally {
            setRoomEqFftBackend(null);
            clearRoomEqAnalysisCache();
            clearRoomEqDesignCache();
        }
    });
});

// ---------------------------------------------------------------------------
// Room EQ reverb correction (Phase 1) — plan.md §5 Phase 1 gates.
//
// Fixture helpers below carry the same arithmetic as the Phase 0 golden harvest
// (tmp/dev/room-eq-reverb-correction-impl-20260819/golden-fixture-source.mjs);
// tests must never import from tmp/ at runtime (tracked-depends-on-ignored trap).
// The only structural difference is that the per-point descriptor lookup is split
// out of makeFixtureImpulseData, so §6.2 can render off-position points that are
// not in the golden matrix. Renders for the golden point indices are unchanged.
// Golden digests were harvested on Node v22.23.2 (win32-x64) from the pre-Phase-1
// working tree; golden comparison requires a Node 22 runtime (V8 transcendental
// functions are implementation-defined across majors).
// ---------------------------------------------------------------------------

const GOLDEN_FIXTURE_SPEC = Object.freeze({
    sampleRate: 96000,
    length: 65536,
    onsetIndex: 512,
    directLowpassHz: 7000,
    directKernelTerms: 64,
    // [delayMs, amplitude]
    reflections: [[3.0, 0.32], [11.6, -0.24], [27.9, 0.18], [45.3, -0.12], [97.0, 0.07]],
    // [frequencyHz, t60Seconds, amplitude]
    modes: [[45, 0.45, 0.04], [72, 0.55, 0.03], [110, 0.35, 0.035]],
    allpass: { gain: 0.6, delayMs: 8, terms: 41 },
    // Deterministic per-point off-position perturbations, index = pointIndex (0-based).
    points: [
        { delayOffsetMs: 0, modeScale: 1, reflectionAmplitudeScale: 1 },
        { delayOffsetMs: 0.21, modeScale: 1.021, reflectionAmplitudeScale: 0.95 },
        { delayOffsetMs: -0.27, modeScale: 0.976, reflectionAmplitudeScale: 1.05 }
    ]
});

function makeGoldenImpulseData(pointIndex) {
    const point = GOLDEN_FIXTURE_SPEC.points[pointIndex];
    if (!point) throw new RangeError(`unknown fixture point index ${pointIndex}`);
    return makeFixtureImpulseData(point);
}

// Renders the fixture at one listening position, described by
// { delayOffsetMs, modeScale, reflectionAmplitudeScale }. The golden matrix uses
// the three descriptors in GOLDEN_FIXTURE_SPEC.points; §6.2 uses off-position
// descriptors that are deliberately outside that set.
function makeFixtureImpulseData(point) {
    const spec = GOLDEN_FIXTURE_SPEC;
    const rate = spec.sampleRate;
    const onset = spec.onsetIndex;
    const dry = new Float64Array(spec.length);

    // Direct-sound kernel: one-pole lowpass impulse response (1 - a) * a^n.
    const pole = Math.exp(-2 * Math.PI * spec.directLowpassHz / rate);
    const kernel = new Float64Array(spec.directKernelTerms);
    for (let term = 0; term < kernel.length; term += 1) {
        kernel[term] = (1 - pole) * Math.pow(pole, term);
    }
    const addKernel = (startIndex, amplitude) => {
        for (let term = 0; term < kernel.length; term += 1) {
            const index = startIndex + term;
            if (index >= dry.length) break;
            dry[index] += amplitude * kernel[term];
        }
    };

    addKernel(onset, 1);
    for (const [delayMs, amplitude] of spec.reflections) {
        const delay = Math.round((delayMs + point.delayOffsetMs) * rate / 1000);
        addKernel(onset + delay, amplitude * point.reflectionAmplitudeScale);
    }

    // Room modes: decaying sines starting at the onset.
    for (const [frequency, t60, amplitude] of spec.modes) {
        const decay = Math.log(1000) / t60;
        const omega = 2 * Math.PI * frequency * point.modeScale;
        for (let index = onset; index < dry.length; index += 1) {
            const time = (index - onset) / rate;
            dry[index] += amplitude * Math.exp(-decay * time) * Math.sin(omega * time);
        }
    }

    // First-order allpass tail: h_ap = -g*delta + (1-g^2) * sum_{k>=1} g^(k-1) * delta(t-k*tau).
    const gain = spec.allpass.gain;
    const delay = Math.round(spec.allpass.delayMs * rate / 1000);
    const wet = new Float64Array(spec.length);
    for (let index = 0; index < wet.length; index += 1) {
        let value = -gain * dry[index];
        let coefficient = 1 - gain * gain;
        for (let term = 1; term <= spec.allpass.terms; term += 1) {
            const source = index - term * delay;
            if (source < 0) break;
            value += coefficient * dry[source];
            coefficient *= gain;
        }
        wet[index] = value;
    }
    return Float32Array.from(wet);
}

// Builds a designRoomEq source entry with `pointCount` measurement points (1..3).
function makeGoldenSource(pointCount) {
    const spec = GOLDEN_FIXTURE_SPEC;
    if (!Number.isInteger(pointCount) || pointCount < 1 || pointCount > spec.points.length) {
        throw new RangeError(`pointCount must be 1..${spec.points.length}`);
    }
    const measurement = {
        id: 'reverb-golden-fixture',
        timestamp: 'fixed',
        points: Array.from({ length: pointCount }, (unused, index) =>
            ({ pointId: index + 1, timestamp: 'fixed' })),
        averageFrequencyResponse: []
    };
    return {
        measurement,
        impulses: Array.from({ length: pointCount }, (unused, index) => ({
            measurementId: measurement.id,
            pointId: index + 1,
            sampleRate: spec.sampleRate,
            onsetIndex: spec.onsetIndex,
            refScale: 1,
            data: makeGoldenImpulseData(index)
        }))
    };
}

// Room EQ reverb-correction golden digests for the portable amplitude and latency
// contracts (plan.md section 6.4).
// Harvested from the pre-Phase-1 working tree with v22.23.2 (win32-x64) on 2026-08-19T00:37:54.792Z.
// design-core.js sha256 at harvest: 5832ae8f17b4bff5ee3ad106ab1f1eb6ce116e3ee3fd1a293ee56490fcf277c4
// Digest canon: baseCorrectionDb is sha256 over concat of "pv<i>:<len>:" and the
// little-endian Float32 bytes per preview ("pv<i>:null" when absent); latencyInfo is
// sha256 of JSON.stringify({filterDelaySamples, resolutionHz}). Exact FIR tap hashes
// are intentionally excluded because supported V8 versions can differ in Math output.
const ROOM_EQ_REVERB_GOLDEN = {
    'min-default-multi': {
        baseCorrectionDb: '8be80392b9459a1e3ecd43e1d6eed59da9a2e8998bf39e6f2c8d01a2d69a6a41',
        latencyInfo: 'a291b85d108d0fe374c49b11fba437d0470521c8e052e5c89197f2257ed3f8f1'
    },
    'min-default-single': {
        baseCorrectionDb: 'a066d41b194d59b94178b872bd150149ceba4c7a6e690b3c80c7eb1e1b2f3c7f',
        latencyInfo: 'a291b85d108d0fe374c49b11fba437d0470521c8e052e5c89197f2257ed3f8f1'
    },
    'lin-default-multi': {
        baseCorrectionDb: '8be80392b9459a1e3ecd43e1d6eed59da9a2e8998bf39e6f2c8d01a2d69a6a41',
        latencyInfo: '09dcd5431d1494a6a513daa19b157f524a12e01b15858f20cdc0a782f31ed60d'
    },
    'lin-default-single': {
        baseCorrectionDb: 'a066d41b194d59b94178b872bd150149ceba4c7a6e690b3c80c7eb1e1b2f3c7f',
        latencyInfo: '09dcd5431d1494a6a513daa19b157f524a12e01b15858f20cdc0a782f31ed60d'
    },
    'full-default-multi': {
        baseCorrectionDb: '8be80392b9459a1e3ecd43e1d6eed59da9a2e8998bf39e6f2c8d01a2d69a6a41',
        latencyInfo: '09dcd5431d1494a6a513daa19b157f524a12e01b15858f20cdc0a782f31ed60d'
    },
    'full-default-single': {
        baseCorrectionDb: 'a066d41b194d59b94178b872bd150149ceba4c7a6e690b3c80c7eb1e1b2f3c7f',
        latencyInfo: '09dcd5431d1494a6a513daa19b157f524a12e01b15858f20cdc0a782f31ed60d'
    },
    'full-le-plfixed-multi': {
        baseCorrectionDb: '8be80392b9459a1e3ecd43e1d6eed59da9a2e8998bf39e6f2c8d01a2d69a6a41',
        latencyInfo: '09dcd5431d1494a6a513daa19b157f524a12e01b15858f20cdc0a782f31ed60d'
    },
    'full-le-auto-single': {
        baseCorrectionDb: 'a066d41b194d59b94178b872bd150149ceba4c7a6e690b3c80c7eb1e1b2f3c7f',
        latencyInfo: '09dcd5431d1494a6a513daa19b157f524a12e01b15858f20cdc0a782f31ed60d'
    },
    'full-sm030-multi': {
        baseCorrectionDb: '86a198ef8ed130513fca4b1e4a3f26e450b92431ffe5c4807b80e3d3410e94d1',
        latencyInfo: '09dcd5431d1494a6a513daa19b157f524a12e01b15858f20cdc0a782f31ed60d'
    },
    'full-pr0-multi': {
        baseCorrectionDb: '8be80392b9459a1e3ecd43e1d6eed59da9a2e8998bf39e6f2c8d01a2d69a6a41',
        latencyInfo: '09dcd5431d1494a6a513daa19b157f524a12e01b15858f20cdc0a782f31ed60d'
    }
};

// Room EQ portable golden digests for the SHIPPED rv > 0 output (plan.md section 6.4).
// The matrix above deliberately carries no reverb config keys (S-26 bit-identity),
// so these cases exercise the shipped defaults (rf 250, rw 300, rs 0.05, sm 0.17),
// including the LFE/reverb overlap path. Stable artifacts are pinned exactly, while
// FIR taps are compared to the matching rv=0 design in the same runtime. This avoids
// treating supported V8 Math differences as product regressions.
//   full-rv100-le-single      : 1 point, le = true -> LFE x reverb phase correction
//   full-rv100-multi          : 3 points -> reliability-weighted delay consensus
//   full-rv100-taps8192-multi : 3 points at the smallest taps the plugin offers.
//                               R3-1: the Consensus average synthesizes its buffer
//                               out to taps/2 + a window past the onset, so at
//                               taps = 8192 (and only there, of the offered counts)
//                               a display-window rule leaking into that length
//                               pushes nextPowerOfTwo(length) from 8192 to 16384 and
//                               retunes the analysis bin grid the whole phase path
//                               reads -- worth 0.0147 peak on channels[0] against an
//                               RMS of 0.0156. Nothing else in the matrix is on a
//                               power-of-two boundary, so this is the case that sees
//                               it. Its premises differ from the two above because the
//                               short realized FIR trips the filter-accuracy warning.
// Stable digests were validated with v22.23.2 and v24.13.0 (win32-x64) on 2026-08-25.
// R4-1: full-rv100-le-single and full-rv100-taps8192-multi pin phaseResponse. The
// taps8192 case also pins groupDelayResponse; the longer design's group-delay trace
// includes the same V8-sensitive minimum-phase math as its taps and is checked by the
// portable decomposition and behavior tests below instead.
// full-rv100-multi deliberately carries no trace digests: taps8192 is the multi-point
// case whose phase path sits on the nextPowerOfTwo boundary, so it is the sensitive
// one, and a second multi-point harvest would only add maintenance weight.
const ROOM_EQ_REVERB_RV_GOLDEN = {
    'full-rv100-le-single': {
        points: 1,
        overrides: { phase: 'full', reverbAmount: 1, lowFrequencyPhaseExtension: true },
        effectiveWindowMs: 300,
        qualityWarnings: [],
        baseCorrectionDb: 'a066d41b194d59b94178b872bd150149ceba4c7a6e690b3c80c7eb1e1b2f3c7f',
        latencyInfo: '09dcd5431d1494a6a513daa19b157f524a12e01b15858f20cdc0a782f31ed60d',
        phaseResponse: 'e993c725eef8aab99af29232c643502fbb7da4232dd1477aa0992479536b46ce'
    },
    'full-rv100-multi': {
        points: 3,
        overrides: { phase: 'full', reverbAmount: 1 },
        effectiveWindowMs: 300,
        qualityWarnings: [],
        baseCorrectionDb: '8be80392b9459a1e3ecd43e1d6eed59da9a2e8998bf39e6f2c8d01a2d69a6a41',
        latencyInfo: '09dcd5431d1494a6a513daa19b157f524a12e01b15858f20cdc0a782f31ed60d'
    },
    'full-rv100-taps8192-multi': {
        points: 3,
        overrides: { phase: 'full', taps: 8192, reverbAmount: 1 },
        effectiveWindowMs: 300,
        qualityWarnings: ['filterAccuracy'],
        baseCorrectionDb: '8be80392b9459a1e3ecd43e1d6eed59da9a2e8998bf39e6f2c8d01a2d69a6a41',
        latencyInfo: 'd7ba684fc4ca4ae7bbe39029a4083708892a5e5aeb1469ce170db863461a320b',
        phaseResponse: 'd68b606ab5a44b17b3ef3107d88b381aed5b52f6dc0f909db892afc39eed776f',
        groupDelayResponse:
            '3286f2242d0a660398f1e52ad184a6bb6baa4f86a675ccf934ccf3e3b4ad2718'
    }
};

// Base config mirrors room_eq.js plugin defaults (_designConfig), except sampleRate 96000
// (project baseline) and taps 65536 (plan.md section 6.1 dimension rule).
const REVERB_GOLDEN_BASE_CONFIG = Object.freeze({
    sampleRate: 96000,
    taps: 65536,
    smoothing: 0.17,
    lowFrequency: 20,
    highFrequency: 16000,
    directWindowMs: 6,
    phaseLowFrequency: null,
    lowFrequencyPhaseExtension: false,
    maxBoostDb: 6,
    correctionAmount: 1,
    phaseCorrectionAmount: 1,
    referencePoint: 0,
    eqBands: []
});

const REVERB_FIXTURE_RATE = GOLDEN_FIXTURE_SPEC.sampleRate;

// Both caches are cleared before every design so no cached clone can trivially
// satisfy a comparison (plan.md §5 Phase 1 cache policy).
function designReverbCase(overrides, pointCount) {
    clearRoomEqDesignCache();
    clearRoomEqAnalysisCache();
    return designRoomEq({
        config: { ...REVERB_GOLDEN_BASE_CONFIG, ...overrides },
        sources: [makeGoldenSource(pointCount)]
    });
}

function makeWindowBoundaryReflectionSource(delayMs) {
    const sampleRate = 48000;
    const onsetIndex = 256;
    const data = new Float32Array(onsetIndex + Math.round(sampleRate * 0.4));
    data[onsetIndex] = 1;
    if (delayMs !== null) {
        data[onsetIndex + Math.round(sampleRate * delayMs / 1000)] = 0.5;
    }
    const measurement = {
        id: `window-boundary-${delayMs}`,
        timestamp: 'fixed',
        points: [{ pointId: 0, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    return {
        measurement,
        impulses: [{
            measurementId: measurement.id,
            pointId: 0,
            sampleRate,
            onsetIndex,
            refScale: 1,
            data
        }]
    };
}

function designWindowBoundaryCase(source, overrides) {
    clearRoomEqAnalysisCache();
    clearRoomEqDesignCache();
    return designRoomEq({
        config: {
            sampleRate: 48000,
            taps: 32768,
            smoothing: 0.3,
            lowFrequency: 29,
            highFrequency: 16000,
            directWindowMs: 6,
            phase: 'full',
            phaseCorrectionAmount: 1,
            lowFrequencyPhaseExtension: false,
            reverbAmount: 0,
            reverbWindowMs: 300,
            reverbMaxFrequency: 250,
            reverbSmoothing: 0.05,
            correctionAmount: 0,
            referencePoint: 1,
            eqBands: [],
            ...overrides
        },
        sources: [source]
    });
}

test('Direct and Reverb Window retain response until their terminal taper', () => {
    const withoutReflection = makeWindowBoundaryReflectionSource(null);
    const directReflection = makeWindowBoundaryReflectionSource(4.5);
    const directExcluded = designWindowBoundaryCase(directReflection, {
        taps: 8192,
        directWindowMs: 4
    });
    const directExcludedReference = designWindowBoundaryCase(withoutReflection, {
        taps: 8192,
        directWindowMs: 4
    });
    const directIncluded = designWindowBoundaryCase(directReflection, {
        taps: 8192,
        directWindowMs: 6
    });
    const directIncludedReference = designWindowBoundaryCase(withoutReflection, {
        taps: 8192,
        directWindowMs: 6
    });
    assert.equal(maximumFilterDifference(
        directExcluded.channels[0],
        directExcludedReference.channels[0]
    ), 0);
    assert.ok(maximumFilterDifference(
        directIncluded.channels[0],
        directIncludedReference.channels[0]
    ) > 5e-6);

    const reverbReflection = makeWindowBoundaryReflectionSource(280);
    const reverbExcluded = designWindowBoundaryCase(reverbReflection, {
        phaseCorrectionAmount: 0,
        reverbAmount: 1,
        reverbWindowMs: 260
    });
    const reverbExcludedReference = designWindowBoundaryCase(withoutReflection, {
        phaseCorrectionAmount: 0,
        reverbAmount: 1,
        reverbWindowMs: 260
    });
    const reverbIncluded = designWindowBoundaryCase(reverbReflection, {
        phaseCorrectionAmount: 0,
        reverbAmount: 1,
        reverbWindowMs: 300
    });
    const reverbIncludedReference = designWindowBoundaryCase(withoutReflection, {
        phaseCorrectionAmount: 0,
        reverbAmount: 1,
        reverbWindowMs: 300
    });
    assert.equal(maximumFilterDifference(
        reverbExcluded.channels[0],
        reverbExcludedReference.channels[0]
    ), 0);
    assert.ok(maximumFilterDifference(
        reverbIncluded.channels[0],
        reverbIncludedReference.channels[0]
    ) > 5e-4);
});

const sha256Hex = buffers => {
    const hash = createHash('sha256');
    for (const buffer of buffers) hash.update(buffer);
    return hash.digest('hex');
};
const float32Bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const digestChannels = channels => sha256Hex(channels.flatMap((channel, index) =>
    [Buffer.from(`ch${index}:${channel.length}:`), float32Bytes(channel)]));
const digestBaseCorrection = previews => sha256Hex(previews.flatMap((preview, index) => preview
    ? [Buffer.from(`pv${index}:${preview.baseCorrectionDb.length}:`),
        float32Bytes(preview.baseCorrectionDb)]
    : [Buffer.from(`pv${index}:null`)]));
const digestLatencyInfo = latencyInfo => sha256Hex([Buffer.from(JSON.stringify({
    filterDelaySamples: latencyInfo.filterDelaySamples,
    resolutionHz: latencyInfo.resolutionHz
}))]);
// Same canon, extended to the two display traces S-38 lists as shipped artifacts:
// a "<prefix><preview index>:<trace name>:<length>:" label followed by the
// little-endian Float32 bytes, and "<prefix><preview index>:null" when the whole
// trace object is absent (phase === 'min' designs carry none).
const digestPhaseResponse = previews => sha256Hex(previews.flatMap((preview, index) => {
    const phase = preview && preview.phaseResponse;
    return phase
        ? [Buffer.from(`ph${index}:before:${phase.before.length}:`),
            float32Bytes(phase.before),
            Buffer.from(`ph${index}:after:${phase.after.length}:`),
            float32Bytes(phase.after)]
        : [Buffer.from(`ph${index}:null`)];
}));
const digestGroupDelayResponse = previews => sha256Hex(previews.flatMap((preview, index) => {
    const groupDelay = preview && preview.groupDelayResponse;
    if (!groupDelay) return [Buffer.from(`gd${index}:null`)];
    return [
        ['before', groupDelay.before],
        ['after', groupDelay.after],
        ['minimum.before', groupDelay.minimum.before],
        ['minimum.after', groupDelay.minimum.after],
        ['excess.before', groupDelay.excess.before],
        ['excess.after', groupDelay.excess.after]
    ].flatMap(([name, trace]) =>
        [Buffer.from(`gd${index}:${name}:${trace.length}:`), float32Bytes(trace)]);
}));

function productSpectrum(a, b) {
    const real = new Float64Array(a.real.length);
    const imag = new Float64Array(a.real.length);
    for (let bin = 0; bin < real.length; bin += 1) {
        real[bin] = a.real[bin] * b.real[bin] - a.imag[bin] * b.imag[bin];
        imag[bin] = a.real[bin] * b.imag[bin] + a.imag[bin] * b.real[bin];
    }
    return { real, imag };
}

// Minimum-phase counterpart of a spectrum's magnitude via the real cepstrum.
// Returns the per-bin minimum phase (radians) for bins 0..fftSize/2.
function minimumPhaseFor(spectrum, fftSize) {
    const half = fftSize / 2;
    const logMagnitude = new Float64Array(half + 1);
    for (let bin = 0; bin <= half; bin += 1) {
        logMagnitude[bin] = Math.log(Math.max(1e-12,
            Math.hypot(spectrum.real[bin], spectrum.imag[bin])));
    }
    const fft = new FFT(fftSize);
    const cepstrum = fft.inverseRealTransform(logMagnitude);
    for (let index = 1; index < half; index += 1) cepstrum[index] *= 2;
    for (let index = half + 1; index < fftSize; index += 1) cepstrum[index] = 0;
    return fft.realTransform(cepstrum).imag;
}

// Unwraps a wrapped per-bin phase series over [low, high] Hz, removes the
// least-squares linear fit (constant + slope in omega), and returns the residual
// series with its RMS and max (plan.md §5 band-gate observation rule).
// The fit itself is returned alongside: `intercept` is the band's constant phase
// term (radians) and `slope` its d(phase)/d(omega), i.e. a mean group delay of
// -slope seconds. Both are physical -- a constant rotation is not a delay and a
// delay is not a rotation -- so gates that must see a term the residual removes
// by construction judge them directly instead of re-deriving them.
function detrendedPhaseResidual(wrappedPhaseAt, fftSize, lowFrequency, highFrequency) {
    const half = fftSize / 2;
    const points = [];
    let offset = 0;
    let previous = 0;
    for (let bin = 1; bin <= half; bin += 1) {
        const frequency = bin * REVERB_FIXTURE_RATE / fftSize;
        if (frequency < lowFrequency || frequency > highFrequency) continue;
        const wrapped = wrappedPhaseAt(bin);
        if (points.length) {
            let difference = wrapped + offset - previous;
            while (difference > Math.PI) { offset -= 2 * Math.PI; difference -= 2 * Math.PI; }
            while (difference < -Math.PI) { offset += 2 * Math.PI; difference += 2 * Math.PI; }
        }
        const unwrapped = wrapped + offset;
        previous = unwrapped;
        points.push([2 * Math.PI * frequency, unwrapped]);
    }
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (const [x, y] of points) {
        sumX += x;
        sumY += y;
        sumXX += x * x;
        sumXY += x * y;
    }
    const count = points.length;
    const denominator = count * sumXX - sumX * sumX;
    const slope = denominator === 0 ? 0 : (count * sumXY - sumX * sumY) / denominator;
    const intercept = count === 0 ? 0 : (sumY - slope * sumX) / count;
    let squared = 0;
    let max = 0;
    const residuals = points.map(([x, y]) => {
        const residual = y - intercept - slope * x;
        squared += residual * residual;
        if (Math.abs(residual) > max) max = Math.abs(residual);
        return residual;
    });
    return {
        rms: Math.sqrt(squared / (count || 1)), max, residuals, count, slope, intercept,
        // Mean group delay of the band, in milliseconds.
        meanGroupDelayMs: -slope * 1000
    };
}

// Excess phase (total minus minimum phase) residual of a response spectrum.
const excessPhaseResidual = (spectrum, minimumPhase, fftSize, lowFrequency, highFrequency) =>
    detrendedPhaseResidual(bin => {
        const phase = Math.atan2(spectrum.imag[bin], spectrum.real[bin]) - minimumPhase[bin];
        return Math.atan2(Math.sin(phase), Math.cos(phase));
    }, fftSize, lowFrequency, highFrequency);

// Phase difference angle(A · conj(B)) residual between two tap spectra.
const crossPhaseResidual = (spectrumA, spectrumB, fftSize, lowFrequency, highFrequency) =>
    detrendedPhaseResidual(bin => Math.atan2(
        spectrumA.imag[bin] * spectrumB.real[bin] - spectrumA.real[bin] * spectrumB.imag[bin],
        spectrumA.real[bin] * spectrumB.real[bin] + spectrumA.imag[bin] * spectrumB.imag[bin]
    ), fftSize, lowFrequency, highFrequency);

// Excess group-delay ripple (RMS of interval delays of the detrended residual), in ms.
function groupDelayRippleMs(residuals, fftSize) {
    const deltaOmega = 2 * Math.PI * REVERB_FIXTURE_RATE / fftSize;
    let squared = 0;
    for (let index = 1; index < residuals.length; index += 1) {
        const delay = -(residuals[index] - residuals[index - 1]) / deltaOmega;
        squared += delay * delay;
    }
    return Math.sqrt(squared / (residuals.length - 1)) * 1000;
}

test('room eq reverb defaults preserve the legacy amplitude and latency contracts', () => {
    // The group-delay phase estimator has intentionally changed since these
    // pre-Reverb fixtures were harvested, and minimum-phase tap hashes also vary
    // across supported V8 math implementations. The Reverb feature must still
    // preserve the stable contracts it does not own: the full-IR amplitude target
    // and the reported latency.
    const cases = [
        ['min-default-multi', 3, { phase: 'min' }],
        ['min-default-single', 1, { phase: 'min' }],
        ['lin-default-multi', 3, { phase: 'lin' }],
        ['lin-default-single', 1, { phase: 'lin' }],
        ['full-default-multi', 3, { phase: 'full' }],
        ['full-default-single', 1, { phase: 'full' }],
        ['full-le-plfixed-multi', 3,
            { phase: 'full', lowFrequencyPhaseExtension: true, phaseLowFrequency: 500 }],
        ['full-le-auto-single', 1, { phase: 'full', lowFrequencyPhaseExtension: true }],
        ['full-sm030-multi', 3, { phase: 'full', smoothing: 0.30 }],
        ['full-pr0-multi', 3, { phase: 'full', phaseCorrectionAmount: 0 }]
    ];
    for (const [caseId, pointCount, overrides] of cases) {
        const result = designReverbCase(overrides, pointCount);
        const golden = ROOM_EQ_REVERB_GOLDEN[caseId];
        assert.equal(digestBaseCorrection(result.previews), golden.baseCorrectionDb,
            `${caseId}: baseCorrectionDb digest`);
        assert.equal(digestLatencyInfo(result.latencyInfo), golden.latencyInfo,
            `${caseId}: latencyInfo digest`);
    }
});

test('shipped rv=100 default design preserves its portable golden contracts', () => {
    // Plan.md §6.4: pin the stable rv > 0 artifacts and compare the V8-sensitive FIR
    // against rv=0 in the same runtime. Each case also asserts the observables that
    // make it the case it was harvested for, so the checks cannot pass by silently
    // turning the reverb (or LFE) path off.
    let pinnedPhaseCases = 0;
    let pinnedGroupDelayCases = 0;
    for (const [caseId, golden] of Object.entries(ROOM_EQ_REVERB_RV_GOLDEN)) {
        const result = designReverbCase(golden.overrides, golden.points);
        const reverb = result.diagnostics.reverbCorrection[0];
        assert.equal(reverb.state, 'applied', `${caseId}: premise: reverb applied`);
        assert.equal(reverb.scale, 1, `${caseId}: premise: full ladder scale`);
        assert.equal(reverb.effectiveWindowMs, golden.effectiveWindowMs,
            `${caseId}: premise: rw_eff`);
        assert.deepEqual(result.qualityWarnings, golden.qualityWarnings,
            `${caseId}: premise: quality warnings`);
        // The preview window follows the reverb window (2 ms preroll + min(rw, 50) ms
        // at 96 kHz = 192 + 4800), so the shipped tail really is visible.
        assert.equal(result.previews[0].impulseResponse.after.length, 4992,
            `${caseId}: premise: preview covers the reverb window`);
        if (golden.overrides.lowFrequencyPhaseExtension) {
            assert.notEqual(result.diagnostics.lowFrequencyPhaseExtension[0].state, 'disabled',
                `${caseId}: premise: LFE engages alongside the reverb correction`);
        }
        if (golden.points > 1) {
            assert.ok(reverb.agreementMinimum < 1,
                `${caseId}: premise: the agreement diagnostic detects disagreement `
                + `(${reverb.agreementMinimum})`);
        }
        const withoutReverb = designReverbCase(
            { ...golden.overrides, reverbAmount: 0 }, golden.points);
        assert.notEqual(digestChannels(result.channels), digestChannels(withoutReverb.channels),
            `${caseId}: reverb must alter the FIR taps`);
        assert.equal(digestBaseCorrection(result.previews), golden.baseCorrectionDb,
            `${caseId}: baseCorrectionDb digest`);
        assert.equal(digestLatencyInfo(result.latencyInfo), golden.latencyInfo,
            `${caseId}: latencyInfo digest`);
        // S-38 lists phaseResponse and groupDelayResponse among the shipped artifacts
        // that the display window must not move, but every other phase test here only
        // constrains relations (lengths, deltas, minimum + excess === total), so their
        // absolute values were unpinned: the whole displayed trace could be rebuilt
        // from a different (shorter, rescaled) source with the suite still green.
        // Pinned on the single-point LFE case and on the taps = 8192 Consensus case,
        // which is the one whose phase path sits on the nextPowerOfTwo boundary.
        if (golden.phaseResponse) {
            pinnedPhaseCases += 1;
            assert.equal(digestPhaseResponse(result.previews), golden.phaseResponse,
                `${caseId}: phaseResponse digest`);
        }
        if (golden.groupDelayResponse) {
            pinnedGroupDelayCases += 1;
            assert.equal(digestGroupDelayResponse(result.previews),
                golden.groupDelayResponse, `${caseId}: groupDelayResponse digest`);
        }
    }
    // Count the pinned cases so deleting a digest from the table above fails here
    // instead of silently turning the check off.
    assert.equal(pinnedPhaseCases, 2,
        'exactly two cases must pin the phase display trace');
    assert.equal(pinnedGroupDelayCases, 1,
        'exactly one portable case must pin the group-delay display trace');
});

test('impulse response preview widens only for an active reverb window', () => {
    // Plan.md section 5 Phase 5 item 4 / section 7: the preview window is
    // max(5 ms, dw, rv > 0 ? min(rw, 50) : 0) plus a fixed 2 ms preroll, so the
    // cancelled reverberant tail is inside the displayed range. With rv = 0 the
    // window must stay exactly what it was before the reverb feature existed
    // (S-26), including when a reverb window is present in the config but unused.
    const durationOf = result => result.previews[0].impulseResponse.durationMs;
    const samplesOf = result => result.previews[0].impulseResponse.after.length;
    const rv0 = designReverbCase({ phase: 'full' }, 1);
    assert.equal(durationOf(rv0), 6, 'rv=0 keeps the direct-window display');
    assert.equal(samplesOf(rv0), 768);
    const rv0WithWindow = designReverbCase(
        { phase: 'full', reverbAmount: 0, reverbWindowMs: 300 }, 1);
    assert.equal(durationOf(rv0WithWindow), 6,
        'an unused reverb window must not widen the display');
    assert.equal(samplesOf(rv0WithWindow), samplesOf(rv0));
    const rv1 = designReverbCase({ phase: 'full', reverbAmount: 1 }, 1);
    assert.equal(durationOf(rv1), 50, 'rw=300 is capped at 50 ms');
    assert.equal(samplesOf(rv1), 4992);
    const rv1Short = designReverbCase(
        { phase: 'full', reverbAmount: 1, reverbWindowMs: 25 }, 1);
    assert.equal(durationOf(rv1Short), 25, 'a sub-cap reverb window is used as is');
    assert.equal(samplesOf(rv1Short), 2592);
    const rv1WideDirect = designReverbCase(
        { phase: 'full', reverbAmount: 1, reverbWindowMs: 25, directWindowMs: 40 }, 1);
    assert.equal(durationOf(rv1WideDirect), 40, 'the direct window still wins when larger');
});

test('reverb phase analysis cache does not leak across the direct-window path', () => {
    // The reverb path runs directPhaseAnalysis through the same `direct` object as
    // the direct-window path (analysis.directCache is keyed on the window alone), so
    // whenever a direct-window design's dw equals a reverb design's rw_eff every
    // remaining cache-key term can collide too. The two paths regrid the residual
    // differently (reverbResidualAggregation), so a key that omits that flag hands
    // one path the other's result. Judgment: designing one config after the other,
    // WITHOUT clearing the analysis cache, must reproduce the from-cold digests
    // exactly, in both orders.
    const directConfig = { phase: 'full', directWindowMs: 30, phaseSmoothing: 0.05 };
    const reverbConfig = {
        phase: 'full', reverbAmount: 1, reverbWindowMs: 30, reverbMaxFrequency: 20000
    };
    // Only the whole-design cache is cleared between designs here -- exactly what a
    // slider sweep in the UI does.
    const warm = overrides => {
        clearRoomEqDesignCache();
        return designRoomEq({
            config: { ...REVERB_GOLDEN_BASE_CONFIG, ...overrides },
            sources: [makeGoldenSource(1)]
        });
    };
    const coldDirect = designReverbCase(directConfig, 1);
    const coldReverb = designReverbCase(reverbConfig, 1);
    // Premise: the collision is real -- the reverb design's effective window equals
    // the direct design's window, and both paths are actually active.
    assert.equal(coldReverb.diagnostics.reverbCorrection[0].effectiveWindowMs,
        directConfig.directWindowMs,
        'premise: rw_eff must equal the direct design\'s dw for the keys to collide');
    assert.equal(coldReverb.diagnostics.reverbCorrection[0].state, 'applied');
    const coldDirectDigest = digestChannels(coldDirect.channels);
    const coldReverbDigest = digestChannels(coldReverb.channels);
    assert.notEqual(coldDirectDigest, coldReverbDigest,
        'premise: the two designs differ, so a swapped analysis is observable');

    clearRoomEqAnalysisCache();
    warm(reverbConfig);
    assert.equal(digestChannels(warm(directConfig).channels), coldDirectDigest,
        'the direct-window design must not inherit the reverb path analysis');

    clearRoomEqAnalysisCache();
    warm(directConfig);
    assert.equal(digestChannels(warm(reverbConfig).channels), coldReverbDigest,
        'the reverb design must not inherit the direct-window path analysis');
    clearRoomEqAnalysisCache();
    clearRoomEqDesignCache();
});

test('reverb correction reduces excess group-delay ripple on a non-minimum-phase fixture', () => {
    // Plan.md §5 Phase 1 directional gate: rf=20000 / rv=100 / pr=100 must reduce the
    // corrected response's excess group-delay ripple versus rv=0 (direction-only).
    // Judgment band 60-500 Hz: the fixture's allpass comb (tau=8ms, 125 Hz period) is
    // resolvable there by the rs=0.05 residual smoothing; cr=0 keeps the minimum-phase
    // reference amplitude-independent.
    const fftSize = 131072;
    const overrides = { phase: 'full', reverbMaxFrequency: 20000, correctionAmount: 0 };
    const withoutReverb = designReverbCase(overrides, 1);
    const withReverb = designReverbCase({ ...overrides, reverbAmount: 1 }, 1);

    // Premise: the reverb path actually engaged.
    assert.equal(withReverb.diagnostics.reverbCorrection[0].state, 'applied');

    // Premise: the fixture really contains a non-minimum-phase excess (G-3 guard) —
    // measured 29.3 ms ripple / 3.75 rad residual RMS at harvest calibration.
    const fixtureSpectrum = spectrumFor(makeGoldenSource(1).impulses[0].data, fftSize);
    const fixtureExcess = excessPhaseResidual(fixtureSpectrum,
        minimumPhaseFor(fixtureSpectrum, fftSize), fftSize, 60, 500);
    assert.ok(groupDelayRippleMs(fixtureExcess.residuals, fftSize) > 5,
        'fixture premise: excess group-delay ripple above threshold');
    assert.ok(fixtureExcess.rms > 0.5, 'fixture premise: excess residual RMS above threshold');

    // Judgment (direction-only): corrected-response excess ripple decreases with rv.
    const measure = taps => {
        const corrected = productSpectrum(fixtureSpectrum, spectrumFor(taps, fftSize));
        const residual = excessPhaseResidual(corrected,
            minimumPhaseFor(corrected, fftSize), fftSize, 60, 500);
        return { ripple: groupDelayRippleMs(residual.residuals, fftSize), rms: residual.rms };
    };
    const baseline = measure(withoutReverb.channels[0]);
    const corrected = measure(withReverb.channels[0]);
    assert.ok(corrected.ripple < baseline.ripple,
        `excess group-delay ripple must decrease (${corrected.ripple} vs ${baseline.ripple})`);
    assert.ok(corrected.rms < baseline.rms,
        `excess phase residual RMS must decrease (${corrected.rms} vs ${baseline.rms})`);
    // Frozen absolute thresholds (plan.md §5 Phase 4: the Phase 1-3
    // direction-only rv>0 gates are frozen from measurement at Phase 4
    // completion). Measured on Node v22.23.2, 2026-08-19: corrected ripple
    // 24.054 ms / RMS 0.6534 rad against baseline 29.304 ms / 3.7505 rad.
    assert.ok(corrected.ripple < 27,
        `corrected excess ripple exceeds the frozen budget (${corrected.ripple} ms)`);
    assert.ok(corrected.rms < 1.6,
        `corrected excess residual RMS exceeds the frozen budget (${corrected.rms} rad)`);
});

test('reverb correction mode separates from direct phase correction', () => {
    // Plan.md §5 Phase 1 mode-separation gate: mode a (pr=0/rv=100) must differ from
    // mode b (pr=100/rv=0) in the direct-window main part AND reduce reverb-band echo
    // energy versus the uncorrected pr=0/rv=0 baseline (direction-only).
    const fftSize = 262144;
    const overrides = { phase: 'full', reverbMaxFrequency: 20000, correctionAmount: 0 };
    const modeA = designReverbCase(
        { ...overrides, phaseCorrectionAmount: 0, reverbAmount: 1 }, 1);
    const modeB = designReverbCase(overrides, 1);
    const baseline = designReverbCase({ ...overrides, phaseCorrectionAmount: 0 }, 1);

    // Premises: reverb path engaged, and the fixture is non-minimum-phase (G-3).
    assert.equal(modeA.diagnostics.reverbCorrection[0].state, 'applied');
    const premiseSize = 131072;
    const premiseSpectrum = spectrumFor(makeGoldenSource(1).impulses[0].data, premiseSize);
    const premiseExcess = excessPhaseResidual(premiseSpectrum,
        minimumPhaseFor(premiseSpectrum, premiseSize), premiseSize, 60, 500);
    assert.ok(groupDelayRippleMs(premiseExcess.residuals, premiseSize) > 5,
        'fixture premise: excess group-delay ripple above threshold');

    const fixtureSpectrum = spectrumFor(makeGoldenSource(1).impulses[0].data, fftSize);
    const fft = new FFT(fftSize);
    const correctedProduct = taps => productSpectrum(fixtureSpectrum, spectrumFor(taps, fftSize));
    const timeResponse = product =>
        fft.inverseRealTransform(product.real.slice(), product.imag.slice());

    const productA = correctedProduct(modeA.channels[0]);
    const productB = correctedProduct(modeB.channels[0]);
    const productBase = correctedProduct(baseline.channels[0]);
    const responseA = timeResponse(productA);
    const responseB = timeResponse(productB);
    const responseBase = timeResponse(productBase);
    const peakA = dominantSampleIndex(responseA);
    const peakB = dominantSampleIndex(responseB);
    const peakBase = dominantSampleIndex(responseBase);

    // Separation 1: the direct-window main part differs between the two modes
    // (windows anchored at each response's own broadband peak).
    const directLength = Math.round(REVERB_FIXTURE_RATE * 6 / 1000);
    let maxDifference = 0;
    for (let index = 0; index < directLength; index += 1) {
        maxDifference = Math.max(maxDifference,
            Math.abs(responseA[peakA - 64 + index] - responseB[peakB - 64 + index]));
    }
    assert.ok(maxDifference > 0.05,
        `direct-window main part must differ between modes (${maxDifference})`);

    // Separation 2: reverb-band (60-500 Hz band-limited) echo energy in
    // [peak + 6 ms, peak + 300 ms] decreases under mode a versus the baseline.
    const bandLimitedEchoEnergy = (product, anchor) => {
        const half = fftSize / 2;
        const real = new Float64Array(half + 1);
        const imag = new Float64Array(half + 1);
        const low = 60;
        const high = 500;
        const flank = Math.cbrt(2);
        for (let bin = 0; bin <= half; bin += 1) {
            const frequency = bin * REVERB_FIXTURE_RATE / fftSize;
            let weight = 0;
            if (frequency >= low && frequency <= high) weight = 1;
            else if (frequency > low / flank && frequency < low) {
                weight = 0.5 - 0.5 * Math.cos(Math.PI
                    * Math.log(frequency / (low / flank)) / Math.log(flank));
            } else if (frequency > high && frequency < high * flank) {
                weight = 0.5 + 0.5 * Math.cos(Math.PI * Math.log(frequency / high) / Math.log(flank));
            }
            real[bin] = product.real[bin] * weight;
            imag[bin] = product.imag[bin] * weight;
        }
        const banded = fft.inverseRealTransform(real, imag);
        const start = anchor + directLength;
        const end = anchor + Math.round(REVERB_FIXTURE_RATE * 0.300);
        let energy = 0;
        for (let index = start; index < end; index += 1) energy += banded[index] * banded[index];
        return energy;
    };
    const echoA = bandLimitedEchoEnergy(productA, peakA);
    const echoBase = bandLimitedEchoEnergy(productBase, peakBase);
    assert.ok(echoA < echoBase,
        `reverb-band echo energy must decrease under mode a (${echoA} vs ${echoBase})`);
    // Frozen absolute threshold (plan.md §5 Phase 4). Measured on Node
    // v22.23.2, 2026-08-19: echoA 2.1732 against echoBase 2.4047.
    assert.ok(echoA < 2.3,
        `reverb-band echo energy exceeds the frozen budget (${echoA})`);
});

test('reverb correction stays inert above the reverb band (upper band gate)', () => {
    // Plan.md §5 Phase 1 upper band gate (fixed threshold): rf=250, cr=0, le=false —
    // the rv=0 vs rv=1 tap phase difference above 500 Hz must vanish (residual RMS
    // < 1e-3 rad) after removing a least-squares linear fit (constant = out-of-band
    // Delta plateau, slope = full timing alignment).
    const fftSize = 131072;
    const overrides = { phase: 'full', correctionAmount: 0 };
    const withoutReverb = designReverbCase(overrides, 1);
    const withReverb = designReverbCase({ ...overrides, reverbAmount: 1 }, 1);
    assert.equal(withReverb.diagnostics.reverbCorrection[0].state, 'applied');

    const spectrumWithout = spectrumFor(withoutReverb.channels[0], fftSize);
    const spectrumWith = spectrumFor(withReverb.channels[0], fftSize);

    // Premise: the reverb term actually alters the in-band (20-250 Hz) phase, so the
    // out-of-band zero is a real invariant, not a vacuous no-op (measured 0.79 rad RMS).
    const inBand = crossPhaseResidual(spectrumWith, spectrumWithout, fftSize, 20, 250);
    assert.ok(inBand.rms > 1e-2, `premise: in-band phase difference exists (${inBand.rms})`);

    const outOfBand = crossPhaseResidual(spectrumWith, spectrumWithout, fftSize,
        500, REVERB_FIXTURE_RATE * 0.45);
    assert.ok(outOfBand.rms < 1e-3,
        `above-band residual RMS must vanish (${outOfBand.rms})`);
});

test('reverb correction stays inert below the reverb band (lower band gate)', () => {
    // Plan.md §5 Phase 1 lower band gate (fixed threshold): fl=20, pl=20 (manual),
    // dw=40, rw=50, cr=0 — rw_eff=50 > dw=40 keeps the reverb path active (G-4 guard)
    // with C_ext low = max(20, 3000/50) = 60 Hz, so the judgment band 20-47.6 Hz
    // (below 60/2^(1/3), where W=0) must show no rv-induced phase difference.
    const fftSize = 131072;
    const overrides = {
        phase: 'full',
        lowFrequency: 20,
        phaseLowFrequency: 20,
        directWindowMs: 40,
        reverbWindowMs: 50,
        correctionAmount: 0
    };
    const withoutReverb = designReverbCase(overrides, 1);
    const withReverb = designReverbCase({ ...overrides, reverbAmount: 1 }, 1);
    const diagnostic = withReverb.diagnostics.reverbCorrection[0];
    assert.equal(diagnostic.state, 'applied');
    assert.equal(diagnostic.effectiveWindowMs, 50);

    // Premise (existence): C_dir is non-zero somewhere inside 20-47.6 Hz (C_dir side
    // low = max(1000/40, 20) = 25 Hz), i.e. a real victim for rv contamination exists.
    const withoutDirect = designReverbCase({ ...overrides, phaseCorrectionAmount: 0 }, 1);
    const spectrumWithout = spectrumFor(withoutReverb.channels[0], fftSize);
    const spectrumNoDirect = spectrumFor(withoutDirect.channels[0], fftSize);
    const directEffect = crossPhaseResidual(spectrumWithout, spectrumNoDirect, fftSize, 20, 47.6);
    assert.ok(directEffect.max > 1e-3,
        `premise: C_dir affects the judgment band (${directEffect.max})`);

    const spectrumWith = spectrumFor(withReverb.channels[0], fftSize);
    const belowBand = crossPhaseResidual(spectrumWith, spectrumWithout, fftSize, 20, 47.6);
    assert.ok(belowBand.rms < 1e-3,
        `below-band residual RMS must vanish (${belowBand.rms})`);
});

test('reverb correction disables as emptyBand when fl exceeds the reverb band', () => {
    // Plan.md §5 Phase 1 crossed-configuration gate: fl=500 with default rf=250 leaves
    // no reverb band; the output must be bit-identical to rv=0 and diagnostics must
    // report disabled/emptyBand (fixed judgment; missing the emptyBand check would let
    // the correctionWeight lower flank at 397-500 Hz integrate raw excess into Delta).
    const overrides = { phase: 'full', lowFrequency: 500 };
    const withoutReverb = designReverbCase(overrides, 1);
    const withReverb = designReverbCase({ ...overrides, reverbAmount: 1 }, 1);
    const diagnostic = withReverb.diagnostics.reverbCorrection[0];
    assert.equal(diagnostic.state, 'disabled');
    assert.equal(diagnostic.reason, 'emptyBand');
    assert.equal(diagnostic.effectiveWindowMs, 300);
    assert.equal(withReverb.channels.length, withoutReverb.channels.length);
    for (let channel = 0; channel < withReverb.channels.length; channel += 1) {
        const expected = withoutReverb.channels[channel];
        const actual = withReverb.channels[channel];
        assert.equal(actual.length, expected.length);
        for (let index = 0; index < actual.length; index += 1) {
            if (!Object.is(actual[index], expected[index])) {
                assert.fail(`channel ${channel} sample ${index} differs `
                    + `(${actual[index]} vs ${expected[index]})`);
            }
        }
    }
});

test('reverb phase difference scales linearly in rv without 2-pi contamination', () => {
    // Plan.md §5 Phase 1 2-pi gate: with two decorrelated points, a global 2-pi offset
    // in Delta is invisible at rv=100 (e^-jDelta is unchanged) but must surface as a
    // pi-class term at fractional rv. Judgment: the rv=50 correction phase
    // difference is half the rv=100 one (cr=0, le=false), judged on BOTH halves of
    // the linear fit and the residual it leaves:
    //   - the constant term (intercept), because a global 2-pi offset in Delta is
    //     purely constant and the detrended residual removes it by construction --
    //     this is the half that actually owns the 2-pi contamination;
    //   - the residual series, which owns every non-constant deviation.
    // Measured on Node v22.23.2, 2026-08-19: intercept error 6.39e-8 rad against the
    // 1e-3 limit (margin 1.6e4x) and linearity residual 1.1e-5 rad against 0.2.
    // A uniform 2-pi offset injected into Delta moves the intercept error to
    // pi (3.1416 rad) while leaving the residual untouched.
    const fftSize = 131072;
    const overrides = { phase: 'full', reverbMaxFrequency: 20000, correctionAmount: 0 };
    const rv0 = designReverbCase(overrides, 2);
    const rv50 = designReverbCase({ ...overrides, reverbAmount: 0.5 }, 2);
    const rv100 = designReverbCase({ ...overrides, reverbAmount: 1 }, 2);

    // Premise 1 (scale separation, A_ext machine check): the two points really are
    // decorrelated — an A_ext band below 0.9 exists. A wrong-scale implementation
    // (agreement on the synthesis-grid delta-omega) pins A_ext near 1 and fails here.
    for (const result of [rv50, rv100]) {
        const diagnostic = result.diagnostics.reverbCorrection[0];
        // Premise 2 (degeneracy-guard interference): both runs non-degenerate.
        assert.equal(diagnostic.state, 'applied');
        assert.equal(diagnostic.scale, 1);
        assert.ok(diagnostic.agreementMinimum < 0.9,
            `premise: decorrelated band exists (agreementMinimum ${diagnostic.agreementMinimum})`);
    }

    const spectrum0 = spectrumFor(rv0.channels[0], fftSize);
    const difference50 = crossPhaseResidual(spectrumFor(rv50.channels[0], fftSize),
        spectrum0, fftSize, 60, 20000);
    const difference100 = crossPhaseResidual(spectrumFor(rv100.channels[0], fftSize),
        spectrum0, fftSize, 60, 20000);
    assert.equal(difference50.residuals.length, difference100.residuals.length);
    let squared = 0;
    for (let index = 0; index < difference50.residuals.length; index += 1) {
        const residual = difference50.residuals[index] - 0.5 * difference100.residuals[index];
        squared += residual * residual;
    }
    const linearityRms = Math.sqrt(squared / difference50.residuals.length);
    // Premise 3: rv=100 produces a substantial phase difference (the ratio judgment
    // is not vacuous).
    assert.ok(difference100.rms > 0.1,
        `premise: rv=100 phase difference exists (${difference100.rms})`);
    assert.ok(linearityRms < 0.2,
        `rv linearity residual must stay far below pi (${linearityRms} rad)`);
    // Premise 4: the constant term is not degenerate -- rv=100 carries an O(1)
    // band-constant phase, so halving it is a real constraint.
    assert.ok(Math.abs(difference100.intercept) > 1,
        `premise: rv=100 constant phase term exists (${difference100.intercept} rad)`);
    const interceptError = Math.abs(
        difference50.intercept - 0.5 * difference100.intercept);
    assert.ok(interceptError < 1e-3,
        `rv constant phase term must scale linearly, not by 2-pi steps `
        + `(${interceptError} rad)`);
});

test('reverb correction stays finite with a 100 ms reflection and taps=131072', () => {
    // Plan.md §5 Phase 1 finiteness gate (unwrap margin): the fixture's 97 ms
    // reflection with rw=1000 and taps=131072. rw_eff is clamped by the available
    // post-onset window (65536-512)/96 = 677.33 ms, exercising the implicit clamp.
    const result = designReverbCase({
        phase: 'full',
        taps: 131072,
        reverbAmount: 1,
        reverbMaxFrequency: 20000,
        reverbWindowMs: 1000
    }, 1);
    const diagnostic = result.diagnostics.reverbCorrection[0];
    assert.equal(diagnostic.state, 'applied');
    // Available window: (fixture length 65536 - onsetIndex 512) samples / 96 kHz
    // = 65024/96 ms = 677.33 ms. Pinning the exact value ensures that the requested
    // 1000 ms observation does not silently read beyond the stored response.
    const availableWindowMs = (GOLDEN_FIXTURE_SPEC.length - GOLDEN_FIXTURE_SPEC.onsetIndex)
        / (GOLDEN_FIXTURE_SPEC.sampleRate / 1000);
    assert.ok(Math.abs(diagnostic.effectiveWindowMs - availableWindowMs) < 1e-9,
        `available-window clamp engaged: expected ${availableWindowMs} ms, `
        + `got ${diagnostic.effectiveWindowMs} ms`);
    assert.equal(result.channels[0].length, 131072);
    assert.ok(result.channels[0].every(Number.isFinite), 'all taps finite');

    setRoomEqFftBackend(null);
    clearRoomEqAnalysisCache();
    clearRoomEqDesignCache();
});

// Corrected time response of the fixture: fixture (x) taps, linear (fftSize
// 131072 >= 65536 + 65536, so nothing wraps).
function correctedTimeResponse(fixtureSpectrum, taps, fftSize) {
    const product = productSpectrum(fixtureSpectrum, spectrumFor(taps, fftSize));
    return new FFT(fftSize).inverseRealTransform(product.real, product.imag);
}

// Fraction of the corrected response's energy that arrives more than `guardMs`
// before the direct sound. The anchor is known exactly (the fixture's onset plus
// the filter's own delay), so it does not drift with the correction the way a
// peak-seeking anchor would - the fixture's allpass tail puts its largest sample
// 8 ms after the onset.
function preOnsetEnergyRatio(response, filterDelaySamples, guardMs) {
    const anchor = GOLDEN_FIXTURE_SPEC.onsetIndex + filterDelaySamples
        - Math.round(guardMs * REVERB_FIXTURE_RATE / 1000);
    let early = 0;
    let total = 0;
    for (let index = 0; index < response.length; index += 1) {
        const energy = response[index] * response[index];
        total += energy;
        if (index < anchor) early += energy;
    }
    return early / total;
}

test('reverb correction keeps pre-echo below the safety budget', () => {
    // Plan.md §6.2 pre-echo hard gate (safety, not audibility): the reverb phase
    // delta is a non-causal all-pass-class term, so it can only be shipped while the
    // energy it moves ahead of the direct sound stays negligible. Judged on the
    // corrected product (fixture ⊛ taps), as the fraction of total energy arriving
    // more than 5 ms before the direct arrival — outside the pre-masking window,
    // where a pre-echo stops being masked by the sound it precedes. Frozen at the
    // 0.002 budget the low-frequency phase extension already ships against.
    //
    // Measured on Node v22.23.2, 2026-08-19: rf=250 default 9.20e-4 (margin 2.17×),
    // rf=20000 1.19e-3 (1.68×), rw=1000/taps=131072 1.21e-3 (1.66×). The le path is
    // deliberately not in this matrix: le alone already produces 1.01e-2 here (its
    // low-frequency pre-ring is owned by the §3.3 low-phase gates), so including it
    // would measure the LFE budget rather than the reverb one.
    const fftSize = 131072;
    const fixtureSpectrum = spectrumFor(makeGoldenSource(1).impulses[0].data, fftSize);
    const ratioFor = result => preOnsetEnergyRatio(
        correctedTimeResponse(fixtureSpectrum, result.channels[0], fftSize),
        result.latencyInfo.filterDelaySamples,
        5
    );
    // Premise: without the reverb term the corrected response stays negligible
    // relative to the 0.002 budget, so the cases below still judge the reverb delta.
    const rv0Ratio = ratioFor(designReverbCase({ phase: 'full' }, 1));
    assert.ok(rv0Ratio < 1e-6,
        `premise: the rv=0 design has no pre-echo to speak of (${rv0Ratio})`);
    const cases = [
        ['rf250', { phase: 'full', reverbAmount: 1 }],
        ['rf20000', { phase: 'full', reverbAmount: 1, reverbMaxFrequency: 20000 }],
        ['rw1000-taps131072', {
            phase: 'full',
            reverbAmount: 1,
            reverbMaxFrequency: 20000,
            reverbWindowMs: 1000,
            taps: 131072
        }]
    ];
    for (const [caseId, overrides] of cases) {
        const result = designReverbCase(overrides, 1);
        assert.equal(result.diagnostics.reverbCorrection[0].state, 'applied',
            `${caseId}: premise: the reverb correction must actually ship`);
        const ratio = ratioFor(result);
        assert.ok(ratio < 0.002,
            `${caseId}: pre-onset energy exceeds the safety budget (${ratio})`);
    }
    clearRoomEqAnalysisCache();
    clearRoomEqDesignCache();
});

test('every Reverb control leaves the full-IR amplitude correction unchanged', () => {
    const reference = designReverbCase({ phase: 'full', reverbAmount: 0 }, 1);
    const cases = [
        ['amount', { reverbAmount: 1 }],
        ['window', { reverbAmount: 1, reverbWindowMs: 1000 }],
        ['maximum frequency', { reverbAmount: 1, reverbMaxFrequency: 20000 }],
        ['smoothing', { reverbAmount: 1, reverbSmoothing: 0.2 }]
    ];
    for (const [label, overrides] of cases) {
        const result = designReverbCase({ phase: 'full', ...overrides }, 1);
        assert.equal(result.diagnostics.reverbCorrection[0].state, 'applied', label);
        assert.deepEqual(result.previews[0].baseCorrectionDb,
            reference.previews[0].baseCorrectionDb,
            `${label} must not alter the amplitude target`);
        assert.deepEqual(result.previews[0].predictedDb,
            reference.previews[0].predictedDb,
            `${label} must not alter the Frequency graph`);
        assert.notEqual(digestChannels(result.channels), digestChannels(reference.channels),
            `${label} must still reach the reverb phase path`);
        const realized = maximumMagnitudeDifferenceDb(
            reference.channels[0],
            result.channels[0],
            131072,
            REVERB_FIXTURE_RATE
        );
        assert.ok(realized.maximum < 0.15,
            `${label} must preserve magnitude within the finite-FIR tolerance `
            + `(${realized.maximum} dB at ${realized.frequencyAtMaximum} Hz)`);
    }
});

test('Reverb analysis settings are inert while Reverb Correction is zero', () => {
    const reference = designReverbCase({ phase: 'full', reverbAmount: 0 }, 1);
    const variants = [
        { reverbWindowMs: 1000 },
        { reverbMaxFrequency: 20000 },
        { reverbSmoothing: 0.2 },
        { reverbWindowMs: 1000, reverbMaxFrequency: 20000, reverbSmoothing: 1 }
    ];
    for (const overrides of variants) {
        const result = designReverbCase(
            { phase: 'full', reverbAmount: 0, ...overrides }, 1);
        assert.equal(result.diagnostics.reverbCorrection[0].state, 'notRequested');
        assert.equal(digestChannels(result.channels), digestChannels(reference.channels));
        assert.deepEqual(result.previews[0].baseCorrectionDb,
            reference.previews[0].baseCorrectionDb);
        assert.deepEqual(result.previews[0].predictedDb,
            reference.previews[0].predictedDb);
    }
});

test('Reverb remains phase-only when its upper band is clamped by Correction High', () => {
    const overrides = {
        phase: 'full',
        highFrequency: 1000,
        reverbMaxFrequency: 20000,
        reverbWindowMs: 50
    };
    const rv0 = designReverbCase(overrides, 1);
    const rv1 = designReverbCase({ ...overrides, reverbAmount: 1 }, 1);
    assert.equal(rv1.diagnostics.reverbCorrection[0].state, 'applied');
    assert.equal(rv1.diagnostics.reverbCorrection[0].effectiveWindowMs, 50,
        'premise: rw_eff must be the configured 50 ms, so low_W is 60 Hz');
    assert.deepEqual(rv1.previews[0].baseCorrectionDb, rv0.previews[0].baseCorrectionDb);
    assert.deepEqual(rv1.previews[0].predictedDb, rv0.previews[0].predictedDb);
    assert.notEqual(digestChannels(rv1.channels), digestChannels(rv0.channels),
        'the in-band phase correction must remain active');
});

test('reverb phase correction clamps to fh when rf is above fh', () => {
    // Plan.md section 5 Phase 2 phase-side clamp gate (fixed threshold, structural
    // invariant): with rf > fh the C_ext band must clamp to min(rf, fh, 0.45*rate);
    // above that limit's upper flank (x 2^(1/3)) the rv=0 vs rv=1 phase difference
    // must vanish after removing a least-squares linear fit (residual RMS < 1e-3 rad).
    const fftSize = 131072;
    const overrides = {
        phase: 'full',
        highFrequency: 1000,
        reverbMaxFrequency: 20000,
        correctionAmount: 0
    };
    const rv0 = designReverbCase(overrides, 1);
    const rv1 = designReverbCase({ ...overrides, reverbAmount: 1 }, 1);
    assert.equal(rv1.diagnostics.reverbCorrection[0].state, 'applied');
    const spectrum0 = spectrumFor(rv0.channels[0], fftSize);
    const spectrum1 = spectrumFor(rv1.channels[0], fftSize);
    // Premise: the reverb term actually alters the in-band phase (the
    // out-of-band zero is not vacuous).
    const inBand = crossPhaseResidual(spectrum1, spectrum0, fftSize, 60, 1000);
    assert.ok(inBand.rms > 1e-2, `premise: in-band phase difference exists (${inBand.rms})`);
    const outOfBand = crossPhaseResidual(spectrum1, spectrum0, fftSize,
        1000 * 2 ** (1 / 3) * 1.001, REVERB_FIXTURE_RATE * 0.45);
    assert.ok(outOfBand.rms < 1e-3,
        `above-clamp residual RMS must vanish (${outOfBand.rms})`);
});

test('Reverb stays phase-only in a narrow correction band', () => {
    const overrides = {
        phase: 'full',
        lowFrequency: 800,
        highFrequency: 1000,
        reverbMaxFrequency: 2000
    };
    const rv0 = designReverbCase(overrides, 1);
    const rv1 = designReverbCase({ ...overrides, reverbAmount: 1 }, 1);
    assert.equal(rv1.diagnostics.reverbCorrection[0].state, 'applied');
    // The phase path remains active even though the narrow band has little room
    // between its transition flanks.
    let tapsDiffer = false;
    for (let index = 0; index < rv1.channels[0].length; index += 1) {
        if (rv1.channels[0][index] !== rv0.channels[0][index]) {
            tapsDiffer = true;
            break;
        }
    }
    assert.ok(tapsDiffer, 'premise: reverb phase path changes the taps');
    const base0 = rv0.previews[0].baseCorrectionDb;
    const base1 = rv1.previews[0].baseCorrectionDb;
    for (let index = 0; index < base0.length; index += 1) {
        assert.ok(base1[index] === base0[index],
            `rv-induced amplitude change must be zero everywhere `
            + `(index ${index}: ${base1[index]} vs ${base0[index]})`);
    }
});

test('correction amount zero keeps the amplitude correction fully disabled with rv', () => {
    // Plan.md section 5 Phase 2 cr contract: the fine structure is part of the
    // automatic amplitude correction, so cr=0 must leave the amplitude delta at
    // exactly zero even with rv=100.
    const result = designReverbCase(
        { phase: 'full', reverbAmount: 1, correctionAmount: 0 },
        1
    );
    assert.equal(result.diagnostics.reverbCorrection[0].state, 'applied');
    for (const value of result.previews[0].baseCorrectionDb) {
        assert.ok(value === 0, `amplitude correction must stay zero (${value})`);
    }
});

test('reverb amount leaves min and lin outputs bit-identical', () => {
    // Plan.md section 5 Phase 2 pm gate: rv is a pm='full'-only control. With
    // pm='min' or 'lin' and rv=100 the entire output must match the same-pm rv=0
    // design bit-for-bit (either a phase-path or an amplitude-path leak would
    // surface in the FIR, so this single check covers both paths).
    const cases = [
        ['min-default-multi', { phase: 'min', reverbAmount: 1 }],
        ['lin-default-multi', { phase: 'lin', reverbAmount: 1 }]
    ];
    for (const [caseId, overrides] of cases) {
        const phase = overrides.phase;
        const baseline = designReverbCase({ phase, reverbAmount: 0 }, 3);
        const result = designReverbCase(overrides, 3);
        assert.equal(result.diagnostics.reverbCorrection[0].state, 'fullPhaseRequired');
        assert.equal(digestChannels(result.channels), digestChannels(baseline.channels),
            `${caseId}: channels digest with rv=1`);
        assert.equal(digestBaseCorrection(result.previews),
            digestBaseCorrection(baseline.previews),
            `${caseId}: baseCorrectionDb digest with rv=1`);
        assert.equal(digestLatencyInfo(result.latencyInfo),
            digestLatencyInfo(baseline.latencyInfo),
            `${caseId}: latencyInfo digest with rv=1`);
    }
});

// ---------------------------------------------------------------------------
// Phase 3 — smoothing split (plan.md section 3.9): phaseSmoothing (ps) drives
// the direct-phase residual smoothing and its cache keys while smoothing (sm)
// stays on the amplitude path; Auto (ps unset/null) resolves to sm so the
// default output stays bit-identical to the pre-split behaviour (S-26).
// ---------------------------------------------------------------------------

// Flat-magnitude fixture: a delta passed through the golden allpass only.
// |H| == 1 across the band (truncation error ~0.6^41), so the amplitude path
// contributes only numerical noise and any sm-driven tap movement is isolated
// from the ps-driven phase path (plan.md section 5 Phase 3 gate (c), G-9:
// judged on taps with a small tolerance, not on display curves).
function makeAllpassOnlySource() {
    const spec = GOLDEN_FIXTURE_SPEC;
    const rate = spec.sampleRate;
    const dry = new Float64Array(spec.length);
    dry[spec.onsetIndex] = 1;
    const gain = spec.allpass.gain;
    const delay = Math.round(spec.allpass.delayMs * rate / 1000);
    const wet = new Float64Array(spec.length);
    for (let index = 0; index < wet.length; index += 1) {
        let value = -gain * dry[index];
        let coefficient = 1 - gain * gain;
        for (let term = 1; term <= spec.allpass.terms; term += 1) {
            const source = index - term * delay;
            if (source < 0) break;
            value += coefficient * dry[source];
            coefficient *= gain;
        }
        wet[index] = value;
    }
    const measurement = {
        id: 'reverb-allpass-fixture',
        timestamp: 'fixed',
        points: [{ pointId: 1, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    return {
        measurement,
        impulses: [{
            measurementId: measurement.id,
            pointId: 1,
            sampleRate: rate,
            onsetIndex: spec.onsetIndex,
            refScale: 1,
            data: Float32Array.from(wet)
        }]
    };
}

function designAllpassCase(overrides) {
    clearRoomEqDesignCache();
    clearRoomEqAnalysisCache();
    return designRoomEq({
        config: { ...REVERB_GOLDEN_BASE_CONFIG, ...overrides },
        sources: [makeAllpassOnlySource()]
    });
}

function maxAbsTapDifference(a, b) {
    assert.equal(a.length, b.length);
    let max = 0;
    for (let index = 0; index < a.length; index += 1) {
        const difference = Math.abs(a[index] - b[index]);
        if (difference > max) max = difference;
    }
    return max;
}

test('phase smoothing auto resolves to smoothing bit-identically', () => {
    // Plan.md section 5 Phase 3 gate (a): an explicit ps equal to sm must produce
    // the very same output as Auto (proves the Auto resolution is exactly
    // "ps := sm", not merely close).
    const cases = [
        ['auto', { phase: 'full', smoothing: 0.3 }],
        ['explicit', { phase: 'full', smoothing: 0.3, phaseSmoothing: 0.3 }]
    ];
    const results = cases.map(([caseId, overrides]) => [
        caseId,
        designReverbCase(overrides, 3)
    ]);
    const baseline = results[0][1];
    for (const [caseId, result] of results.slice(1)) {
        assert.equal(digestChannels(result.channels), digestChannels(baseline.channels),
            `${caseId}: channels digest`);
        assert.equal(digestBaseCorrection(result.previews),
            digestBaseCorrection(baseline.previews),
            `${caseId}: baseCorrectionDb digest`);
        assert.equal(digestLatencyInfo(result.latencyInfo),
            digestLatencyInfo(baseline.latencyInfo),
            `${caseId}: latencyInfo digest`);
    }
});

test('phase smoothing change leaves the amplitude correction unchanged', () => {
    // Plan.md section 5 Phase 3 gate (b): ps must steer only the phase path.
    // A ps-only change must keep every amplitude target bit intact.
    const base = designReverbCase({ phase: 'full', reverbAmount: 1 }, 1);
    const shifted = designReverbCase(
        { phase: 'full', reverbAmount: 1, phaseSmoothing: 0.5 }, 1);
    // Premises: the reverb path is engaged in both designs and the ps change
    // really reaches the FIR (otherwise the invariance below would be vacuous).
    assert.equal(base.diagnostics.reverbCorrection[0].state, 'applied');
    assert.equal(shifted.diagnostics.reverbCorrection[0].state, 'applied');
    assert.notEqual(digestChannels(base.channels), digestChannels(shifted.channels),
        'premise: a ps-only change must move the FIR taps');
    assert.equal(digestBaseCorrection(base.previews),
        digestBaseCorrection(shifted.previews),
        'ps-only change must keep baseCorrectionDb bit-identical');
});

test('amplitude smoothing change leaves the phase path unchanged on a flat fixture', () => {
    // Plan.md section 5 Phase 3 gate (c), G-9: on a flat-magnitude fixture the
    // amplitude correction is numerical noise (premise below), so an sm-only
    // change (ps pinned, Auto off) may move the taps only through that noise.
    // Judged on the taps with a small tolerance -- not via taps-diff of the
    // reverb golden fixture and not via display curves. dw=20ms puts two
    // allpass tail terms inside the direct window so the ps path is active.
    // Measured on Node v22.23.2 (2026-08-19): sm-only diff 5.9e-10, ps
    // sensitivity 9.3e-5, flat-amplitude noise 2.4e-7 dB.
    const base = { phase: 'full', directWindowMs: 20, phaseSmoothing: 0.17 };
    const reference = designAllpassCase(base);
    const smShifted = designAllpassCase({ ...base, smoothing: 0.4 });
    const psShifted = designAllpassCase({ ...base, phaseSmoothing: 0.6 });
    // Premise 1: the fixture is amplitude-flat -- base correction is noise.
    let maxCorrection = 0;
    for (const value of reference.previews[0].baseCorrectionDb) {
        maxCorrection = Math.max(maxCorrection, Math.abs(value));
    }
    assert.ok(maxCorrection < 1e-3,
        `premise: flat fixture amplitude correction must be noise (${maxCorrection})`);
    // Premise 2: ps still steers this fixture's taps, so the sm invariance
    // below is not vacuously satisfied by a dead phase path.
    const psDifference = maxAbsTapDifference(reference.channels[0], psShifted.channels[0]);
    assert.ok(psDifference > 1e-6,
        `premise: ps change must move the taps (${psDifference})`);
    // Judgment: sm-only movement stays at the numerical-noise scale.
    const smDifference = maxAbsTapDifference(reference.channels[0], smShifted.channels[0]);
    assert.ok(smDifference < 1e-6,
        `sm-only change must leave the phase path unchanged (${smDifference})`);
});

test('reverb smoothing changes the output with amplitude correction disabled', () => {
    // Plan.md section 5 Phase 3 gate (d) / F-2 regression detection: with cr=0
    // the amplitude path is fully off (checked bit-exactly), so an rs-only
    // change can reach the FIR only through the reverb phase path. If a future
    // regression rewired rs away from that path, these designs would collapse
    // to identical taps and this gate would go red.
    const narrow = designReverbCase(
        { phase: 'full', reverbAmount: 1, correctionAmount: 0 }, 1);
    const wide = designReverbCase(
        { phase: 'full', reverbAmount: 1, correctionAmount: 0, reverbSmoothing: 0.2 }, 1);
    for (const result of [narrow, wide]) {
        assert.equal(result.diagnostics.reverbCorrection[0].state, 'applied');
        for (const value of result.previews[0].baseCorrectionDb) {
            assert.ok(value === 0, 'premise: cr=0 must zero the amplitude correction');
        }
    }
    assert.notEqual(digestChannels(narrow.channels), digestChannels(wide.channels),
        'rs-only change must move the rv>0 taps');
});

// ---------------------------------------------------------------------------
// Phase 4 — degradation guard and coexistence gates: requested-window analysis,
// FIR-energy degradation, and the LFE/reverb-correction coexistence contract.
// ---------------------------------------------------------------------------

function makeReverbGuardSource(delayMs, gain) {
    const rate = REVERB_FIXTURE_RATE;
    const onsetIndex = GOLDEN_FIXTURE_SPEC.onsetIndex;
    const wet = new Float32Array(131072);
    const delaySamples = Math.round(delayMs * rate / 1000);
    wet[onsetIndex] = -gain;
    for (let term = 1; onsetIndex + term * delaySamples < wet.length; term += 1) {
        wet[onsetIndex + term * delaySamples] =
            (1 - gain * gain) * gain ** (term - 1);
    }
    const measurement = {
        id: `reverb-guard-${delayMs}-${gain}`,
        timestamp: 'fixed',
        points: [{ pointId: 0, timestamp: 'fixed' }],
        averageFrequencyResponse: []
    };
    return {
        measurement,
        impulses: [{
            measurementId: measurement.id,
            pointId: 0,
            sampleRate: rate,
            onsetIndex,
            refScale: 1,
            data: wet
        }]
    };
}

function designReverbGuardCase(overrides, delayMs, gain) {
    clearRoomEqDesignCache();
    clearRoomEqAnalysisCache();
    return designRoomEq({
        config: { ...REVERB_GOLDEN_BASE_CONFIG, ...overrides },
        sources: [makeReverbGuardSource(delayMs, gain)]
    });
}

const REVERB_GUARD_STRESS_CONFIG = Object.freeze({
    phase: 'full',
    phaseCorrectionAmount: 0,
    reverbAmount: 1,
    taps: 8192,
    reverbWindowMs: 1000,
    reverbMaxFrequency: 20000,
    correctionAmount: 0,
    reverbSmoothing: 0.02,
    referencePoint: 1
});

test('Reverb Window observes the requested interval beyond the FIR half-length', () => {
    // Observation length and correctable delay are different quantities. A short
    // modal delay can require a long decay window to measure, so taps/(2*rate)
    // must not truncate the requested analysis before synthesis. The final FIR
    // energy guard remains responsible for rejecting an unrealizable result.
    const overrides = { phase: 'full', reverbAmount: 1, taps: 8192, directWindowMs: 50 };
    const result = designReverbCase(overrides, 1);
    const diagnostic = result.diagnostics.reverbCorrection[0];
    assert.equal(diagnostic.state, 'applied');
    assert.equal(diagnostic.scale, 1);
    assert.equal(diagnostic.effectiveWindowMs, result.config.reverbWindowMs);
    assert.ok(result.channels[0].every(Number.isFinite), 'taps must stay finite');
    const withoutReverb = designReverbCase({ ...overrides, reverbAmount: 0 }, 1);
    assert.equal(withoutReverb.diagnostics.reverbCorrection[0].state, 'notRequested');
    assert.notEqual(digestChannels(result.channels), digestChannels(withoutReverb.channels),
        'the observed late response must contribute to the correction');
});

test('multipoint reverb consensus uses the least-squares common delay', () => {
    const sampleRate = 48000;
    const onsetIndex = 128;
    const length = 24000;
    const delays = [0.9, 0.1].map(gain => {
        const samples = new Float32Array(length);
        const delaySamples = Math.round(sampleRate * 0.008);
        samples[onsetIndex] = -gain;
        for (let term = 1; onsetIndex + term * delaySamples < length; term += 1) {
            samples[onsetIndex + term * delaySamples] =
                (1 - gain * gain) * gain ** (term - 1);
        }
        return samples;
    });
    const measurement = {
        id: 'reverb-consensus-least-squares',
        timestamp: 'fixed',
        points: [{ pointId: 0 }, { pointId: 1 }],
        averageFrequencyResponse: []
    };
    clearRoomEqDesignCache();
    clearRoomEqAnalysisCache();
    const result = designRoomEq({
        config: {
            ...REVERB_GOLDEN_BASE_CONFIG,
            sampleRate,
            taps: 32768,
            phase: 'full',
            reverbAmount: 1,
            reverbWindowMs: 300,
            reverbMaxFrequency: 250,
            reverbSmoothing: 0.02,
            correctionAmount: 0,
            referencePoint: 0
        },
        sources: [{
            measurement,
            impulses: delays.map((data, pointId) => ({
                measurementId: measurement.id,
                pointId,
                sampleRate,
                onsetIndex,
                refScale: 1,
                data
            }))
        }]
    });
    const preview = result.previews[0];
    const index = nearestFrequencyIndex(preview.frequencies, 125);
    const before = preview.groupDelayResponse.excess.before[index];
    const after = preview.groupDelayResponse.excess.after[index];
    assert.equal(result.diagnostics.reverbCorrection[0].state, 'applied');
    assert.ok(result.diagnostics.reverbCorrection[0].agreementMinimum < 0.9,
        'premise: the points must disagree enough to expose agreement attenuation');
    assert.ok(before > 10, `premise: a shared correction target exists (${before} ms)`);
    assert.ok(Math.abs(after) < 0.03 * before,
        `the arithmetic-mean target must flatten the consensus (${after} from ${before} ms)`);
});

test('reverb consensus excludes a GD-invalid deep-null observation from delay and agreement', () => {
    const sampleRate = 48000;
    const taps = 65536;
    const source = deepNullDelaySource('reverb-deep-null', 1920, 7000);
    const frequency = 509 * sampleRate / (2 * taps);
    const frequencies = new Float64Array([frequency]);
    const onsetIndex = source.impulses[0].onsetIndex;
    const windowStart = onsetIndex - Math.round(sampleRate * 0.001);
    const windowEnd = onsetIndex + Math.round(sampleRate * 0.1);
    const nullWindow = analyzeRoomEqGroupDelay(
        source.impulses[1].data.slice(windowStart, windowEnd),
        onsetIndex - windowStart,
        sampleRate,
        frequencies
    );
    assert.equal(nullWindow.valid[0], 0, 'premise: the deep-null delay is unavailable');

    clearRoomEqAnalysisCache();
    clearRoomEqDesignCache();
    const result = designRoomEq({
        config: {
            sampleRate,
            taps,
            phase: 'full',
            smoothing: 0.02,
            phaseSmoothing: 0.02,
            lowFrequency: 186,
            highFrequency: 16000,
            directWindowMs: 4,
            phaseLowFrequency: 500,
            correctionAmount: 0,
            phaseCorrectionAmount: 0,
            referencePoint: 0,
            eqBands: [],
            reverbAmount: 1,
            reverbWindowMs: 100,
            reverbMaxFrequency: 188.7,
            reverbSmoothing: 0.02
        },
        sources: [source]
    });
    const common = analyzeRoomEqGroupDelay(
        source.impulses[0].data,
        onsetIndex,
        sampleRate,
        frequencies
    );
    const correction = analyzeRoomEqGroupDelay(
        result.channels[0],
        taps / 2,
        sampleRate,
        frequencies,
        { minimumFftSize: taps * 2 }
    );
    const diagnostic = result.diagnostics.reverbCorrection[0];
    assert.equal(diagnostic.state, 'applied');
    assert.ok(diagnostic.agreementMinimum > 0.999999,
        `an unavailable observation must not lower agreement (${diagnostic.agreementMinimum})`);
    assert.ok(Math.abs(common.excessMs[0] - 40) < 0.01);
    assert.ok(Math.abs(correction.excessMs[0] + common.excessMs[0]) < 1.5,
        `the valid common delay must not be averaged with zero (${correction.excessMs[0]} ms)`);
});

test('reverb firEnergy guard reduces or disables an unrealizable phase advance', () => {
    // An 8192-tap filter at 96 kHz has only 42.7 ms on either side of its
    // modelling delay. The weak 20 ms all-pass is realizable, while the strong
    // 80 ms all-pass requires an advance beyond that support and must be rejected.
    const weak = designReverbGuardCase(REVERB_GUARD_STRESS_CONFIG, 20, 0.5);
    assert.equal(weak.diagnostics.reverbCorrection[0].state, 'applied',
        'premise: the realizable all-pass must pass the guard');
    assert.equal(weak.diagnostics.reverbCorrection[0].scale, 1,
        'premise: the realizable all-pass must pass at full scale');
    const stressed = designReverbGuardCase(REVERB_GUARD_STRESS_CONFIG, 80, 0.8);
    const diagnostic = stressed.diagnostics.reverbCorrection[0];
    assert.equal(diagnostic.state, 'disabled');
    assert.equal(diagnostic.scale, 0);
    assert.equal(diagnostic.reason, 'firEnergy');
    assert.ok(stressed.channels[0].every(Number.isFinite), 'taps must stay finite');
    const withoutReverb = designReverbGuardCase(
        { ...REVERB_GUARD_STRESS_CONFIG, reverbAmount: 0 }, 80, 0.8);
    assert.equal(digestChannels(stressed.channels), digestChannels(withoutReverb.channels),
        'disabled design must ship the rv=0 taps bit-identically');
    assert.equal(digestBaseCorrection(stressed.previews),
        digestBaseCorrection(withoutReverb.previews),
        'disabled design must ship the rv=0 previews bit-identically');
});

test('the longer reverb window owns the low-frequency overlap with LFE', () => {
    // Reverb Window is longer than every octave window in the 20-70 Hz judgment
    // band. At rv=1 it therefore owns the shared target; LFE must not cancel it
    // back to its shorter window or add the same measured delay twice. At rv=0.5
    // the handoff is halfway between the independent LFE and reverb targets.
    const full = designReverbCase(
        { phase: 'full', reverbAmount: 1, lowFrequencyPhaseExtension: true }, 1);
    const rvOnly = designReverbCase({ phase: 'full', reverbAmount: 1 }, 1);
    const leOnly = designReverbCase(
        { phase: 'full', lowFrequencyPhaseExtension: true }, 1);
    const plain = designReverbCase({ phase: 'full' }, 1);
    const lfeDiagnostic = full.diagnostics.lowFrequencyPhaseExtension[0];
    assert.ok(lfeDiagnostic.scale > 0,
        `premise: LFE must engage under rv (${JSON.stringify(lfeDiagnostic)})`);
    assert.equal(full.diagnostics.reverbCorrection[0].state, 'applied',
        'premise: the reverb correction must stay applied under le');
    const fftSize = 131072;
    const spectra = [full, rvOnly, leOnly, plain]
        .map(design => spectrumFor(design.channels[0], fftSize));
    const reverbOwn = crossPhaseResidual(spectra[1], spectra[3], fftSize, 20, 70);
    assert.ok(reverbOwn.rms > 0.02,
        `premise: the reverb term must move the low band (${reverbOwn.rms} rad)`);
    const withoutRv = crossPhaseResidual(spectra[2], spectra[3], fftSize, 20, 70);
    assert.ok(withoutRv.rms > 0.02,
        `premise: LFE alone must contribute low-band phase (${withoutRv.rms} rad)`);
    const withRv = crossPhaseResidual(spectra[0], spectra[1], fftSize, 20, 70);
    assert.ok(withRv.rms < 0.27,
        `LFE low-band ripple must stay bounded under rv (${withRv.rms} rad)`);
    const displacementMs = Math.abs(
        withRv.meanGroupDelayMs - withoutRv.meanGroupDelayMs);
    assert.ok(displacementMs > 1,
        `premise: the longer-window handoff must be observable (${displacementMs} ms)`);
    const half = designReverbCase(
        { phase: 'full', reverbAmount: 0.5, lowFrequencyPhaseExtension: true }, 1);
    const halfRvOnly = designReverbCase({ phase: 'full', reverbAmount: 0.5 }, 1);
    assert.equal(half.diagnostics.reverbCorrection[0].state, 'applied',
        'premise: the rv = 0.5 reverb correction must stay applied under le');
    assert.ok(half.diagnostics.lowFrequencyPhaseExtension[0].scale > 0,
        'premise: LFE must engage at rv = 0.5');
    const halfSpectra = [half, halfRvOnly]
        .map(design => spectrumFor(design.channels[0], fftSize));
    const withHalfRv = crossPhaseResidual(halfSpectra[0], halfSpectra[1], fftSize, 20, 70);
    const halfDisplacementMs = Math.abs(
        withHalfRv.meanGroupDelayMs - withoutRv.meanGroupDelayMs);
    const displacementRatio = halfDisplacementMs / displacementMs;
    assert.ok(displacementRatio > 0.35 && displacementRatio < 0.65,
        `the LFE increment's displacement must scale with rv `
        + `(rv=0.5 displacement ${halfDisplacementMs} ms vs rv=1 ${displacementMs} ms, `
        + `ratio ${displacementRatio})`);
});

test('consensus preview fills the reverb-extended display window', () => {
    // R2-1: the Consensus (multi-point) path renders its preview from the buffer
    // alignedAverageAnalysis synthesizes, so both must size the impulse-preview
    // display window with the same rule (previewWindowSamples). With rv > 0 that
    // window is max(5, dw, min(rw, 50)) = 50 ms here.
    //
    // taps = 8192 is what makes a divergence observable: the synthesized buffer
    // reaches taps/2 + previewSamples past the onset, so with the display window
    // alone it covers 4096 + 4800 samples but with the pre-fix max(5, dw) rule
    // only 4096 + 576 = 4672 samples = 48.67 ms -- short of the 50 ms the preview
    // reads, which then zero-fills 48.67-50 ms. The single-point path reads the
    // raw measurement and is unaffected, so it is the reference here.
    const single = designReverbCase(
        { phase: 'full', taps: 8192, reverbAmount: 1 }, 1);
    const consensus = designReverbCase(
        { phase: 'full', taps: 8192, reverbAmount: 1 }, 3);
    for (const [label, design] of [['single', single], ['consensus', consensus]]) {
        assert.equal(design.diagnostics.reverbCorrection[0].state, 'applied',
            `premise: the reverb correction must apply (${label})`);
        assert.ok(Math.abs(design.previews[0].impulseResponse.durationMs - 50) < 1e-9,
            `premise: the display window must be the 50 ms reverb cap (${label}: `
            + `${design.previews[0].impulseResponse.durationMs} ms)`);
    }
    // RMS of the displayed pre-correction trace over [fromMs, toMs) after the onset.
    const traceRms = (preview, fromMs, toMs) => {
        const preroll = Math.round(preview.sampleRate * 2 / 1000);
        const from = preroll + Math.round(preview.sampleRate * fromMs / 1000);
        const to = preroll + Math.round(preview.sampleRate * toMs / 1000);
        let squared = 0;
        for (let index = from; index < to; index += 1) {
            squared += preview.before[index] * preview.before[index];
        }
        return Math.sqrt(squared / (to - from));
    };
    // 48.67 ms = the pre-fix buffer end (taps/2 + max(5, dw) samples past onset).
    const tailStartMs = (8192 / 2 + Math.round(96000 * 6 / 1000)) / 96;
    const singleTail = traceRms(single.previews[0].impulseResponse, tailStartMs, 50);
    const singleBody = traceRms(single.previews[0].impulseResponse, 30, tailStartMs);
    const consensusTail = traceRms(consensus.previews[0].impulseResponse, tailStartMs, 50);
    const consensusBody = traceRms(consensus.previews[0].impulseResponse, 30, tailStartMs);
    // Measured on Node v22.23.2, 2026-08-19: single tail 0.032135 vs body 0.033218
    // (ratio 0.967), consensus tail 0.030268 vs body 0.032200 (ratio 0.940). With
    // the two window rules out of step the consensus tail collapses by two orders
    // of magnitude (ratio ~0.006) because the samples simply are not there.
    assert.ok(singleTail > 0.2 * singleBody,
        `premise: the fixture carries energy in the last 1.33 ms of the window `
        + `(single tail ${singleTail} vs body ${singleBody})`);
    assert.ok(consensusTail > 0.5 * consensusBody,
        `the consensus preview must not zero-fill the end of the display window `
        + `(tail ${consensusTail} vs body ${consensusBody})`);

    setRoomEqFftBackend(null);
    clearRoomEqAnalysisCache();
    clearRoomEqDesignCache();
});

// ---------------------------------------------------------------------------
// Room EQ per-channel measurements (plan.md §2.6 T-2 / T-7 / T-8).
// ---------------------------------------------------------------------------

function irAssetHeader(payload) {
    const view = new DataView(payload);
    return {
        magic: view.getUint32(0, true),
        channels: view.getUint32(4, true),
        frames: view.getUint32(8, true),
        sampleRate: view.getUint32(12, true),
        topology: view.getUint32(16, true),
        pathCount: view.getUint32(20, true),
        byteLength: payload.byteLength
    };
}

function flatSource(id) {
    return { measurement: { ...flatLegacyMeasurement(), id }, impulses: [] };
}

async function workerPayloadHeader(sourceCount, taps = 8192) {
    const messages = [];
    await withGlobals({
        console: createConsoleHarness({ warn() {} }),
        onmessage: undefined,
        postMessage(message, transferables = []) {
            messages.push(structuredClone(message, { transfer: transferables }));
        }
    }, async () => {
        try {
            await import(`../../js/room-eq/design-worker.js?test=${Date.now()}-${sourceCount}`);
            await globalThis.onmessage({
                data: structuredClone({
                    type: 'design',
                    requestId: sourceCount,
                    config: {
                        sampleRate: 48000,
                        taps,
                        phase: 'lin',
                        smoothing: 0.17,
                        lowFrequency: 20,
                        highFrequency: 16000,
                        directWindowMs: 6
                    },
                    sources: Array.from(
                        { length: sourceCount },
                        (_, index) => flatSource(`channel-${index}`)
                    )
                })
            });
        } finally {
            setRoomEqFftBackend(null);
            clearRoomEqAnalysisCache();
            clearRoomEqDesignCache();
        }
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'result');
    return irAssetHeader(messages[0].payload);
}

test('design worker keeps the single-source payload on the mono topology', async () => {
    // T-2: with ms0..ms7 empty the plugin still passes exactly one source, so the
    // shipped mono asset header must stay byte-for-byte what it is today.
    assert.deepEqual(await workerPayloadHeader(1), {
        magic: IR_ASSET_MAGIC,
        channels: 1,
        frames: 8192,
        sampleRate: 48000,
        topology: IR_ASSET_TOPOLOGY.mono,
        pathCount: 0,
        byteLength: 32 + 8192 * 4
    });
});

test('design worker publishes multi-source designs as independent IR assets', async () => {
    // T-8: 2ch and 8ch headers carry channels = N, topology = independent and the
    // exact 32 + N * taps * 4 payload length the kernel validates against.
    for (const channels of [2, 8]) {
        assert.deepEqual(await workerPayloadHeader(channels), {
            magic: IR_ASSET_MAGIC,
            channels,
            frames: 8192,
            sampleRate: 48000,
            topology: IR_ASSET_TOPOLOGY.independent,
            pathCount: 0,
            byteLength: 32 + channels * 8192 * 4
        });
    }
});

test('design core passes a channel through when its measurement slot is empty', () => {
    // T-7: ms0 assigned with the shared ms empty leaves later channels sourceless,
    // and those channels must ship a unit impulse instead of a correction.
    clearRoomEqAnalysisCache();
    clearRoomEqDesignCache();
    try {
        const result = designRoomEq({
            config: {
                sampleRate: 48000,
                taps: 8192,
                phase: 'lin',
                smoothing: 0.17,
                lowFrequency: 20,
                highFrequency: 16000,
                directWindowMs: 6
            },
            sources: [flatSource('assigned'), null]
        });
        assert.equal(result.channels.length, 2);
        const passthrough = result.channels[1];
        assert.equal(passthrough.length, 8192);
        assert.equal(passthrough[4096], 1);
        assert.equal(passthrough.reduce((sum, value) => sum + Math.abs(value), 0), 1);
        assert.equal(result.previews[1], null);
        assert.ok(result.previews[0]);
    } finally {
        clearRoomEqAnalysisCache();
        clearRoomEqDesignCache();
    }
});
