import assert from 'node:assert/strict';
import test from 'node:test';

import FFT from '../../js/utils/measurement-dsp/fft.js';
import {
    interpolateLogResponse,
    smoothFrequencyResponse
} from '../../js/utils/measurement-dsp/smoothing.js';
import {
    clearRoomEqDesignCache,
    designRoomEq,
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

test('IR preview spans from 5 ms before onset through at least 5 ms', () => {
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
        assert.equal(preview.startMs, -5);
        assert.equal(preview.durationMs, 6);
        assert.equal(preview.before.length, 528);
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
    assert.equal(shortWindowPreview.startMs, -5);
    assert.equal(shortWindowPreview.durationMs, 5);
    assert.equal(shortWindowPreview.before.length, 480);
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
    const onsetSample = 240;
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
