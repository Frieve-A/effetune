import assert from 'node:assert/strict';
import test from 'node:test';
import { createDsdSpeedDecoder } from '../../js/audio/dsd/dsd-speed-decoder.js';

function syntheticDecoder({ sampleRate = 48000, seconds = 2, frequency = 1000,
    signal = null, channelCount = 2 } = {}) {
    let disposed = false;
    let readCount = 0;
    let largestRead = 0;
    return {
        sampleRate, channelCount, totalFrames: Math.floor(sampleRate * seconds), durationSec: seconds,
        get residentByteLength() { return disposed ? 0 : 1024; },
        get disposed() { return disposed; },
        get readCount() { return readCount; },
        get largestRead() { return largestRead; },
        async readFrames(start, count) {
            assert.equal(disposed, false);
            assert.ok(start >= 0 && start <= this.totalFrames);
            assert.ok(count <= 65536);
            readCount += 1;
            largestRead = Math.max(largestRead, count);
            return Array.from({ length: channelCount }, (_, channel) => Float32Array.from(
                { length: Math.min(count, this.totalFrames - start) }, (_, index) => {
                    const time = (start + index) / sampleRate;
                    return signal ? signal(time, channel) :
                        (channel ? -0.25 : 0.5) * Math.sin(2 * Math.PI * frequency * time);
                }));
        },
        dispose() { disposed = true; }
    };
}

function toneAmplitude(samples, rate, frequency, start = 960, end = samples.length - 960) {
    let real = 0;
    let imaginary = 0;
    for (let index = start; index < end; index += 1) {
        real += samples[index] * Math.cos(2 * Math.PI * frequency * index / rate);
        imaginary += samples[index] * Math.sin(2 * Math.PI * frequency * index / rate);
    }
    return 2 * Math.hypot(real, imaginary) / (end - start);
}

test('normal speed bypasses all processing and retains the original decoder contract', async () => {
    const base = syntheticDecoder();
    assert.equal(await createDsdSpeedDecoder(base, { speed: 1 }), base);
    await assert.rejects(createDsdSpeedDecoder(base, { speed: 0 }), { code: 'DSD_UNSUPPORTED' });
    base.dispose();
});

test('all speed steps preserve pitch, stereo alignment, duration, and streaming chunk boundaries', async () => {
    for (const speed of [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4]) {
        const base = syntheticDecoder();
        const decoder = await createDsdSpeedDecoder(base, { speed, preservePitch: true });
        assert.equal(decoder.totalFrames, Math.ceil(base.totalFrames / speed));
        assert.equal(decoder.durationSec, 2);
        const whole = await decoder.readFrames(0, 12000);
        assert.ok(Math.abs(toneAmplitude(whole[0], 48000, 1000) - 0.5) < 0.02, `speed ${speed}`);
        assert.ok(whole[0].every((value, index) => Math.abs(whole[1][index] + value * 0.5) < 1e-6));
        const fresh = await createDsdSpeedDecoder(syntheticDecoder(), { speed, preservePitch: true });
        const pieces = [];
        let start = 0;
        for (const count of [73, 2021, 4000, 5906]) {
            pieces.push(await fresh.readFrames(start, count));
            start += count;
        }
        for (let channel = 0; channel < 2; channel += 1) {
            const joined = new Float32Array(12000);
            let offset = 0;
            for (const piece of pieces) { joined.set(piece[channel], offset); offset += piece[channel].length; }
            assert.deepEqual(joined, whole[channel]);
        }
        assert.ok(base.largestRead <= 65536);
        decoder.dispose();
        fresh.dispose();
        assert.equal(decoder.residentByteLength, 0);
        assert.equal(base.disposed, true);
    }
});

test('pitch-changing speed uses bandlimited resampling with deterministic seeks', async () => {
    for (const speed of [0.25, 0.75, 1.25, 2, 4]) {
        const decoder = await createDsdSpeedDecoder(syntheticDecoder(), { speed, preservePitch: false });
        const whole = await decoder.readFrames(0, 12000);
        assert.ok(Math.abs(toneAmplitude(whole[0], 48000, 1000 * speed) - 0.5) < 0.01);
        assert.deepEqual(await decoder.readFrames(111, 3027), whole.map(channel => channel.slice(111, 3138)));
        decoder.dispose();
    }
    const decoder = await createDsdSpeedDecoder(syntheticDecoder({ frequency: 10000 }),
        { speed: 4, preservePitch: false });
    const samples = (await decoder.readFrames(0, 12000))[0];
    assert.ok(toneAmplitude(samples, 48000, 8000) < 1e-5);
    decoder.dispose();
});

test('WSOLA alignment preserves low bass periods and non-integer-cycle tones', async () => {
    for (const frequency of [20, 50, 443]) {
        for (const speed of [0.25, 1.5, 4]) {
            const decoder = await createDsdSpeedDecoder(syntheticDecoder({ frequency }), { speed });
            const count = Math.min(48000, decoder.totalFrames);
            const pcm = (await decoder.readFrames(0, count))[0];
            assert.ok(Math.abs(toneAmplitude(pcm, 48000, frequency, 4800, count - 4800) - 0.5) < 0.02,
                `${frequency} Hz at ${speed}x`);
            decoder.dispose();
        }
    }
});

test('WSOLA seeks rebuild bounded history at the requested original time', async () => {
    const base = syntheticDecoder({ seconds: 7200,
        signal: time => time < 3600 ? 0.25 : -0.25 });
    const decoder = await createDsdSpeedDecoder(base, { speed: 1.37 });
    assert.ok((await decoder.readFrames(Math.floor(3500 * 48000 / 1.37), 4000))[0]
        .every(value => Math.abs(value - 0.25) < 1e-6));
    assert.ok((await decoder.readFrames(Math.floor(3700 * 48000 / 1.37), 4000))[0]
        .every(value => Math.abs(value + 0.25) < 1e-6));
    assert.ok(base.readCount < 10);
    assert.equal((await decoder.readFrames(decoder.totalFrames, 1))[0].length, 0);
    const tail = await decoder.readFrames(decoder.totalFrames - 17, 100);
    assert.equal(tail[0].length, 17);
    assert.ok(tail.every(channel => channel.every(Number.isFinite)));
    decoder.dispose();
    await assert.rejects(decoder.readFrames(0, 1), { code: 'DSD_DISPOSED' });
});

test('silence, short tracks, fractional speed and cancellation stay finite and bounded', async () => {
    for (const preservePitch of [false, true]) {
        const base = syntheticDecoder({ sampleRate: 8000, seconds: 0.003, signal: () => 0 });
        const decoder = await createDsdSpeedDecoder(base, { speed: 3.91, preservePitch });
        const output = await decoder.readFrames(0, 100);
        assert.equal(output[0].length, Math.ceil(24 / 3.91));
        assert.ok(output.every(channel => channel.every(value => value === 0)));
        decoder.dispose();
    }
    const base = syntheticDecoder();
    let release;
    base.readFrames = (start, count) => new Promise(resolve => {
        release = () => resolve([new Float32Array(count), new Float32Array(count)]);
    });
    const decoder = await createDsdSpeedDecoder(base, { speed: 2 });
    const pending = decoder.readFrames(0, 100);
    await Promise.resolve();
    decoder.dispose();
    release();
    await assert.rejects(pending, { code: 'DSD_DISPOSED' });
    assert.equal(decoder.residentByteLength, 0);
});
