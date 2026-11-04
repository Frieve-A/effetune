import assert from 'node:assert/strict';
import test from 'node:test';
import { DSD_WASM_BASE64 } from '../../js/audio/dsd/dsd-wasm.generated.js';
import { createDsdWasmArena } from '../../js/audio/dsd/dsd-wasm.js';
import { createDsdDecoder } from '../../js/audio/dsd/dsd-decoder.js';
import { checkDsdWasm } from '../../scripts/build-dsd-wasm.mjs';
import { createDsdReader, createDsfFixture, createVirtualDsfReader } from '../helpers/dsd-fixture.mjs';

test('DSD WebAssembly is current, self-contained and bounded with private instance memory', () => {
    checkDsdWasm();
    const module = new WebAssembly.Module(Buffer.from(DSD_WASM_BASE64, 'base64'));
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    const first = createDsdWasmArena({ scratch: [Float64Array, 8] });
    const second = createDsdWasmArena({ scratch: [Float64Array, 8] });
    first.views.scratch[0] = 123;
    assert.equal(second.views.scratch[0], 0);
    const pages = first.api.memory.buffer.byteLength / 65536;
    first.api.memory.grow(320 - pages);
    assert.throws(() => first.api.memory.grow(1), RangeError);
});

test('WASM scratch handles DSD256 at minimum and maximum output rates through seek and EOF', async () => {
    const sampleRate = 11289600;
    for (const outputSampleRate of [8000, 384000]) {
        const decoder = await createDsdDecoder(createVirtualDsfReader({ sampleCount: sampleRate * 2 + 3 }),
            { outputSampleRate });
        try {
            const start = Math.floor(outputSampleRate / 2);
            const count = Math.min(65536, outputSampleRate / 4);
            const whole = await decoder.readFrames(start, count);
            const split = Math.floor(count / 2) + 1;
            const tail = await decoder.readFrames(start + split, count - split);
            assert.deepEqual(tail, whole.map(channel => channel.slice(split)));
            assert.ok(whole.every(channel => channel.every(Number.isFinite)));
            const last = await decoder.readFrames(decoder.totalFrames - 7, 100);
            assert.ok(last.every(channel => channel.length === 7 && channel.every(Number.isFinite)));
            assert.equal(decoder.residentByteLength, 24 * 1024 * 1024);
        } finally {
            decoder.dispose();
        }
    }
});

test('SIMD lanes and exact coefficient caches preserve channel data across reordered fractional seeks', async () => {
    const sampleRate = 11289600;
    const sampleCount = sampleRate / 5 + 3;
    const channels = [17, 71].map(seed => {
        const bytes = new Uint8Array(Math.ceil(sampleCount / 8));
        for (let index = 0; index < bytes.length; index += 1) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            bytes[index] = seed >>> 24;
        }
        return bytes;
    });
    for (const outputSampleRate of [44117, 96000, 192000, 384000]) {
        const bytes = createDsfFixture({ sampleRate, sampleCount, channels });
        const decoder = await createDsdDecoder(createDsdReader(bytes), { outputSampleRate });
        try {
            const count = Math.min(decoder.totalFrames, 65536);
            const expected = await decoder.readFrames(0, count);
            for (const [start, length] of [[101, 1007], [39, 3073], [0, 13], [count - 17, 17]]) {
                assert.deepEqual(await decoder.readFrames(start, length),
                    expected.map(channel => channel.slice(start, start + length)));
            }
        } finally {
            decoder.dispose();
        }
    }
});
