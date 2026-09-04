import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import audioUtils from '../../features/measurement/audio-utils/index.js';
import AudioProcessing, {
    createSweepCapturePlan,
    outputTimeReferenceForRoute,
    scheduledPlaybackFrameForTime,
    trimStartOffsetSamples
} from '../../features/measurement/measurement-controller/audio-processing.js';
import { trimMeasurementImpulseResponse } from '../../js/utils/measurement-dsp/onset.js';
import {
    normalizeResponseToZeroDb
} from '../../features/measurement/response-normalization.js';

function createRecorderHarness() {
    const messages = [];
    const processors = new Map();
    class FakeAudioWorkletProcessor {
        constructor() {
            this.port = {
                onmessage: null,
                postMessage(message) {
                    messages.push(message);
                }
            };
        }
    }
    const context = {
        AudioWorkletProcessor: FakeAudioWorkletProcessor,
        currentFrame: 0,
        console: { error() {}, warn() {} },
        registerProcessor(name, Processor) {
            processors.set(name, Processor);
        }
    };
    const source = fs.readFileSync(new URL(
        '../../features/measurement/audioWorkletProcessors.js', import.meta.url
    ), 'utf8');
    vm.runInNewContext(source, context);
    return {
        context,
        messages,
        recorder: new (processors.get('recorder-processor'))()
    };
}

function plainMessages(messages) {
    return JSON.parse(JSON.stringify(messages));
}

test('recorder reports the first recorded quantum after silent input quanta', () => {
    const { context, messages, recorder } = createRecorderHarness();
    recorder.port.onmessage({ data: { command: 'start' } });

    assert.deepEqual(plainMessages(messages), [{ status: 'started' }]);
    recorder.process([], [], {});
    recorder.process([[]], [], {});
    recorder.process([[new Float32Array(0)]], [], {});
    assert.deepEqual(plainMessages(messages), [{ status: 'started' }]);

    context.currentFrame = 1536;
    recorder.process([[Float32Array.of(0.25, -0.25)]], [], {});
    context.currentFrame = 1664;
    recorder.process([[Float32Array.of(0.5)]], [], {});

    assert.deepEqual(plainMessages(messages), [
        { status: 'started' },
        { status: 'capture-frame', startFrame: 1536 }
    ]);
});

test('recorder resets the capture frame for each recording start', () => {
    const { context, messages, recorder } = createRecorderHarness();
    recorder.port.onmessage({ data: { command: 'start' } });
    context.currentFrame = 512;
    recorder.process([[Float32Array.of(1)]], [], {});
    recorder.port.onmessage({ data: { command: 'start' } });
    context.currentFrame = 1024;
    recorder.process([[Float32Array.of(1)]], [], {});

    assert.deepEqual(plainMessages(messages.filter(message => message.status === 'capture-frame')), [
        { status: 'capture-frame', startFrame: 512 },
        { status: 'capture-frame', startFrame: 1024 }
    ]);
});

test('trim coordinates correct the measured capture offset with the documented sign and rounding', () => {
    const sampleRate = 48000;
    const scheduledPlaybackTime = 12 + 0.5 / sampleRate;
    const scheduledFrame = scheduledPlaybackFrameForTime(scheduledPlaybackTime, sampleRate);
    assert.equal(scheduledFrame, 576001);

    const preRollSamples = 24000;
    const analysisStartSamples = 16384;
    const captureStartFrame = 1000000;
    const measuredOffset = 35000;
    const trueOnset = 12000;
    const observedOnset = trueOnset + measuredOffset -
        (preRollSamples + analysisStartSamples);
    const offset = trimStartOffsetSamples(preRollSamples, analysisStartSamples, {
        scheduledPlaybackFrame: captureStartFrame + measuredOffset,
        captureStartFrame
    });
    const samples = new Float32Array(10000);
    samples[observedOnset] = 1;
    const trimmed = trimMeasurementImpulseResponse(
        samples,
        sampleRate,
        samples.length,
        observedOnset,
        offset
    );

    assert.equal(trimmed.trimStartSamples + trimmed.onsetIndex, trueOnset);
    assert.equal(offset, 5384);
});

test('the trim anchor reports the path latency of a capture that leads the pre-roll', t => {
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
    // The capture runs ahead of the assumed pre-roll and the loopback latency is
    // shorter than the stored pre-roll, which is where an anchor folded modulo
    // one sweep period reports a whole extra period of latency.
    const captureLead = 320;
    const measuredOffset = sampleRate / 2 + captureLead;
    const loopbackDelay = 256;
    const captureStartFrame = 4800000;
    audioUtils.initialized = true;

    const sweep = audioUtils.generateTSP(sweepLength, sampleRate, 'left', 20, 20000, false);
    const capturePlan = createSweepCapturePlan(sweepLength, averagingCount, sampleRate);
    const recording = new Float32Array(
        measuredOffset + loopbackDelay + capturePlan.repeatCount * sweepLength
    );
    for (let repeat = 0; repeat < capturePlan.repeatCount; repeat++) {
        recording.set(sweep.left, measuredOffset + loopbackDelay + repeat * sweepLength);
    }

    const processed = AudioProcessing.processRecordedBuffer.call({
        interfaceCalibrationImpulseResponse: null,
        currentMeasurement: {
            sweepMinFreq: audioUtils.sweepMinFreq,
            sweepMaxFreq: audioUtils.sweepMaxFreq
        }
    }, recording, sweepLength, averagingCount, sampleRate, {
        outputRoute: { mode: 'direct' },
        scheduledPlaybackFrame: captureStartFrame + measuredOffset,
        captureStartFrame
    });

    assert.equal(processed.outputTimeReference, 'audio-context');
    // Trimmed data that starts before the scheduled playback frame anchors negative.
    assert.equal(processed.trimStartSamples, -captureLead);
    assert.equal(processed.trimStartSamples + processed.onsetIndex, loopbackDelay);
});

test('a capture without an audio-context time reference stores no trim anchor', t => {
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
    const measuredOffset = sampleRate / 2;
    const loopbackDelay = 256;
    audioUtils.initialized = true;

    const sweep = audioUtils.generateTSP(sweepLength, sampleRate, 'left', 20, 20000, false);
    const capturePlan = createSweepCapturePlan(sweepLength, averagingCount, sampleRate);
    const recording = new Float32Array(
        measuredOffset + loopbackDelay + capturePlan.repeatCount * sweepLength
    );
    for (let repeat = 0; repeat < capturePlan.repeatCount; repeat++) {
        recording.set(sweep.left, measuredOffset + loopbackDelay + repeat * sweepLength);
    }

    // A media-element route has no frame-accurate playback clock, so the capture
    // offset is unknown and no anchor can be derived from the recording.
    const processed = AudioProcessing.processRecordedBuffer.call({
        interfaceCalibrationImpulseResponse: null,
        currentMeasurement: {
            sweepMinFreq: audioUtils.sweepMinFreq,
            sweepMaxFreq: audioUtils.sweepMaxFreq
        }
    }, recording, sweepLength, averagingCount, sampleRate, {
        outputRoute: { mode: 'media-element' }
    });

    assert.equal(processed.outputTimeReference, 'media-element');
    assert.equal(processed.trimStartSamples, null);
});

test('sweep result preserves only complete direct and media-element output time references', () => {
    const completeTiming = { scheduledPlaybackFrame: 576000, captureStartFrame: 552000 };
    assert.equal(outputTimeReferenceForRoute({ mode: 'direct' }, completeTiming), 'audio-context');
    assert.equal(outputTimeReferenceForRoute({ mode: 'media-element' }), 'media-element');
    assert.equal(outputTimeReferenceForRoute({ mode: 'direct' }), 'unknown');
    assert.equal(outputTimeReferenceForRoute({ mode: 'unknown' }, completeTiming), 'unknown');
    assert.equal(outputTimeReferenceForRoute({ mode: 'direct' }, {
        scheduledPlaybackFrame: completeTiming.scheduledPlaybackFrame
    }), 'unknown');
    assert.equal(outputTimeReferenceForRoute({ mode: 'direct' }, {
        captureStartFrame: completeTiming.captureStartFrame
    }), 'unknown');

    for (const outputTimeReference of ['audio-context', 'media-element', 'unknown']) {
        const result = AudioProcessing.createSweepMeasurementResult({
            impulseResponse: Float32Array.of(1),
            irValid: true,
            onsetIndex: 4,
            prerollSamples: 4,
            trimStartSamples: 32,
            outputTimeReference,
            sweepLimited: false,
            peakDb: 0,
            refScale: 1
        }, {});
        assert.equal(result.outputTimeReference, outputTimeReference);
        assert.equal(result.trimStartSamples, 32);
    }
});

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

test('different sweep bands retain equal loopback levels and calibrated gain differences', t => {
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
    audioUtils.initialized = true;
    const sampleRate = 48000, length = 131072;
    function loopback(minFreq, maxFreq, gain, calibration = null) {
        const sweep = audioUtils.generateTSP(length, sampleRate, 'left', minFreq, maxFreq, true);
        const plan = createSweepCapturePlan(length, 1, sampleRate);
        const recording = new Float32Array(sampleRate / 2 + plan.repeatCount * length);
        const signal = Float32Array.from(sweep.left, value => value * gain);
        for (let repeat = 0; repeat < plan.repeatCount; repeat++) {
            recording.set(signal, sampleRate / 2 + repeat * length);
        }
        const processed = AudioProcessing.processRecordedBuffer.call({
            interfaceCalibrationImpulseResponse: calibration,
            currentMeasurement: { sweepMinFreq: minFreq, sweepMaxFreq: maxFreq }
        }, recording, length, 1, sampleRate);
        const response = audioUtils.calculateFrequencyResponseWithSmoothing(
            processed.analysisImpulseResponse, sampleRate, true, 0.005);
        const magnitudes = response.map(([, value]) => value).sort((a, b) => a - b);
        const middle = Math.floor(magnitudes.length / 2);
        const median = magnitudes.length % 2 ? magnitudes[middle]
            : (magnitudes[middle - 1] + magnitudes[middle]) / 2;
        return { processed, median };
    }
    const low = loopback(20, 80, 1);
    const high = loopback(2000, 20000, 1);
    const quiet = loopback(2000, 20000, 0.5);
    const calibration = { data: high.processed.impulseResponse,
        onsetIndex: high.processed.onsetIndex, refScale: high.processed.refScale,
        sampleRate };
    const calibrated = loopback(2000, 20000, 0.5, calibration);
    const calibratedUnity = loopback(2000, 20000, 1, calibration);
    assert.ok(Math.abs(low.median - high.median) < 0.001,
        `low ${low.median} dB, high ${high.median} dB`);
    assert.ok(Math.abs(quiet.median - high.median - 20 * Math.log10(0.5)) < 0.001);
    assert.ok(Math.abs(calibrated.median - calibratedUnity.median - 20 * Math.log10(0.5)) < 0.001);
    assert.equal(calibrated.processed.refScale, 1);
    assert.ok(low.processed.refScale > 1);
    t.diagnostic(JSON.stringify({ low: low.median, high: high.median,
        quiet: quiet.median, calibrated: calibrated.median, calibratedUnity: calibratedUnity.median }));
});
