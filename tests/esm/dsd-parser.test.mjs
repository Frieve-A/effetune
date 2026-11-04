import assert from 'node:assert/strict';
import test from 'node:test';
import { probeDsdSource } from '../../js/audio/dsd/dsd-parser.js';
import { createDsfFixture, createDffFixture, createDsdReader, createVirtualDsfReader,
    dffChunk, writeAscii } from '../helpers/dsd-fixture.mjs';

test('DSF accepts supported rates, mono/stereo, both bit orders, and a partial final byte', async () => {
    for (const sampleRate of [2822400, 5644800, 11289600]) {
        for (const channelCount of [1, 2]) {
            for (const bitOrder of ['lsb', 'msb']) {
                const reader = createDsdReader(createDsfFixture({ sampleRate, channelCount, bitOrder, sampleCount: 40001 }));
                const metadata = await probeDsdSource(reader);
                assert.equal(metadata.sampleCount, 40001);
                assert.equal(metadata.sampleRate, sampleRate);
                assert.equal(metadata.channelCount, channelCount);
                assert.equal(metadata.bitOrder, bitOrder);
                assert.equal(metadata.bitsPerSample, 1);
                assert.equal(metadata.durationSec, 40001 / sampleRate);
                assert.ok(reader.reads.every(read => read.length <= 52));
            }
        }
    }
});

test('raw DFF reads big endian properties and skips unknown odd padded chunks', async () => {
    for (const sampleRate of [2822400, 5644800, 11289600]) {
        const metadata = await probeDsdSource(createDsdReader(createDffFixture({ sampleRate })));
        assert.equal(metadata.format, 'dff');
        assert.equal(metadata.sampleRate, sampleRate);
        assert.equal(metadata.sampleCount, 40000);
        assert.equal(metadata.channelCount, 2);
        assert.equal(metadata.bitOrder, 'msb');
    }
});

test('recognized unsupported DSD is distinct from corrupt DSD and ordinary media', async () => {
    assert.equal(await probeDsdSource(createDsdReader(new Uint8Array([1, 2, 3]))), null);
    assert.equal(await probeDsdSource(createDsdReader(new Uint8Array(100))), null);
    for (const bytes of [createDsfFixture({ sampleRate: 22579200 }),
        createDsfFixture({ sampleRate: 3072000 }), createDsfFixture({ channelCount: 6 }),
        createDffFixture({ compression: 'BAD ' }), createDffFixture({ channelCount: 6 })]) {
        await assert.rejects(probeDsdSource(createDsdReader(bytes)), { code: 'DSD_UNSUPPORTED' });
    }
    const valid = createDsfFixture();
    for (const bytes of [valid.slice(0, 4), valid.slice(0, -1)]) {
        await assert.rejects(probeDsdSource(createDsdReader(bytes)), { code: 'DSD_CORRUPT' });
    }
    const unsafe = valid.slice();
    new DataView(unsafe.buffer).setBigUint64(64, 2n ** 63n, true);
    await assert.rejects(probeDsdSource(createDsdReader(unsafe)), { code: 'DSD_CORRUPT' });
    const oversized = createDffFixture();
    new DataView(oversized.buffer).setBigUint64(20, BigInt(oversized.length));
    await assert.rejects(probeDsdSource(createDsdReader(oversized)), { code: 'DSD_CORRUPT' });
    await assert.rejects(probeDsdSource({ size: valid.length, read: async () => new Uint8Array(0) }),
        { code: 'DSD_CORRUPT' });
});

test('large DSF and DFF offsets are probed without reading payloads', async () => {
    const sampleCount = 11289600 * 7200;
    const virtual = createVirtualDsfReader({ sampleCount });
    assert.ok(virtual.size > 2 ** 32);
    assert.equal((await probeDsdSource(virtual)).sampleCount, sampleCount);
    assert.ok(virtual.readBytes < 128);

    const ordinary = createDffFixture({ sampleCount: 8, unknown: false });
    const propertySize = 12 + Number(new DataView(ordinary.buffer).getBigUint64(20));
    const audio = ordinary.slice(16 + propertySize);
    const offset = 2 ** 32 + 16;
    const header = ordinary.slice(0, 16);
    const junk = dffChunk('JUNK', new Uint8Array(0));
    new DataView(junk.buffer).setBigUint64(4, BigInt(offset - 28));
    const size = offset + propertySize + audio.length;
    new DataView(header.buffer).setBigUint64(4, BigInt(size - 12));
    const segments = [[0, header], [16, junk], [offset, ordinary.slice(16, 16 + propertySize)],
        [offset + propertySize, audio]];
    const reader = { size, async read(position, length) {
        assert.ok(length <= 12 || position === 0);
        const bytes = new Uint8Array(length);
        for (const [start, segment] of segments) {
            for (let index = 0; index < length; index += 1) {
                if (position + index >= start && position + index < start + segment.length) {
                    bytes[index] = segment[position + index - start];
                }
            }
        }
        return bytes;
    } };
    assert.equal((await probeDsdSource(reader)).dataOffset, offset + propertySize + 12);
    const bad = ordinary.slice();
    writeAscii(bad, 16 + propertySize, 'DST ');
    await assert.rejects(probeDsdSource(createDsdReader(bad)), { code: 'DSD_CORRUPT' });
});
