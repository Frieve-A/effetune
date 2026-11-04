import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeDstFrame } from '../../js/audio/dsd/dst-decoder.js';
import { createDstSource } from '../../js/audio/dsd/dst-source.js';
import { createDsdDecoder } from '../../js/audio/dsd/dsd-decoder.js';
import { probeDsdSource } from '../../js/audio/dsd/dsd-parser.js';
import { createDsdReader, createDffFixture, dffChunk } from '../helpers/dsd-fixture.mjs';
import { createCompressedDstPacket, createDstFixture } from '../helpers/dst-fixture.mjs';

test('DST compressed frames decode mapped and Rice-coded tables at all supported rates', () => {
    for (const sampleRate of [2822400, 5644800, 11289600]) {
        for (const channelCount of [1, 2]) {
            for (const coded of [false, true]) {
                const packet = createCompressedDstPacket({ sampleRate, channelCount, coded, separateMaps: coded });
                const output = decodeDstFrame(packet, channelCount, sampleRate / 75);
                assert.equal(output.length, sampleRate / 75 / 8 * channelCount);
                assert.ok(output.every(byte => byte === 255));
            }
        }
    }
});

test('DST uncoded packets retain interleaved bytes and reject truncation and unsupported segmentation', () => {
    const packet = Uint8Array.from({ length: 9409 }, (_, index) => index ? index % 251 : 0);
    assert.deepEqual(decodeDstFrame(packet, 2, 37632), packet.slice(1));
    for (const bytes of [packet.slice(0, -1), packet.slice(0, 1), new Uint8Array([0x01, 0])]) {
        assert.throws(() => decodeDstFrame(bytes, 2, 37632), { code: 'DSD_CORRUPT' });
    }
    assert.throws(() => decodeDstFrame(new Uint8Array([0x80, 0]), 2, 37632), { code: 'DSD_UNSUPPORTED' });
    assert.throws(() => decodeDstFrame(createCompressedDstPacket().slice(0, 12), 2, 37632), { code: 'DSD_CORRUPT' });
});

test('DST nonzero predictors preserve channel histories across both 64-bit words', () => {
    for (const sampleRate of [2822400, 5644800, 11289600]) {
        const taps = [64, 127];
        const packet = createCompressedDstPacket({ sampleRate, separateMaps: true,
            fixedProbability: true, predictionTaps: taps });
        const samples = sampleRate / 75;
        const expected = new Uint8Array(samples / 8 * 2);
        // A positive unit tap and residual 1 repeat the initial history with
        // period tap + 1; this closed form is independent of the shift layout.
        for (let sample = 0; sample < samples; sample += 1) {
            for (let channel = 0; channel < 2; channel += 1) {
                const tap = taps[channel];
                const bit = (tap - sample % (tap + 1)) & 1;
                expected[(sample >>> 3) * 2 + channel] |= bit << (7 - (sample & 7));
            }
        }
        assert.deepEqual(decodeDstFrame(packet, 2, samples), expected);
    }
});

test('DST streams use bounded packet reads and reproduce raw PCM across packets, seeks and EOF', async () => {
    const count = 20;
    const packets = Array.from({ length: count }, (_, frame) =>
        Uint8Array.from({ length: 9409 }, (_, index) => index ? (index * 17 + frame * 37) % 256 : 0));
    const raw = Buffer.concat(packets.map(packet => packet.subarray(1)));
    const channels = [0, 1].map(channel => Uint8Array.from({ length: raw.length / 2 }, (_, i) => raw[i * 2 + channel]));
    const reference = await createDsdDecoder(createDsdReader(createDffFixture({ sampleCount: count * 37632, channels })),
        { outputSampleRate: 48000 });
    try {
        for (const indexed of [false, true]) {
            const reader = createDsdReader(createDstFixture({ packets, indexed,
                extraChunks: [dffChunk('JUNK', new Uint8Array([1]))] }));
            const metadata = await probeDsdSource(reader);
            assert.equal(metadata.dstFrameCount, count);
            assert.equal(metadata.sampleCount, count * 37632);
            assert.ok(reader.reads.length < 20, 'Probe must not scan every DST packet');
            const decoder = await createDsdDecoder(reader, { metadata, outputSampleRate: 48000 });
            try {
                for (const [start, length] of [[0, 6401], [10000, 4000], [631, 1219], [0, 12800], [12800, 1]]) {
                    assert.deepEqual(await decoder.readFrames(start, length), await reference.readFrames(start, length));
                }
                assert.ok(reader.reads.every(read => read.length <= 9409));
            } finally { decoder.dispose(); }
            assert.equal(decoder.residentByteLength, 0);
        }
    } finally { reference.dispose(); }
});

test('DST compressed packets pass through the common PCM converter unchanged', async () => {
    const packets = Array.from({ length: 12 }, (_, index) => createCompressedDstPacket({
        coded: true, separateMaps: true, fixedProbability: index % 2 === 0 }));
    const dst = await createDsdDecoder(createDsdReader(createDstFixture({ packets })), { outputSampleRate: 44100 });
    const raw = await createDsdDecoder(createDsdReader(createDffFixture({ sampleCount: 12 * 37632,
        channels: [new Uint8Array(12 * 4704).fill(255), new Uint8Array(12 * 4704).fill(255)] })),
    { outputSampleRate: 44100 });
    try { assert.deepEqual(await dst.readFrames(0, dst.totalFrames), await raw.readFrames(0, raw.totalFrames)); }
    finally { dst.dispose(); raw.dispose(); }
});

test('DST frame count, index and optional CRC reject damaged audio', async () => {
    const packet = new Uint8Array(9409);
    const validCrc = new Uint8Array(4);
    const good = createDstFixture({ packets: [packet], checksums: [validCrc], indexed: true });
    const metadata = await probeDsdSource(createDsdReader(good));
    const source = createDstSource(createDsdReader(good), metadata);
    try { assert.deepEqual(await source.read(0, source.size), packet.slice(1)); }
    finally { source.dispose(); }
    const damaged = good.slice();
    damaged[metadata.dataOffset + 18 + 12 + 1] = 1;
    const badIndex = good.slice();
    new DataView(badIndex.buffer).setBigUint64(metadata.dstIndexOffset, 0n);
    const wrongCount = createDstFixture({ packets: [packet, packet] });
    const wrongMetadata = await probeDsdSource(createDsdReader(wrongCount));
    new DataView(wrongCount.buffer).setUint32(wrongMetadata.dataOffset + 12, 1);
    for (const bytes of [damaged, badIndex, wrongCount]) {
        const reader = createDsdReader(bytes);
        const stream = createDstSource(reader, await probeDsdSource(reader));
        try { await assert.rejects(stream.read(0, stream.size), { code: 'DSD_CORRUPT' }); }
        finally { stream.dispose(); }
    }
});

test('DST disposal interrupts an in-flight range read and prevents later reads', async () => {
    const bytes = createDstFixture({ packets: [new Uint8Array(9409)] });
    const metadata = await probeDsdSource(createDsdReader(bytes));
    let release;
    const reader = { size: bytes.length, read: (offset, length) => new Promise(resolve => {
        release = () => resolve(bytes.slice(offset, offset + length));
    }) };
    const source = createDstSource(reader, metadata);
    const pending = source.read(0, 10);
    source.dispose();
    release();
    await assert.rejects(pending, { code: 'DSD_DISPOSED' });
    await assert.rejects(source.read(0, 10), { code: 'DSD_DISPOSED' });
});
