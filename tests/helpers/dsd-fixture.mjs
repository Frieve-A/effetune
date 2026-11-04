export function writeAscii(bytes, offset, value) {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

export function createDsfFixture({ sampleRate = 2822400, channelCount = 2, sampleCount = 40001,
    bitOrder = 'lsb', channels = [], virtual = false } = {}) {
    const blockSize = 4096;
    const dataByteLength = Math.ceil(Math.ceil(sampleCount / 8) / blockSize) * blockSize * channelCount;
    const bytes = new Uint8Array(virtual ? 92 : 92 + dataByteLength);
    const view = new DataView(bytes.buffer);
    writeAscii(bytes, 0, 'DSD ');
    view.setBigUint64(4, 28n, true);
    view.setBigUint64(12, BigInt(92 + dataByteLength), true);
    writeAscii(bytes, 28, 'fmt ');
    view.setBigUint64(32, 52n, true);
    view.setUint32(40, 1, true);
    view.setUint32(48, channelCount, true);
    view.setUint32(52, channelCount, true);
    view.setUint32(56, sampleRate, true);
    view.setUint32(60, bitOrder === 'lsb' ? 1 : 8, true);
    view.setBigUint64(64, BigInt(sampleCount), true);
    view.setUint32(72, blockSize, true);
    writeAscii(bytes, 80, 'data');
    view.setBigUint64(84, BigInt(12 + dataByteLength), true);
    if (!virtual) {
        for (let channel = 0; channel < channelCount; channel += 1) {
            const source = channels[channel];
            if (!source) continue;
            for (let index = 0; index < source.length; index += 1) {
                const block = Math.floor(index / blockSize);
                bytes[92 + (block * channelCount + channel) * blockSize + index % blockSize] = source[index];
            }
        }
    }
    return bytes;
}

export function dffChunk(id, payload) {
    const bytes = new Uint8Array(12 + payload.length + payload.length % 2);
    writeAscii(bytes, 0, id);
    new DataView(bytes.buffer).setBigUint64(4, BigInt(payload.length));
    bytes.set(payload, 12);
    return bytes;
}

function concat(parts) {
    const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return bytes;
}

export function createDffFixture({ sampleRate = 2822400, channelCount = 2, sampleCount = 40000,
    channels = [], compression = 'DSD ', unknown = true } = {}) {
    const frequency = new Uint8Array(4);
    new DataView(frequency.buffer).setUint32(0, sampleRate);
    const channelNames = new Uint8Array(2 + channelCount * 4);
    new DataView(channelNames.buffer).setUint16(0, channelCount);
    for (let channel = 0; channel < channelCount; channel += 1) {
        writeAscii(channelNames, 2 + channel * 4, channel === 0 ? 'SLFT' : 'SRGT');
    }
    const cmpr = new Uint8Array(5);
    writeAscii(cmpr, 0, compression);
    const sound = new Uint8Array(4);
    writeAscii(sound, 0, 'SND ');
    const properties = dffChunk('PROP', concat([sound, dffChunk('FS  ', frequency),
        dffChunk('CHNL', channelNames), dffChunk('CMPR', cmpr)]));
    const payload = new Uint8Array(Math.ceil(sampleCount / 8) * channelCount);
    for (let channel = 0; channel < channelCount; channel += 1) {
        for (let index = 0; index < (channels[channel]?.length || 0); index += 1) {
            payload[index * channelCount + channel] = channels[channel][index];
        }
    }
    const body = concat([properties, ...(unknown ? [dffChunk('JUNK', new Uint8Array([7, 8, 9]))] : []),
        dffChunk(compression === 'DST ' ? 'DST ' : 'DSD ', payload)]);
    const bytes = new Uint8Array(16 + body.length);
    writeAscii(bytes, 0, 'FRM8');
    new DataView(bytes.buffer).setBigUint64(4, BigInt(bytes.length - 12));
    writeAscii(bytes, 12, 'DSD ');
    bytes.set(body, 16);
    return bytes;
}

export function createDsdReader(bytes) {
    const reads = [];
    return { size: bytes.length, reads,
        async read(offset, length) {
            reads.push({ offset, length });
            if (length > 1024 * 1024) throw new Error('Unbounded fixture read');
            return bytes.slice(offset, offset + length);
        } };
}

export function createVirtualDsfReader({ sampleCount, sampleRate = 11289600, channelCount = 2 } = {}) {
    const header = createDsfFixture({ sampleCount, sampleRate, channelCount, virtual: true });
    const size = Number(new DataView(header.buffer).getBigUint64(12, true));
    let maxReadLength = 0;
    let readBytes = 0;
    return { size,
        get maxReadLength() { return maxReadLength; },
        get readBytes() { return readBytes; },
        async read(offset, length) {
            if (length > 1024 * 1024) throw new Error('Unbounded fixture read');
            maxReadLength = Math.max(maxReadLength, length);
            readBytes += length;
            const bytes = new Uint8Array(length).fill(0x69);
            if (offset < header.length) bytes.set(header.subarray(offset, Math.min(header.length, offset + length)));
            return bytes;
        } };
}

// A first-order synthetic sigma-delta encoder; no third-party recordings.
export function encodeDsdSignal(sampleCount, sampleRate, signal, bitOrder = 'lsb') {
    const bytes = new Uint8Array(Math.ceil(sampleCount / 8));
    let error = 0;
    for (let sample = 0; sample < sampleCount; sample += 1) {
        const input = signal(sample / sampleRate);
        error += input;
        const positive = error >= 0;
        error -= positive ? 1 : -1;
        if (positive) bytes[Math.floor(sample / 8)] |= 1 << (bitOrder === 'lsb' ? sample % 8 : 7 - sample % 8);
    }
    return bytes;
}
