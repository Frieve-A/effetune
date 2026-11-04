import { createDffFixture, dffChunk } from './dsd-fixture.mjs';

function concat(parts) {
    const output = new Uint8Array(parts.reduce((length, bytes) => length + bytes.length, 0));
    let offset = 0;
    for (const bytes of parts) { output.set(bytes, offset); offset += bytes.length; }
    return output;
}

// Arithmetic code zero produces residual 1. Optional unit predictor taps
// exercise the initial alternating history instead of the default all-one output.
export function createCompressedDstPacket({ sampleRate = 2822400, channelCount = 2,
    coded = false, separateMaps = false, fixedProbability = false, predictionTaps } = {}) {
    const bits = [];
    const put = (value, count) => {
        for (let index = count - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
    };
    put(15, 4);
    put(separateMaps ? 0 : 1, 1);
    const mapping = () => {
        put(separateMaps ? 0 : 1, 1);
        if (separateMaps && channelCount === 2) put(1, 1);
    };
    mapping();
    if (separateMaps) mapping();
    for (let channel = 0; channel < channelCount; channel += 1) put(channel % 2, 1);
    for (const probability of [false, true]) {
        for (let element = 0; element < (separateMaps ? channelCount : 1); element += 1) {
            if (probability && fixedProbability) { put(0, 6); continue; }
            if (!probability && predictionTaps) {
                const tap = predictionTaps[element];
                put(tap, 7);
                put(0, 1);
                for (let index = 0; index <= tap; index += 1) put(index === tap ? 1 : 0, 9);
                continue;
            }
            put(coded ? 3 : probability ? 1 : 0, probability ? 6 : 7);
            put(coded ? 1 : 0, 1);
            if (coded) put(2, 2);
            for (let index = 0; index < (coded ? 3 : probability ? 2 : 1); index += 1) put(0, probability ? 7 : 9);
            if (coded) { put(0, 3); put(1, 1); }
        }
    }
    put(0, 1);
    const output = new Uint8Array(Math.ceil(bits.length / 8) +
        Math.ceil(sampleRate / 75 * channelCount / (fixedProbability ? 8 : 64)) + 128);
    for (let index = 0; index < bits.length; index += 1) output[index >>> 3] |= bits[index] << (7 - (index & 7));
    return output;
}

export function createDstFixture({ packets, sampleRate = 2822400, channelCount = 2, indexed = false,
    checksums = [], extraChunks = [] } = {}) {
    const base = createDffFixture({ sampleRate, channelCount, sampleCount: 8, unknown: false });
    const prefixLength = 28 + Number(new DataView(base.buffer).getBigUint64(20));
    const prefix = base.slice(0, prefixLength);
    const compressionOffset = Buffer.from(prefix).indexOf('DSD ', 16);
    prefix.set(new TextEncoder().encode('DST '), compressionOffset);
    const info = new Uint8Array(6);
    new DataView(info.buffer).setUint32(0, packets.length);
    new DataView(info.buffer).setUint16(4, 75);
    const chunks = [dffChunk('FRTE', info)];
    const index = new Uint8Array(packets.length * 12);
    const view = new DataView(index.buffer);
    let offset = prefix.length + 12 + chunks[0].length;
    for (let number = 0; number < packets.length; number += 1) {
        view.setBigUint64(number * 12, BigInt(offset + 12));
        view.setUint32(number * 12 + 8, packets[number].length);
        const chunk = dffChunk('DSTF', packets[number]);
        chunks.push(chunk);
        offset += chunk.length;
        if (checksums[number]) {
            const crc = dffChunk('DSTC', checksums[number]);
            chunks.push(crc);
            offset += crc.length;
        }
    }
    const result = concat([prefix, dffChunk('DST ', concat([...chunks, ...extraChunks])),
        ...(indexed ? [dffChunk('DSTI', index)] : [])]);
    new DataView(result.buffer).setBigUint64(4, BigInt(result.length - 12));
    return result;
}
