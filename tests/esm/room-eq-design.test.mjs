import assert from 'node:assert/strict';
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

function spectrumFor(taps, fftSize = taps.length * 2) {
    const input = new Float64Array(fftSize);
    input.set(taps);
    return new FFT(input.length).realTransform(input);
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
    const additionalEqDb = none.predictedDb[index] - none.measuredDb[index];

    assert.ok(full.baseCorrectionDb[index] > 1);
    assert.ok(Math.abs(half.baseCorrectionDb[index] - full.baseCorrectionDb[index] * 0.5) < 0.001);
    assert.ok(Math.abs(none.baseCorrectionDb[index]) < 0.001);
    assert.ok(Math.abs((half.predictedDb[index] - half.measuredDb[index]) -
        (half.baseCorrectionDb[index] + additionalEqDb)) < 0.001);
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

test('group delay preview follows the measured slope and reads zero at 1 kHz', () => {
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
    assert.ok(Math.abs(before[nearest(1000)]) < 1e-3,
        `1 kHz reference was ${before[nearest(1000)]} ms`);
    assert.ok(Math.abs(before[nearest(2000)]) < 0.01,
        `2 kHz comb peak was ${before[nearest(2000)]} ms`);
    // The comb null sits one third of the echo period below its peaks (-1.33 ms);
    // any smoothing beyond the configured pass would blunt it.
    assert.ok(before[nearest(500)] < -1.25,
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
    assert.deepEqual(enabled.diagnostics.lowFrequencyPhaseExtension[0], {
        state: 'applied',
        scale: 1,
        reason: null
    });
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
        assert.deepEqual(result.diagnostics.lowFrequencyPhaseExtension[0], {
            state: 'applied',
            scale: 1,
            reason: null
        });
    }
});

test('subsonic phase closure stays out of the inactive correction band', () => {
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
            assert.ok(inactive.rms <= 0.25,
                `${lowFrequency} Hz/${phaseCorrectionAmount} inactive RMS ` +
                `${inactive.rms} ms`);
            assert.ok(inactive.p95 <= 0.75,
                `${lowFrequency} Hz/${phaseCorrectionAmount} inactive p95 ` +
                `${inactive.p95} ms`);
            assert.ok(enabledActive.afterRms <= disabledActive.afterRms + 0.1,
                `${lowFrequency} Hz/${phaseCorrectionAmount} active RMS changed from ` +
                `${disabledActive.afterRms} to ${enabledActive.afterRms}`);
            assert.equal(enabled.diagnostics.lowFrequencyPhaseExtension[0].scale, 1);
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
    assert.equal(enabled.diagnostics.lowFrequencyPhaseExtension[0].scale, 1);
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

    assert.ok(crossing.afterSpan <= 1,
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

    assert.ok(enabledResidual < disabledResidual * 0.65,
        `moderate consensus residual changed from ${disabledResidual} to ` +
        `${enabledResidual}; ${JSON.stringify(
            enabled.diagnostics.lowFrequencyPhaseExtension[0]
        )}`);
    assert.ok(enabledTotal.afterRms < disabledTotal.afterRms,
        `moderate total RMS changed from ${disabledTotal.afterRms} to ` +
        `${enabledTotal.afterRms}`);
    assert.ok(enabled.diagnostics.lowFrequencyPhaseExtension[0].scale >= 0.5);
});

test('low-frequency phase consensus guard scores aligned-average total delay', () => {
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
        const disabledActive = groupDelayBandStats(disabled, 70, 350);
        const enabledActive = groupDelayBandStats(enabled, 70, 350);
        const diagnostic = enabled.diagnostics.lowFrequencyPhaseExtension[0];

        assert.ok(enabledActive.afterRms <= disabledActive.afterRms + 0.1,
            `${phaseCorrectionAmount} active RMS changed from ` +
            `${disabledActive.afterRms} to ${enabledActive.afterRms}; ` +
            JSON.stringify(diagnostic));
        assert.ok(diagnostic.scale < 1,
            `${phaseCorrectionAmount} retained unsafe scale 1`);
        assert.equal(diagnostic.reason, 'groupDelay');
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
    assert.deepEqual(result.diagnostics.lowFrequencyPhaseExtension[0], {
        state: 'reduced',
        scale: 1,
        reason: 'insufficientData'
    });
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

    assert.deepEqual(result.diagnostics.lowFrequencyPhaseExtension[0], {
        state: 'applied',
        scale: 1,
        reason: null
    });
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

test('low-frequency direct DFT budget disables pathological sample-bin work', () => {
    const source = lowFrequencyAllPassSource('low-phase-work-budget');
    const overrides = {
        taps: 131072,
        directWindowMs: 50,
        lowFrequency: 20,
        highFrequency: 16000,
        phaseLowFrequency: 16000
    };
    const disabled = lowPhaseExtensionDesign(source, overrides);
    const enabled = lowPhaseExtensionDesign(source, {
        ...overrides,
        lowFrequencyPhaseExtension: true
    });

    assert.deepEqual(enabled.channels[0], disabled.channels[0]);
    assert.deepEqual(enabled.diagnostics.lowFrequencyPhaseExtension[0], {
        state: 'disabled',
        scale: 0,
        reason: 'dftWorkBudget'
    });
    assert.ok(!enabled.qualityWarnings.includes('dftWorkBudget'));
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

test('low-frequency phase extension rejects a stress candidate that worsens inactive delay', () => {
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
        assert.deepEqual(enabled.channels[0], disabled.channels[0]);
        assert.deepEqual(enabled.diagnostics.lowFrequencyPhaseExtension[0], {
            state: 'disabled',
            scale: 0,
            reason: 'groupDelay'
        });
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
                    diagnostic: { state: 'disabled', scale: 0, reason: 'dftWorkBudget' }
                },
                {
                    requestId: 2,
                    diagnostic: { state: 'disabled', scale: 0, reason: 'groupDelay' }
                }
            ]);
        } finally {
            setRoomEqFftBackend(null);
            clearRoomEqAnalysisCache();
            clearRoomEqDesignCache();
        }
    });
});
