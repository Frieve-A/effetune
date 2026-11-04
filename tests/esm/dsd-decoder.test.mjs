import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { createDsdDecoder, createDsdFilterPlan } from '../../js/audio/dsd/dsd-decoder.js';
import { probeDsdSource } from '../../js/audio/dsd/dsd-parser.js';
import { createDsfFixture, createDffFixture, createDsdReader, createVirtualDsfReader,
    encodeDsdSignal } from '../helpers/dsd-fixture.mjs';

function response(coefficients, frequency) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < coefficients.length; index += 1) {
        real += coefficients[index] * Math.cos(2 * Math.PI * frequency * index);
        imaginary += coefficients[index] * Math.sin(2 * Math.PI * frequency * index);
    }
    return Math.hypot(real, imaginary);
}

function amplitude(samples, sampleRate, frequency, first = 500, last = samples.length - 500) {
    let real = 0;
    let imaginary = 0;
    for (let frame = first; frame < last; frame += 1) {
        real += samples[frame] * Math.cos(2 * Math.PI * frequency * frame / sampleRate);
        imaginary += samples[frame] * Math.sin(2 * Math.PI * frequency * frame / sampleRate);
    }
    return 2 * Math.hypot(real, imaginary) / (last - first);
}

test('actual FIR stages preserve audible gain and reject each decimation stopband by 100 dB', () => {
    const reference = createDsdFilterPlan(44100);
    for (const [coefficients, stop] of [[reference.first, 1 / (2 * reference.firstDecimation)],
        [reference.halfband, 1 / 4]]) {
        assert.ok(Math.abs(response(coefficients, 0) - 1) < 1e-12);
        for (let index = 0; index <= 1000; index += 1) {
            assert.ok(response(coefficients, stop + (0.5 - stop) * index / 1000) < 1e-5);
        }
    }
    for (const outputRate of [8000, 32000, 44100, 48000, 96000, 192000, 384000]) {
        const plan = createDsdFilterPlan(outputRate);
        const pass = outputRate >= 44100 ? 20000 : outputRate * 0.45;
        const stop = Math.min(outputRate / 2, plan.intermediateRate / 2);
        for (let index = 0; index <= 200; index += 1) {
            const frequency = 20 + (pass - 20) * index / 200;
            for (const sourceRate of [2822400, 5644800, 11289600]) {
                let gain = response(plan.first, frequency / sourceRate);
                for (let rate = sourceRate / plan.firstDecimation; rate > plan.intermediateRate; rate /= 2) {
                    gain *= response(plan.halfband, frequency / rate);
                }
                gain *= response(plan.final, frequency / plan.intermediateRate);
                assert.ok(Math.abs(20 * Math.log10(gain)) <= 0.1,
                    `${sourceRate} -> ${outputRate}, ${frequency} Hz`);
            }
        }
        for (let index = 0; index <= 500; index += 1) {
            const frequency = stop + (plan.intermediateRate / 2 - stop) * index / 500;
            assert.ok(response(plan.final, frequency / plan.intermediateRate) < 1e-5,
                `${outputRate} stopband at ${frequency} Hz`);
        }
    }
});

test('DSF bit orders and raw interleaved DFF yield identical PCM without channel swapping', async () => {
    const sampleRate = 2822400;
    const sampleCount = sampleRate / 10;
    const signals = [time => 0.4 * Math.sin(2 * Math.PI * 1000 * time),
        time => 0.2 * Math.sin(2 * Math.PI * 3000 * time)];
    const outputs = [];
    for (const format of ['lsb', 'msb', 'dff']) {
        const bitOrder = format === 'lsb' ? 'lsb' : 'msb';
        const channels = signals.map(signal => encodeDsdSignal(sampleCount, sampleRate, signal, bitOrder));
        const bytes = format === 'dff' ? createDffFixture({ sampleRate, sampleCount, channels }) :
            createDsfFixture({ sampleRate, sampleCount, channels, bitOrder });
        const decoder = await createDsdDecoder(createDsdReader(bytes), { outputSampleRate: 48000 });
        outputs.push(await decoder.readFrames(0, decoder.totalFrames));
        assert.equal(decoder.totalFrames, 4800);
        assert.deepEqual(await decoder.readFrames(123, 3001), outputs.at(-1).map(channel => channel.slice(123, 3124)));
        decoder.dispose();
    }
    assert.deepEqual(outputs[0], outputs[1]);
    assert.deepEqual(outputs[0], outputs[2]);
    const first = 480;
    const last = 4320;
    assert.ok(Math.abs(20 * Math.log10(amplitude(outputs[0][0], 48000, 1000, first, last) / 0.4)) < 0.1);
    assert.ok(Math.abs(20 * Math.log10(amplitude(outputs[0][1], 48000, 3000, first, last) / 0.2)) < 0.1);
    assert.ok(amplitude(outputs[0][0], 48000, 3000, first, last) < 0.001);
});

test('supported source rates retain DC, signs, exact duration, and deterministic arbitrary seeks', async () => {
    for (const sampleRate of [2822400, 5644800, 11289600]) {
        const sampleCount = sampleRate / 10 + 3;
        const channels = [encodeDsdSignal(sampleCount, sampleRate, () => 0.25)];
        const reader = createDsdReader(createDsfFixture({ sampleRate, sampleCount, channelCount: 1, channels }));
        const metadata = await probeDsdSource(reader);
        const decoder = await createDsdDecoder(reader, { metadata, outputSampleRate: 44100 });
        assert.equal(decoder.totalFrames, 4411);
        assert.equal(decoder.durationSec, sampleCount / sampleRate);
        const whole = (await decoder.readFrames(0, decoder.totalFrames))[0];
        for (const value of whole.subarray(500, 4000)) assert.ok(Math.abs(value - 0.25) < 1e-5);
        for (const [start, count] of [[0, 7], [11, 313], [1023, 2000], [4400, 100]]) {
            assert.deepEqual((await decoder.readFrames(start, count))[0], whole.slice(start, start + count));
        }
        assert.equal((await decoder.readFrames(decoder.totalFrames, 1))[0].length, 0);
        await assert.rejects(decoder.readFrames(0, 65537), { code: 'DSD_CORRUPT' });
        decoder.dispose();
        assert.equal(decoder.residentByteLength, 0);
        await assert.rejects(decoder.readFrames(0, 1), { code: 'DSD_DISPOSED' });
    }
    const sampleCount = 282240;
    const channels = [new Uint8Array(sampleCount / 8).fill(255), new Uint8Array(sampleCount / 8)];
    const decoder = await createDsdDecoder(createDsdReader(createDsfFixture({ sampleCount, channels })),
        { outputSampleRate: 96000 });
    const pcm = await decoder.readFrames(1000, 100);
    assert.ok(pcm[0].every(value => Math.abs(value - 1) < 1e-6));
    assert.ok(pcm[1].every(value => Math.abs(value + 1) < 1e-6));
    decoder.dispose();
});

test('partial-byte padding is ignored and pending reads cannot survive dispose', async () => {
    const sampleCount = 40001;
    const bytes = createDsfFixture({ channelCount: 1, sampleCount,
        channels: [encodeDsdSignal(sampleCount, 2822400, () => 0.25)] });
    const altered = bytes.slice();
    altered[92 + Math.floor(sampleCount / 8)] |= 0xfe;
    altered.fill(255, 92 + Math.ceil(sampleCount / 8));
    const outputs = [];
    for (const data of [bytes, altered]) {
        const decoder = await createDsdDecoder(createDsdReader(data), { outputSampleRate: 48000 });
        outputs.push(await decoder.readFrames(0, decoder.totalFrames));
        decoder.dispose();
    }
    assert.deepEqual(outputs[0], outputs[1]);
    const reader = createDsdReader(bytes);
    const metadata = await probeDsdSource(reader);
    let finishRead;
    reader.read = (offset, length) => new Promise(resolve => {
        finishRead = () => resolve(bytes.slice(offset, offset + length));
    });
    const decoder = await createDsdDecoder(reader, { metadata, outputSampleRate: 48000 });
    const pending = decoder.readFrames(0, 100);
    decoder.dispose();
    finishRead();
    await assert.rejects(pending, { code: 'DSD_DISPOSED' });
});

test('out-of-band deterministic DSD patterns do not alias into audible PCM', async () => {
    for (const sampleRate of [2822400, 5644800, 11289600]) {
        const sampleCount = sampleRate / 10;
        const period = sampleRate / 44100;
        const channel = new Uint8Array(sampleCount / 8);
        for (let sample = 0; sample < sampleCount; sample += 1) {
            if (sample % period < period / 2) channel[Math.floor(sample / 8)] |= 1 << (sample % 8);
        }
        for (const outputSampleRate of [44100, 48000]) {
            const decoder = await createDsdDecoder(createDsdReader(createDsfFixture({ sampleRate, sampleCount,
                channelCount: 1, channels: [channel] })), { outputSampleRate });
            const pcm = (await decoder.readFrames(0, decoder.totalFrames))[0];
            let power = 0;
            for (const value of pcm.subarray(500, pcm.length - 500)) power += value * value;
            const rms = Math.sqrt(power / (pcm.length - 1000));
            assert.ok(rms < 1e-5, `${sampleRate} -> ${outputSampleRate}: ${20 * Math.log10(rms)} dB`);
            decoder.dispose();
        }
    }
});

test('long DSD256 uses bounded reads and memory, with sustained decode throughput diagnostics', async t => {
    const sampleRate = 11289600;
    const budgets = [];
    for (const duration of [60, 7200]) {
        const reader = createVirtualDsfReader({ sampleRate, sampleCount: sampleRate * duration });
        const decoder = await createDsdDecoder(reader, { outputSampleRate: 44100 });
        budgets.push(decoder.residentByteLength);
        await decoder.readFrames(10000, 4096);
        const started = performance.now();
        for (let block = 0; block < 8; block += 1) {
            const output = await decoder.readFrames(44100 * (duration - 2) + block * 4096, 4096);
            assert.ok(output.every(channel => channel.every(Number.isFinite)));
        }
        const elapsed = performance.now() - started;
        const audioSeconds = 8 * 4096 / 44100;
        t.diagnostic(`${duration}s source: ${(audioSeconds / (elapsed / 1000)).toFixed(2)}x real time; ` +
            `${decoder.residentByteLength} reserved bytes; max read ${reader.maxReadLength} bytes`);
        assert.ok(reader.maxReadLength <= 1024 * 1024);
        assert.ok(reader.readBytes < 8 * 1024 * 1024);
        assert.ok(decoder.residentByteLength <= 24 * 1024 * 1024);
        decoder.dispose();
    }
    assert.equal(budgets[0], budgets[1]);
});
