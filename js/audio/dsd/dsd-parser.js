const MAX_READ_BYTES = 1024 * 1024;
const DSD_RATES = new Set([2822400, 5644800, 11289600]);

export function dsdError(code, message) {
    return Object.assign(new Error(message), { code });
}

function requireValid(condition, message) {
    if (!condition) throw dsdError('DSD_CORRUPT', message);
}

function requireSupported(condition, message) {
    if (!condition) throw dsdError('DSD_UNSUPPORTED', message);
}

export async function readDsdBytes(reader, offset, length) {
    requireValid(Number.isSafeInteger(offset) && Number.isSafeInteger(length) &&
        offset >= 0 && length >= 0 && length <= MAX_READ_BYTES &&
        offset <= reader.size - length, 'DSD read is outside the file bounds');
    const bytes = await reader.read(offset, length);
    requireValid(bytes instanceof Uint8Array && bytes.length === length, 'Truncated DSD read');
    return bytes;
}

function ascii(bytes, offset = 0) {
    return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function uint64(bytes, offset, littleEndian) {
    const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .getBigUint64(offset, littleEndian);
    requireValid(value <= BigInt(Number.MAX_SAFE_INTEGER), 'DSD size exceeds safe integer range');
    return Number(value);
}

function completeMetadata(metadata) {
    requireSupported(DSD_RATES.has(metadata.sampleRate), 'Unsupported DSD sample rate');
    requireSupported(metadata.channelCount === 1 || metadata.channelCount === 2,
        'Unsupported DSD channel count');
    requireValid(Number.isSafeInteger(metadata.sampleCount) && metadata.sampleCount > 0,
        'Invalid DSD sample count');
    return Object.freeze({ ...metadata, bitsPerSample: 1,
        durationSec: metadata.sampleCount / metadata.sampleRate });
}

async function parseDsf(reader) {
    const header = await readDsdBytes(reader, 0, 28);
    requireValid(uint64(header, 4, true) === 28 && uint64(header, 12, true) === reader.size,
        'Invalid DSF file size');
    const metadataOffset = uint64(header, 20, true);
    const format = await readDsdBytes(reader, 28, 52);
    const view = new DataView(format.buffer, format.byteOffset, format.byteLength);
    requireValid(ascii(format) === 'fmt ', 'Missing DSF format chunk');
    const formatSize = uint64(format, 4, true);
    requireValid(formatSize >= 52 && formatSize <= reader.size - 28, 'Invalid DSF format size');
    requireSupported(view.getUint32(12, true) === 1 && view.getUint32(16, true) === 0,
        'Unsupported DSF encoding');
    const channelCount = view.getUint32(24, true);
    requireSupported(channelCount === 1 || channelCount === 2, 'Unsupported DSD channel count');
    requireValid(view.getUint32(20, true) === channelCount, 'Invalid DSF channel layout');
    const sampleRate = view.getUint32(28, true);
    const storedBits = view.getUint32(32, true);
    requireSupported(storedBits === 1 || storedBits === 8, 'Unsupported DSF bit order');
    const sampleCount = uint64(format, 36, true);
    const blockSize = view.getUint32(44, true);
    requireSupported(blockSize === 4096, 'Unsupported DSF block size');
    const dataHeaderOffset = 28 + formatSize;
    const data = await readDsdBytes(reader, dataHeaderOffset, 12);
    requireValid(ascii(data) === 'data', 'Missing DSF audio data');
    const dataSize = uint64(data, 4, true);
    requireValid(dataSize >= 12 && dataSize <= reader.size - dataHeaderOffset,
        'Invalid DSF audio data size');
    const dataOffset = dataHeaderOffset + 12;
    const dataByteLength = dataSize - 12;
    const requiredBytes = Math.ceil(Math.ceil(sampleCount / 8) / blockSize) * blockSize * channelCount;
    requireValid(Number.isSafeInteger(requiredBytes) && dataByteLength === requiredBytes,
        'DSF audio data does not match sample count');
    requireValid(metadataOffset === 0 ||
        (metadataOffset >= dataOffset + dataByteLength && metadataOffset < reader.size),
    'Invalid DSF metadata offset');
    return completeMetadata({ format: 'dsf', sampleRate, channelCount, sampleCount,
        bitOrder: storedBits === 1 ? 'lsb' : 'msb', blockSize, dataOffset, dataByteLength });
}

async function parseDff(reader, header) {
    requireValid(ascii(header, 12) === 'DSD ', 'Invalid DSDIFF form type');
    const formSize = uint64(header, 4, false);
    requireValid(formSize >= 4 && formSize === reader.size - 12, 'Invalid DSDIFF form size');
    let chunkCount = 0;
    async function walk(start, end, visit) {
        let offset = start;
        while (offset < end) {
            requireValid(++chunkCount <= 10000 && end - offset >= 12, 'Invalid DSDIFF chunk table');
            const bytes = await readDsdBytes(reader, offset, 12);
            const size = uint64(bytes, 4, false);
            const paddedSize = size + size % 2;
            requireValid(paddedSize <= end - offset - 12, 'DSDIFF chunk exceeds enclosing bounds');
            await visit(ascii(bytes), offset + 12, size);
            offset += 12 + paddedSize;
        }
    }
    const metadata = { format: 'dff', bitOrder: 'msb' };
    let compression;
    let hasProperties = false;
    await walk(16, reader.size, async (id, offset, size) => {
        if (id === 'DSD ' || id === 'DST ') {
            requireValid(metadata.dataOffset === undefined, 'Duplicate DSDIFF audio data');
            metadata.dataOffset = offset;
            metadata.dataByteLength = size;
            metadata.compression = id === 'DST ' ? 'dst' : 'raw';
            if (id === 'DST ') {
                requireValid(size >= 18, 'Missing DST frame information');
                const info = await readDsdBytes(reader, offset, 18);
                requireValid(ascii(info) === 'FRTE' && uint64(info, 4, false) === 6,
                    'Invalid DST frame information');
                const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
                metadata.dstFrameCount = view.getUint32(12);
                requireValid(metadata.dstFrameCount > 0, 'Empty DST stream');
                requireSupported(view.getUint16(16) === 75, 'Unsupported DST frame rate');
            }
        } else if (id === 'DSTI') {
            requireValid(metadata.dstIndexOffset === undefined && size % 12 === 0,
                'Invalid DST index');
            metadata.dstIndexOffset = offset;
            metadata.dstIndexByteLength = size;
        } else if (id === 'PROP') {
            requireValid(!hasProperties && size >= 4, 'Invalid DSDIFF properties');
            hasProperties = true;
            requireValid(ascii(await readDsdBytes(reader, offset, 4)) === 'SND ',
                'Invalid DSDIFF sound properties');
            await walk(offset + 4, offset + size, async (property, position, length) => {
                if (property === 'FS  ') {
                    requireValid(metadata.sampleRate === undefined && length === 4,
                        'Invalid DSDIFF sample rate property');
                    const bytes = await readDsdBytes(reader, position, 4);
                    metadata.sampleRate = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
                } else if (property === 'CHNL') {
                    requireValid(metadata.channelCount === undefined && length >= 2,
                        'Invalid DSDIFF channels property');
                    const bytes = await readDsdBytes(reader, position, 2);
                    metadata.channelCount = new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0);
                    requireValid(length === 2 + 4 * metadata.channelCount, 'Invalid DSDIFF channel names');
                } else if (property === 'CMPR') {
                    requireValid(compression === undefined && length >= 5, 'Invalid DSDIFF compression');
                    const bytes = await readDsdBytes(reader, position, 5);
                    requireValid(5 + bytes[4] <= length, 'Truncated DSDIFF compression name');
                    compression = ascii(bytes);
                    requireSupported(compression === 'DSD ' || compression === 'DST ',
                        'Unsupported DSDIFF compression');
                }
            });
        }
    });
    requireValid(metadata.dataOffset !== undefined && metadata.sampleRate !== undefined &&
        metadata.channelCount !== undefined && compression !== undefined, 'Incomplete DSDIFF header');
    requireSupported(metadata.channelCount === 1 || metadata.channelCount === 2,
        'Unsupported DSD channel count');
    requireValid(compression === (metadata.compression === 'dst' ? 'DST ' : 'DSD '),
        'DSDIFF compression does not match audio data');
    if (metadata.compression === 'dst') {
        requireValid(metadata.dstIndexOffset === undefined ||
            metadata.dstIndexByteLength === metadata.dstFrameCount * 12, 'Incomplete DST index');
        metadata.sampleCount = metadata.dstFrameCount * (metadata.sampleRate / 75);
    } else {
        requireValid(metadata.dataByteLength % metadata.channelCount === 0, 'Incomplete DSDIFF channel frame');
        metadata.sampleCount = metadata.dataByteLength / metadata.channelCount * 8;
    }
    return completeMetadata(metadata);
}

export async function probeDsdSource(reader) {
    requireValid(reader && Number.isSafeInteger(reader.size) && reader.size >= 0 &&
        typeof reader.read === 'function', 'Invalid DSD reader');
    if (reader.size < 4) return null;
    const header = await readDsdBytes(reader, 0, reader.size < 16 ? reader.size : 16);
    if (ascii(header) === 'DSD ') return parseDsf(reader);
    if (ascii(header) === 'FRM8') {
        requireValid(header.length === 16, 'Truncated DSDIFF header');
        if (ascii(header, 12) !== 'DSD ') return null;
        return parseDff(reader, header);
    }
    return null;
}
