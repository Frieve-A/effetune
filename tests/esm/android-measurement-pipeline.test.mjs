import assert from 'node:assert/strict';
import test from 'node:test';
import { captureAndroidSweep, startAndroidNoise } from '../../js/android/measurement.js';

test('Android sends the selected pipeline route for each test signal and releases a clipped capture', async () => {
    const calls = [];
    const bridge = { async request(command, payload) {
        calls.push({ command, payload });
        if (command === 'measurement.status') return { status: 'clipped' };
    } };
    const samples = Float32Array.of(0.5);
    await startAndroidNoise({ length: 1, numberOfChannels: 1, sampleRate: 48000, getChannelData: () => samples },
        { bridge, levelDb: -18, effectPipeline: true });
    assert.equal(calls[0].payload.effectPipeline, true);
    for (const effectPipeline of [false, true]) {
        calls.length = 0;
        await assert.rejects(captureAndroidSweep({ length: 1, channels: [samples], sampleRate: 8, tailSamples: 0 },
            { bridge, repetitions: 1, levelDb: -12, effectPipeline }), { code: 'pipelineClipping' });
        assert.equal(calls[0].payload.effectPipeline, effectPipeline);
        assert.equal(calls.at(-1).command, 'measurement.cancel');
    }
});

test('Android starts the level graph after capture starts with the full capture duration', async () => {
    const events = [];
    const bridge = { async request(command) {
        events.push(command);
        if (command === 'measurement.status') return { status: 'clipped' };
    } };
    await assert.rejects(captureAndroidSweep({ length: 2, channels: [Float32Array.of(0, 0)], sampleRate: 8, tailSamples: 0 },
        { bridge, repetitions: 1, levelDb: 0, onCaptureStart: duration => events.push(duration) }),
    { code: 'pipelineClipping' });
    assert.deepEqual(events.slice(-4), ['measurement.start', 1.25, 'measurement.status', 'measurement.cancel']);
});

test('Android cancels capture without starting the level graph when aborted during native startup', async () => {
    const events = [];
    const abort = new AbortController();
    const start = Promise.withResolvers();
    const ready = Promise.withResolvers();
    const bridge = { async request(command) {
        events.push(command);
        if (command === 'measurement.start') {
            start.resolve();
            await ready.promise;
        }
    } };
    const capture = captureAndroidSweep({ length: 2, channels: [Float32Array.of(0, 0)], sampleRate: 8, tailSamples: 0 },
        { bridge, repetitions: 1, levelDb: 0, signal: abort.signal, onCaptureStart: duration => events.push(duration) });
    await start.promise;
    abort.abort();
    ready.resolve();
    await assert.rejects(capture, { name: 'AbortError' });
    assert.deepEqual(events, ['measurement.begin', 'measurement.chunk', 'measurement.start', 'measurement.cancel']);
});

test('six-channel Android excitation preserves channel order and keeps a stereo microphone recording', async () => {
    const uploads = [];
    const frames = 10;
    const bridge = { async request(command, payload) {
        if (command.endsWith('.chunk')) {
            const bytes = Uint8Array.from(Buffer.from(payload.data, 'base64'));
            uploads.push(Array.from(new Float32Array(bytes.buffer)));
        }
        if (command === 'measurement.status') return { status: 'complete' };
        if (command === 'measurement.read') return { frames, sampleRate: 8, channels: 2,
            data: Buffer.alloc(frames * 8).toString('base64') };
    } };
    const samples = Float32Array.of(0.25, -0.5);
    await startAndroidNoise({ length: 2, numberOfChannels: 1, sampleRate: 8, getChannelData: () => samples },
        { bridge, levelDb: 0, channel: '5', outputChannelCount: 6 });
    assert.deepEqual(uploads.pop(), [0, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0, -0.5]);
    const capture = await captureAndroidSweep({ length: 2, channels: [null, null, samples], sampleRate: 8, tailSamples: 0 },
        { bridge, repetitions: 1, levelDb: 0, outputChannelCount: 6 });
    assert.deepEqual(uploads.pop().slice(4 * 6, 6 * 6), [0, 0, 0.25, 0, 0, 0, 0, 0, -0.5, 0, 0, 0]);
    assert.equal(capture.recording.length, frames);
});
