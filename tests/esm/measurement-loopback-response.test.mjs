import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import AudioProcessing, {
    outputTimeReferenceForRoute,
} from '../../features/measurement/measurement-controller/audio-processing.js';
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
