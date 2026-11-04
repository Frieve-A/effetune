import { dsdError, probeDsdSource, readDsdBytes } from './dsd-parser.js';
import { createDstSource } from './dst-source.js';
import { createDsdWasmArena } from './dsd-wasm.js';

const INTERMEDIATE_RATE = 176400;
const FIRST_DECIMATION = 16;
const PHASE_COUNT = 512;
const MAX_READ_FRAMES = 65536;
const MAX_RESIDENT_BYTES = 24 * 1024 * 1024;
const MAX_COEFFICIENT_CACHE_BYTES = 1024 * 1024;

function besselI0(value) {
    let sum = 1;
    let term = 1;
    for (let index = 1; index < 40; index += 1) {
        term *= value * value / (4 * index * index);
        sum += term;
        if (term < sum * 1e-16) break;
    }
    return sum;
}

export function createDsdLowpass(length, cutoff, phase = 0, coefficients = new Float64Array(length)) {
    const half = (length - 1) / 2;
    const denominator = besselI0(12);
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
        const distance = index - half - phase;
        const position = distance / half;
        const window = position <= -1 || position >= 1 ? 0 :
            besselI0(12 * Math.sqrt(1 - position * position)) / denominator;
        const coefficient = window * (distance === 0 ? 2 * cutoff :
            Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance));
        coefficients[index] = coefficient;
        sum += coefficient;
    }
    for (let index = 0; index < length; index += 1) coefficients[index] /= sum;
    return coefficients;
}

// Exposed as the filter contract so response tests measure the actual converter,
// independently of a DSD encoder's quantization noise.
export function createDsdFilterPlan(outputSampleRate) {
    if (!Number.isInteger(outputSampleRate) || outputSampleRate < 8000 || outputSampleRate > 384000) {
        throw dsdError('DSD_UNSUPPORTED', 'Unsupported DSD PCM output rate');
    }
    const stop = outputSampleRate < INTERMEDIATE_RATE ? outputSampleRate / 2 : INTERMEDIATE_RATE / 2;
    const pass = outputSampleRate >= 44100 ? 20000 : stop * 0.9;
    const transition = (stop - pass) / INTERMEDIATE_RATE;
    // Kaiser beta=12, with margin above the 100 dB stopband requirement.
    const length = 2 * Math.ceil(120 / (2.285 * 2 * Math.PI * transition) / 2) + 1;
    const cutoff = (pass + stop) / (2 * INTERMEDIATE_RATE);
    return { first: createDsdLowpass(353, 0.02), halfband: createDsdLowpass(63, 0.1875),
        final: createDsdLowpass(length, cutoff), cutoff,
        firstDecimation: FIRST_DECIMATION, intermediateRate: INTERMEDIATE_RATE };
}

function makeByteTable(coefficients, bitOrder, table) {
    const byteCount = Math.ceil(coefficients.length / 8);
    for (let byte = 0; byte < byteCount; byte += 1) {
        for (let value = 0; value < 256; value += 1) {
            let sum = 0;
            for (let bit = 0; bit < 8 && byte * 8 + bit < coefficients.length; bit += 1) {
                const shift = bitOrder === 'lsb' ? bit : 7 - bit;
                sum += ((value >>> shift) & 1 ? 1 : -1) * coefficients[byte * 8 + bit];
            }
            table[byte * 256 + value] = sum;
        }
    }
    return table;
}

async function readChannelBytes(reader, metadata, start, end) {
    const byteLength = Math.ceil(metadata.sampleCount / 8);
    const first = start < 0 ? 0 : start;
    const last = end > byteLength ? byteLength : end;
    const length = last > first ? last - first : 0;
    const channels = Array.from({ length: metadata.channelCount }, () => new Uint8Array(length));
    if (length === 0) return { channels, first };
    if (metadata.format === 'dsf') {
        const blockSize = metadata.blockSize;
        const firstBlock = Math.floor(first / blockSize);
        const lastBlock = Math.floor((last - 1) / blockSize);
        const sourceOffset = metadata.dataOffset + firstBlock * blockSize * metadata.channelCount;
        const sourceLength = (lastBlock - firstBlock + 1) * blockSize * metadata.channelCount;
        const packed = new Uint8Array(sourceLength);
        for (let offset = 0; offset < sourceLength;) {
            const remaining = sourceLength - offset;
            const count = remaining < 1024 * 1024 ? remaining : 1024 * 1024;
            packed.set(await readDsdBytes(reader, sourceOffset + offset, count), offset);
            offset += count;
        }
        for (let block = firstBlock; block <= lastBlock; block += 1) {
            const blockStart = block * blockSize;
            const begin = first > blockStart ? first : blockStart;
            const blockEnd = blockStart + blockSize;
            const finish = last < blockEnd ? last : blockEnd;
            for (let channel = 0; channel < metadata.channelCount; channel += 1) {
                const offset = ((block - firstBlock) * metadata.channelCount + channel) * blockSize +
                    begin - blockStart;
                channels[channel].set(packed.subarray(offset, offset + finish - begin), begin - first);
            }
        }
    } else {
        const total = length * metadata.channelCount;
        for (let offset = 0; offset < total;) {
            const remaining = total - offset;
            const count = remaining < 1024 * 1024 ? remaining : 1024 * 1024;
            const bytes = await readDsdBytes(reader, metadata.dataOffset + first * metadata.channelCount + offset, count);
            for (let index = 0; index < count; index += 1) {
                const position = offset + index;
                channels[position % metadata.channelCount][Math.floor(position / metadata.channelCount)] = bytes[index];
            }
            offset += count;
        }
    }
    return { channels, first };
}

export async function createDsdDecoder(reader, { metadata, outputSampleRate } = {}) {
    metadata = metadata || await probeDsdSource(reader);
    if (!metadata) throw dsdError('DSD_UNSUPPORTED', 'The source is not DSD');
    const dstSource = metadata.compression === 'dst' ? createDstSource(reader, metadata) : null;
    if (dstSource) {
        reader = dstSource;
        metadata = { ...metadata, dataOffset: 0, dataByteLength: dstSource.size };
    }
    let filters = createDsdFilterPlan(outputSampleRate);
    // Power-of-two slots permit a bounded direct-mapped cache in the kernel.
    const cacheSlots = 2 ** Math.floor(Math.log2(Math.min(PHASE_COUNT,
        MAX_COEFFICIENT_CACHE_BYTES / (filters.final.length * Float64Array.BYTES_PER_ELEMENT))));
    let arena = createDsdWasmArena({
        first: [Float64Array, filters.first.length], halfband: [Float64Array, filters.halfband.length],
        table: [Float64Array, Math.ceil(filters.first.length / 8) * 256],
        phases: [Float64Array, (PHASE_COUNT + 1) * filters.final.length],
        input: [Uint8Array, 131072], pcmA: [Float64Array, 65536], pcmB: [Float64Array, 65536],
        output: [Float32Array, 4096],
        cache: [Float64Array, cacheSlots * filters.final.length], keys: [Float64Array, cacheSlots]
    });
    arena.views.keys.fill(NaN);
    arena.views.first.set(filters.first);
    arena.views.halfband.set(filters.halfband);
    makeByteTable(filters.first, metadata.bitOrder, arena.views.table);
    for (let phase = 0; phase <= PHASE_COUNT; phase += 1) {
        createDsdLowpass(filters.final.length, filters.cutoff, phase / PHASE_COUNT,
            arena.views.phases.subarray(phase * filters.final.length, (phase + 1) * filters.final.length));
    }
    const stageCount = Math.log2(metadata.sampleRate / FIRST_DECIMATION / INTERMEDIATE_RATE);
    const totalFrames = Math.ceil(metadata.sampleCount / metadata.sampleRate * outputSampleRate);
    if (!Number.isSafeInteger(totalFrames)) throw dsdError('DSD_CORRUPT', 'DSD duration exceeds safe frame range');
    const blockFrames = Math.floor(outputSampleRate / 20) < 4096 ? Math.floor(outputSampleRate / 20) : 4096;
    const finalHalf = (filters.final.length - 1) / 2;
    const outputRatio = INTERMEDIATE_RATE / outputSampleRate;
    let disposed = false;
    let reading = false;

    async function decodeBlock(startFrame, frameCount, destination, destinationOffset) {
        const firstPosition = startFrame * outputRatio;
        const lastPosition = (startFrame + frameCount - 1) * outputRatio;
        const ranges = [{ start: Math.floor(firstPosition) - finalHalf,
            end: Math.floor(lastPosition) + finalHalf + 1 }];
        const half = (filters.halfband.length - 1) / 2;
        for (let stage = 0; stage < stageCount; stage += 1) {
            const previous = ranges[0];
            ranges.unshift({ start: previous.start * 2 - half, end: (previous.end - 1) * 2 + half + 1 });
        }
        const sourceRange = ranges[0];
        const byteHalf = (filters.first.length - 1) / 16;
        const source = await readChannelBytes(reader, metadata,
            sourceRange.start * (FIRST_DECIMATION / 8) - byteHalf,
            sourceRange.end * (FIRST_DECIMATION / 8) + byteHalf + 1);
        if (disposed) throw dsdError('DSD_DISPOSED', 'DSD decoder was disposed');
        const { api, offsets, views } = arena;
        for (let channel = 0; channel < metadata.channelCount; channel += 1) {
            if (source.channels[channel].length > views.input.length ||
                sourceRange.end - sourceRange.start > views.pcmA.length) {
                throw dsdError('DSD_CORRUPT', 'DSD conversion exceeds its scratch memory budget');
            }
            views.input.set(source.channels[channel]);
            api.dsd_decimate_bits(offsets.input, source.first, sourceRange.start,
                sourceRange.end - sourceRange.start, metadata.sampleCount,
                metadata.bitOrder === 'lsb' ? 1 : 0, offsets.first, offsets.table, offsets.pcmA);
            let input = offsets.pcmA;
            let output = offsets.pcmB;
            for (let stage = 1; stage < ranges.length; stage += 1) {
                api.dsd_decimate_pcm(input, ranges[stage].end - ranges[stage].start, offsets.halfband, output);
                [input, output] = [output, input];
            }
            const range = ranges[ranges.length - 1];
            api.dsd_resample(input, startFrame, frameCount, outputRatio, range.start,
                offsets.phases, filters.final.length, offsets.output, offsets.cache, offsets.keys, cacheSlots);
            destination[channel].set(views.output.subarray(0, frameCount), destinationOffset);
        }
    }

    return {
        sampleRate: outputSampleRate,
        channelCount: metadata.channelCount,
        totalFrames,
        durationSec: metadata.durationSec,
        // Includes the conversion arena (under 17 MiB even at 8 kHz), shared DST
        // arena (1.125 MiB), packet cache, bounded input reads and returned slab.
        // The conversion arena includes at most 1 MiB of exact coefficient cache.
        // It is independent of track duration and bounds in-flight work.
        get residentByteLength() { return disposed ? 0 : MAX_RESIDENT_BYTES; },
        async readFrames(startFrame, frameCount) {
            if (disposed) throw dsdError('DSD_DISPOSED', 'DSD decoder was disposed');
            if (reading) throw dsdError('DSD_BUSY', 'DSD decoder reads must be serialized');
            if (!Number.isSafeInteger(startFrame) || startFrame < 0 || startFrame > totalFrames ||
                !Number.isSafeInteger(frameCount) || frameCount < 0 || frameCount > MAX_READ_FRAMES) {
                throw dsdError('DSD_CORRUPT', 'Invalid DSD PCM read range');
            }
            const count = frameCount < totalFrames - startFrame ? frameCount : totalFrames - startFrame;
            const output = Array.from({ length: metadata.channelCount }, () => new Float32Array(count));
            reading = true;
            try {
                for (let offset = 0; offset < count; offset += blockFrames) {
                    const remaining = count - offset;
                    await decodeBlock(startFrame + offset, remaining < blockFrames ? remaining : blockFrames,
                        output, offset);
                }
                return output;
            } finally {
                reading = false;
            }
        },
        dispose() {
            disposed = true;
            dstSource?.dispose();
            filters = null;
            arena = null;
        }
    };
}
