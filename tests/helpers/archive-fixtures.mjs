import { deflateRawSync } from 'node:zlib';
export { gzipSync as gzip } from 'node:zlib';

export function zip(entries, method = 8) {
    const local = [], central = [];
    let offset = 0;
    for (const [name, text] of entries) {
        const raw = Buffer.from(text), packed = method === 8 ? deflateRawSync(raw) : raw;
        let crc = 0xffffffff;
        for (const byte of raw) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        const label = Buffer.from(name), prefix = Buffer.alloc(30);
        prefix.writeUInt32LE(0x04034b50); prefix.writeUInt16LE(20, 4); prefix.writeUInt16LE(method, 8);
        prefix.writeUInt32LE(crc, 14); prefix.writeUInt32LE(packed.length, 18); prefix.writeUInt32LE(raw.length, 22); prefix.writeUInt16LE(label.length, 26);
        const directory = Buffer.alloc(46);
        directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(method, 10);
        directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(raw.length, 24);
        directory.writeUInt16LE(label.length, 28); directory.writeUInt32LE(offset, 42);
        local.push(prefix, label, packed); central.push(directory, label);
        offset += prefix.length + label.length + packed.length;
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}

export function tar(entries, { gnu = false } = {}) {
    const parts = [];
    for (const [name, value, type = '0', prefix = ''] of entries) {
        const data = Buffer.from(value), header = Buffer.alloc(512);
        header.write(name, 0, 100);
        header.write('0000644', 100);
        header.write('0000000', 108);
        header.write('0000000', 116);
        header.write(data.length.toString(8).padStart(11, '0'), 124);
        const stamp = 1000000000 + parts.length;
        header.write(stamp.toString(8).padStart(11, '0'), 136);
        header.fill(32, 148, 156);
        header.write(type, 156, 1);
        if (gnu) {
            header.write('ustar  \0', 257);
            header.write((stamp + 1).toString(8).padStart(11, '0'), 345);
            header.write(stamp.toString(8).padStart(11, '0'), 357);
        } else {
            header.write('ustar\0', 257);
            header.write('00', 263);
            header.write(prefix, 345, 155);
        }
        header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
        parts.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
    }
    return Buffer.concat([...parts, Buffer.alloc(1024)]);
}
