import test from 'node:test';
import assert from 'node:assert/strict';

import audioUtils from '../../features/measurement/audio-utils/index.js';
import AudioProcessing, {
    createSweepCapturePlan
} from '../../features/measurement/measurement-controller/audio-processing.js';
import {
    normalizeResponseToZeroDb
} from '../../features/measurement/response-normalization.js';

test('frequency response normalization uses the measured audible-band median', () => {
    const response = [
        [10, -40],
        [20, -12],
        [30, -6],
        [100, 6],
        [200, 6],
        [500, 6],
        [1000, 6],
        [2000, 6],
        [5000, 6],
        [10000, -3],
        [20000, -12],
        [22000, -40]
    ];

    const normalized = normalizeResponseToZeroDb(response);

    assert.equal(normalized.find(([frequency]) => frequency === 1000)[1], 0);
    assert.equal(normalized.find(([frequency]) => frequency === 20)[1], -18);
    assert.equal(normalized.find(([frequency]) => frequency === 22000)[1], -46);
});

test('frequency response normalization intersects audible and measured bands', () => {
    const response = [
        [20, 20],
        [100, 20],
        [200, 4],
        [500, 4],
        [1000, 4],
        [2000, 4],
        [5000, -20],
        [20000, -20]
    ];

    const normalized = normalizeResponseToZeroDb(response, 200, 2000);

    assert.equal(normalized.find(([frequency]) => frequency === 500)[1], 0);
    assert.equal(normalized.find(([frequency]) => frequency === 20)[1], 16);
    assert.equal(normalized.find(([frequency]) => frequency === 5000)[1], -24);
});

test('repeated TSP deconvolution is flat for an ideal delayed loopback', t => {
    const previousState = {
        initialized: audioUtils.initialized,
        lastTspSignal: audioUtils.lastTspSignal,
        lastInverseFilter: audioUtils.lastInverseFilter,
        lastSweepFrequencyResponse: audioUtils.lastSweepFrequencyResponse,
        lastDeconvolutionRefScale: audioUtils.lastDeconvolutionRefScale,
        sweepMinFreq: audioUtils.sweepMinFreq,
        sweepMaxFreq: audioUtils.sweepMaxFreq
    };
    t.after(() => Object.assign(audioUtils, previousState));

    const sampleRate = 48000;
    const sweepLength = 4096;
    const averagingCount = 2;
    const preRollSamples = sampleRate / 2;
    const loopbackDelay = 256;
    audioUtils.initialized = true;

    const sweep = audioUtils.generateTSP(
        sweepLength,
        sampleRate,
        'left',
        20,
        20000,
        false
    );
    const capturePlan = createSweepCapturePlan(sweepLength, averagingCount, sampleRate);
    const recording = new Float32Array(
        preRollSamples +
        loopbackDelay +
        capturePlan.repeatCount * sweepLength
    );
    for (let repeat = 0; repeat < capturePlan.repeatCount; repeat++) {
        recording.set(
            sweep.left,
            preRollSamples + loopbackDelay + repeat * sweepLength
        );
    }

    const processed = AudioProcessing.processRecordedBuffer.call({
        interfaceCalibrationImpulseResponse: null,
        currentMeasurement: {
            sweepMinFreq: audioUtils.sweepMinFreq,
            sweepMaxFreq: audioUtils.sweepMaxFreq
        }
    }, recording, sweepLength, averagingCount, sampleRate);
    const response = audioUtils.calculateFrequencyResponseWithSmoothing(
        processed.analysisImpulseResponse,
        sampleRate,
        true,
        0.005
    );
    const normalized = normalizeResponseToZeroDb(
        response,
        audioUtils.sweepMinFreq,
        audioUtils.sweepMaxFreq
    ).filter(([frequency]) => frequency >= 20 && frequency <= 20000);
    const maximumError = Math.max(...normalized.map(([, db]) => Math.abs(db)));

    assert.equal(processed.analysisImpulseResponse.length, sweepLength);
    assert.ok(maximumError < 0.001, `maximum response error was ${maximumError} dB`);
});

test('short 192 kHz sweeps retain complete periods through practical loopback latency', t => {
    const previousState = {
        initialized: audioUtils.initialized,
        lastTspSignal: audioUtils.lastTspSignal,
        lastInverseFilter: audioUtils.lastInverseFilter,
        lastSweepFrequencyResponse: audioUtils.lastSweepFrequencyResponse,
        lastDeconvolutionRefScale: audioUtils.lastDeconvolutionRefScale,
        sweepMinFreq: audioUtils.sweepMinFreq,
        sweepMaxFreq: audioUtils.sweepMaxFreq
    };
    t.after(() => Object.assign(audioUtils, previousState));

    const sampleRate = 192000;
    const sweepLength = 16384;
    const averagingCount = 4;
    const preRollSamples = sampleRate / 2;
    const loopbackDelay = Math.round(sampleRate * 0.12);
    audioUtils.initialized = true;
    const sweep = audioUtils.generateTSP(
        sweepLength, sampleRate, 'left', 20, 20000, false
    );
    const capturePlan = createSweepCapturePlan(sweepLength, averagingCount, sampleRate);
    const recording = new Float32Array(
        preRollSamples + loopbackDelay + capturePlan.repeatCount * sweepLength
    );
    for (let repeat = 0; repeat < capturePlan.repeatCount; repeat++) {
        recording.set(
            sweep.left,
            preRollSamples + loopbackDelay + repeat * sweepLength
        );
    }

    const processed = AudioProcessing.processRecordedBuffer.call({
        interfaceCalibrationImpulseResponse: null,
        currentMeasurement: {
            sweepMinFreq: audioUtils.sweepMinFreq,
            sweepMaxFreq: audioUtils.sweepMaxFreq
        }
    }, recording, sweepLength, averagingCount, sampleRate);
    const response = audioUtils.calculateFrequencyResponseWithSmoothing(
        processed.analysisImpulseResponse,
        sampleRate,
        true,
        0.005
    );
    const normalized = normalizeResponseToZeroDb(
        response,
        20,
        20000
    ).filter(([frequency]) => frequency >= 20 && frequency <= 20000);
    const maximumError = Math.max(...normalized.map(([, db]) => Math.abs(db)));

    assert.equal(processed.analysisImpulseResponse.length, sweepLength);
    assert.ok(maximumError < 0.001, `maximum response error was ${maximumError} dB`);
});

test('sweep processing rejects recordings without all requested complete periods', t => {
    const previousInverseFilter = audioUtils.lastInverseFilter;
    t.after(() => { audioUtils.lastInverseFilter = previousInverseFilter; });
    audioUtils.lastInverseFilter = new Float32Array([1]);

    assert.throws(() => AudioProcessing.processRecordedBuffer.call({
        interfaceCalibrationImpulseResponse: null,
        currentMeasurement: { sweepMinFreq: 20, sweepMaxFreq: 20000 }
    }, new Float32Array(48000), 4096, 2, 48000), /enough complete sweep periods/);
});
