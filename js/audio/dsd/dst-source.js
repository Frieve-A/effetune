import { dsdError, readDsdBytes } from './dsd-parser.js';
import { decodeDstFrame } from './dst-decoder.js';

function valid(condition, message) {
    if (!condition) throw dsdError('DSD_CORRUPT', message);
}

// Exposes virtual interleaved DSD bytes to the existing converter. Only eight
// decoded packets and at most 257 seek checkpoints survive a read.
export function createDstSource(reader, metadata) {
    const begin = metadata.dataOffset + 18;
    const end = metadata.dataOffset + metadata.dataByteLength;
    const packetBytes = metadata.sampleRate / 75 / 8 * metadata.channelCount;
    const stride = Math.ceil(metadata.dstFrameCount / 256);
    const checkpoints = new Map([[0, begin]]);
    const cache = new Map();
    let cursorFrame = 0;
    let cursorOffset = begin;
    let disposed = false;

    async function read(offset, length) {
        if (disposed) throw dsdError('DSD_DISPOSED', 'DST source was disposed');
        const bytes = await readDsdBytes(reader, offset, length);
        if (disposed) throw dsdError('DSD_DISPOSED', 'DST source was disposed');
        return bytes;
    }

    async function header(offset) {
        valid(offset >= begin && offset <= end - 12, 'Missing DST packet');
        const bytes = await read(offset, 12);
        const size = new DataView(bytes.buffer, bytes.byteOffset, 12).getBigUint64(4);
        valid(size <= BigInt(end - offset - 12), 'DST packet exceeds audio bounds');
        const length = Number(size);
        const next = offset + 12 + length + length % 2;
        valid(next <= end, 'Truncated DST packet padding');
        return { id: String.fromCharCode(...bytes.subarray(0, 4)), offset, length, next };
    }

    async function findPacket(index) {
        if (metadata.dstIndexOffset !== undefined) {
            const bytes = await read(metadata.dstIndexOffset + index * 12, 12);
            const view = new DataView(bytes.buffer, bytes.byteOffset, 12);
            const position = view.getBigUint64(0);
            valid(position >= BigInt(begin + 12) && position <= BigInt(end), 'Invalid DST index offset');
            const packet = await header(Number(position) - 12);
            valid(packet.id === 'DSTF' && packet.length === view.getUint32(8), 'Invalid DST index entry');
            return packet;
        }
        let frame = cursorFrame <= index ? cursorFrame : 0;
        let offset = frame === cursorFrame ? cursorOffset : begin;
        for (const [number, position] of checkpoints) {
            if (number <= index && number > frame) { frame = number; offset = position; }
        }
        let skipped = 0;
        while (offset < end) {
            const packet = await header(offset);
            if (packet.id === 'DSTF') {
                valid(packet.length > 1 && packet.length <= 1024 * 1024, 'Invalid DST packet size');
                if (frame % stride === 0) checkpoints.set(frame, offset);
                cursorFrame = frame + 1;
                cursorOffset = packet.next;
                if (frame === index) return packet;
                frame += 1;
                skipped = 0;
            } else {
                valid(packet.id !== 'FRTE' && ++skipped <= 10000, 'Invalid DST chunk sequence');
                if (packet.id === 'DSTC') valid(packet.length === 4, 'Invalid DST checksum size');
            }
            offset = packet.next;
        }
        throw dsdError('DSD_CORRUPT', 'DST frame count exceeds audio data');
    }

    async function packet(index) {
        if (cache.has(index)) return cache.get(index);
        const info = await findPacket(index);
        valid(info.length > 1 && info.length <= 1024 * 1024, 'Invalid DST packet size');
        const decoded = decodeDstFrame(await read(info.offset + 12, info.length),
            metadata.channelCount, metadata.sampleRate / 75);
        // Validate the optional checksum before exposing any decoded audio.
        let next = info.next;
        if (next < end) {
            const following = await header(next);
            if (following.id === 'DSTC') {
                valid(following.length === 4, 'Invalid DST checksum size');
                const checksum = await read(following.offset + 12, 4);
                let crc = 0;
                for (const byte of decoded) {
                    crc ^= byte << 24;
                    for (let bit = 0; bit < 8; bit += 1) crc = (crc << 1) ^ (crc < 0 ? 0x80000011 : 0);
                }
                valid((crc >>> 0) === new DataView(checksum.buffer, checksum.byteOffset, 4).getUint32(0),
                    'DST checksum mismatch');
                next = following.next;
            }
        }
        if (index === metadata.dstFrameCount - 1) {
            let skipped = 0;
            while (next < end) {
                const tail = await header(next);
                valid(tail.id !== 'DSTF' && tail.id !== 'FRTE' && tail.id !== 'DSTC' && ++skipped <= 10000,
                    'DST audio exceeds frame count');
                next = tail.next;
            }
        }
        if (cache.size === 8) cache.delete(cache.keys().next().value);
        cache.set(index, decoded);
        return decoded;
    }

    return {
        size: metadata.sampleCount / 8 * metadata.channelCount,
        async read(offset, length) {
            if (disposed) throw dsdError('DSD_DISPOSED', 'DST source was disposed');
            valid(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 &&
                length >= 0 && length <= 1024 * 1024 && offset + length <= this.size, 'Invalid DST byte range');
            const output = new Uint8Array(length);
            let copied = 0;
            while (copied < length) {
                const position = offset + copied;
                const bytes = await packet(Math.floor(position / packetBytes));
                const start = position % packetBytes;
                const count = Math.min(length - copied, packetBytes - start);
                output.set(bytes.subarray(start, start + count), copied);
                copied += count;
            }
            return output;
        },
        dispose() { disposed = true; cache.clear(); checkpoints.clear(); }
    };
}
