// ReplayGain tag layouts for FLAC, MP3 and M4A. The caller supplies a range
// reader `{ read(start, length) }` that resolves to exactly `length` bytes, so
// only metadata is resident; media and any trailing tags are copied in ranges.
export const METADATA_LIMIT = 64 * 1024 * 1024;
export const TAG_EXTENSIONS = ['.flac', '.mp3', '.m4a'];
const KEYS = new Set(['REPLAYGAIN_TRACK_GAIN', 'REPLAYGAIN_TRACK_PEAK', 'REPLAYGAIN_ALBUM_GAIN', 'REPLAYGAIN_ALBUM_PEAK']);
const EMPTY = new Uint8Array(0);
const UTF8 = new TextDecoder('utf-8', { ignoreBOM: true });
const ENCODER = new TextEncoder();

export function supported(condition) {
    if (!condition) throw Object.assign(new Error('Unsupported tag structure'), { code: 'UNSUPPORTED_TAG' });
}

export function tagValues(track) {
    const result = {};
    for (const [prefix, loudness, peak] of [
        ['TRACK', track.integrated, track.truePeak], ['ALBUM', track.albumIntegrated, track.albumTruePeak]
    ]) {
        if (!Number.isFinite(loudness) || !Number.isFinite(peak)) continue;
        const gain = -18 - loudness;
        result[`REPLAYGAIN_${prefix}_GAIN`] = `${gain >= 0 ? '+' : ''}${gain.toFixed(2)} dB`;
        result[`REPLAYGAIN_${prefix}_PEAK`] = (10 ** (peak / 20)).toFixed(9);
    }
    return result;
}

// Checks music-metadata's native tags read back from a written file.
export function checkReplayGainTags(native, tags) {
    const found = new Set();
    for (const group of Object.values(native)) {
        for (const { id, value } of group) {
            const key = id.toUpperCase().replace(/^(?:TXXX:|----:COM\.APPLE\.ITUNES:)/, '');
            if (!/^REPLAYGAIN_(?:TRACK|ALBUM)_(?:GAIN|PEAK)$/.test(key)) continue;
            if (found.has(key) || value !== tags[key]) throw new Error('ReplayGain tag verification failed');
            found.add(key);
        }
    }
    if (found.size !== Object.keys(tags).length) throw new Error('ReplayGain tags missing');
}

async function readBytes(reader, start, length) {
    supported(Number.isSafeInteger(length) && length >= 0 && length <= METADATA_LIMIT);
    const bytes = await reader.read(start, length);
    supported(bytes.length === length);
    return bytes;
}

// Out-of-range reads throw RangeError, which callers report as unsupported.
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16At = (bytes, offset) => view(bytes).getUint16(offset);
const u32At = (bytes, offset, little = false) => view(bytes).getUint32(offset, little);
const utf8 = (bytes, start = 0, end = bytes.length) => UTF8.decode(bytes.subarray(start, end));

// Single-byte decoding; the ASCII mask unsets the high bit like Node's 'ascii'.
function text(bytes, start = 0, end = bytes.length, mask = 255) {
    let result = '';
    for (const byte of bytes.subarray(start, end)) result += String.fromCharCode(byte & mask);
    return result;
}

function latin1Bytes(value) {
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
    return bytes;
}

function concat(parts, length = parts.reduce((sum, part) => sum + part.length, 0)) {
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function u32(value, little = false) {
    const result = new Uint8Array(4);
    view(result).setUint32(0, value, little);
    return result;
}

function vorbisComments(payload, tags) {
    let cursor = 0;
    function string() {
        const length = u32At(payload, cursor, true);
        const end = cursor + 4 + length;
        supported(end <= payload.length);
        const bytes = payload.subarray(cursor + 4, end);
        cursor = end;
        return bytes;
    }
    const vendor = payload ? string() : ENCODER.encode('EffeTune');
    const retained = [];
    if (payload) {
        const count = u32At(payload, cursor, true);
        cursor += 4;
        for (let i = 0; i < count; i++) {
            const comment = string();
            const delimiter = comment.indexOf(61);
            if (delimiter < 0 || !KEYS.has(utf8(comment, 0, delimiter).toUpperCase())) retained.push(comment);
        }
        supported(cursor === payload.length);
    }
    for (const [key, value] of Object.entries(tags)) retained.push(ENCODER.encode(`${key}=${value}`));
    return concat([u32(vendor.length, true), vendor, u32(retained.length, true),
        ...retained.flatMap(value => [u32(value.length, true), value])]);
}

async function flac(reader, size, tags) {
    const magic = await readBytes(reader, 0, 4);
    supported(text(magic) === 'fLaC');
    const blocks = [];
    let cursor = 4;
    let hasComment = false;
    let last;
    do {
        const h = await readBytes(reader, cursor, 4);
        const type = h[0] & 127;
        const length = h[1] << 16 | h[2] << 8 | h[3];
        supported(type < 127 && (blocks.length > 0 || (type === 0 && length === 34)));
        cursor += 4;
        supported(cursor + length <= size && cursor + length <= METADATA_LIMIT);
        let data = await readBytes(reader, cursor, length);
        if (type === 4) {
            supported(!hasComment);
            hasComment = true;
            data = vorbisComments(data, tags);
        }
        blocks.push({ type, data });
        cursor += length;
        last = h[0] & 128;
    } while (!last);
    if (!hasComment) blocks.push({ type: 4, data: vorbisComments(null, tags) });
    const parts = [magic];
    for (const [i, { type, data }] of blocks.entries()) {
        supported(data.length < 0x1000000);
        const header = u32(data.length);
        header[0] = type | (i === blocks.length - 1 ? 128 : 0);
        parts.push(header, data);
    }
    return { start: 0, end: cursor, replacement: concat(parts), mediaStart: cursor, mediaLength: size - cursor };
}

function syncSafe(bytes) {
    supported(bytes.length === 4 && bytes.every(byte => byte < 128));
    return bytes.reduce((value, byte) => value * 128 + byte, 0);
}

function syncSafeBytes(value) {
    supported(value < 2 ** 28);
    return Uint8Array.of(value >>> 21, value >>> 14 & 127, value >>> 7 & 127, value & 127);
}

function id3Description(data) {
    if (data[0] === 0 || data[0] === 3) {
        const end = data.indexOf(0, 1);
        supported(end >= 1);
        return data[0] === 0 ? text(data, 1, end) : utf8(data, 1, end);
    }
    supported(data[0] === 1 || data[0] === 2);
    let start = 1;
    let little = false;
    if (data[0] === 1) {
        const bom = u16At(data, 1);
        supported(bom === 0xfffe || bom === 0xfeff);
        little = bom === 0xfffe;
        start += 2;
    }
    for (let i = start; i + 1 < data.length; i += 2) {
        if (u16At(data, i) === 0) return new TextDecoder(little ? 'utf-16le' : 'utf-16be').decode(data.subarray(start, i));
    }
    supported(false);
}

async function rejectConflictingApe(reader, size) {
    let end = size;
    if (size >= 128 && text(await readBytes(reader, size - 128, 3)) === 'TAG') end -= 128;
    if (end < 32) return;
    const footer = await readBytes(reader, end - 32, 32);
    if (text(footer, 0, 8, 127) !== 'APETAGEX') return;
    const sizeWithFooter = u32At(footer, 12, true);
    supported(sizeWithFooter >= 32 && sizeWithFooter <= end);
    const items = await readBytes(reader, end - sizeWithFooter, sizeWithFooter - 32);
    let cursor = 0;
    const count = u32At(footer, 16, true);
    for (let i = 0; i < count; i++) {
        const length = u32At(items, cursor, true);
        const keyEnd = items.indexOf(0, cursor + 8);
        supported(keyEnd >= cursor + 8 && keyEnd + 1 + length <= items.length);
        supported(!KEYS.has(utf8(items, cursor + 8, keyEnd).toUpperCase()));
        cursor = keyEnd + 1 + length;
    }
    supported(cursor === items.length);
}

async function mp3(reader, size, tags) {
    await rejectConflictingApe(reader, size);
    const header = await readBytes(reader, 0, 10);
    const frames = [];
    let version = 4;
    let end = 0;
    let needsFixedAudioStart = false;
    if (text(header, 0, 3, 127) === 'ID3') {
        version = header[3];
        supported((version === 3 || version === 4) && header[4] === 0 && header[5] === 0);
        end = 10 + syncSafe(header.subarray(6));
        supported(end <= size);
        const body = await readBytes(reader, 10, end - 10);
        let cursor = 0;
        while (cursor < body.length && body[cursor] !== 0) {
            const id = text(body, cursor, cursor + 4);
            supported(/^[A-Z0-9]{4}$/.test(id) && cursor + 10 <= body.length);
            const length = version === 4 ? syncSafe(body.subarray(cursor + 4, cursor + 8)) : u32At(body, cursor + 4);
            const next = cursor + 10 + length;
            supported(next <= body.length);
            if (id === 'ASPI') needsFixedAudioStart = true;
            if (id === 'CHAP') {
                const chapter = body.subarray(cursor + 10, next);
                const fields = chapter.indexOf(0) + 1;
                // Chapters can use times alone, or carry absolute byte offsets after the two times.
                if (body[cursor + 9] !== 0 || !fields || fields + 16 > chapter.length ||
                    u32At(chapter, fields + 8) !== 0xffffffff || u32At(chapter, fields + 12) !== 0xffffffff) {
                    needsFixedAudioStart = true;
                }
            }
            if (id === 'TXXX') supported(u16At(body, cursor + 8) === 0);
            if (id !== 'TXXX' || !KEYS.has(id3Description(body.subarray(cursor + 10, next)).toUpperCase())) {
                frames.push(body.subarray(cursor, next));
            }
            cursor = next;
        }
        supported(body.subarray(cursor).every(byte => byte === 0));
    }
    const audioHeader = await readBytes(reader, end, 2);
    supported(audioHeader[0] === 0xff && (audioHeader[1] & 0xe0) === 0xe0);
    for (const [key, value] of Object.entries(tags)) {
        const payload = latin1Bytes(`\0${key}\0${value}`);
        frames.push(latin1Bytes('TXXX'), version === 3 ? u32(payload.length) : syncSafeBytes(payload.length),
            new Uint8Array(2), payload);
    }
    const length = frames.reduce((sum, frame) => sum + frame.length, 0);
    const originalLength = end ? end - 10 : 0;
    supported(!needsFixedAudioStart || length <= originalLength);
    // Keeping the original tag size avoids moving the audio when the new frames fit.
    const body = concat(frames, length > originalLength ? length : originalLength);
    const replacement = concat([latin1Bytes('ID3'), Uint8Array.of(version, 0, 0), syncSafeBytes(body.length), body]);
    return { start: 0, end, replacement, mediaStart: end, mediaLength: size - end };
}

function box(type, ...contents) {
    const size = contents.reduce((n, part) => n + part.length, 8);
    return concat([u32(size), latin1Bytes(type), ...contents], size);
}

function children(data, start = 0) {
    const result = [];
    for (let i = start; i < data.length;) {
        supported(i + 8 <= data.length && result.length < 16_384);
        const size = u32At(data, i);
        supported(size >= 8 && size <= data.length - i);
        result.push({ type: text(data, i + 4, i + 8), payload: data.subarray(i + 8, i + size),
            bytes: data.subarray(i, i + size) });
        i += size;
    }
    return result;
}

function replaceChild(data, type, build, start = 0) {
    const atoms = children(data, start);
    supported(atoms.filter(atom => atom.type === type).length <= 1);
    const parts = [data.subarray(0, start)];
    for (const atom of atoms) parts.push(atom.type === type ? box(type, build(atom.payload)) : atom.bytes);
    if (!atoms.some(atom => atom.type === type)) parts.push(box(type, build(EMPTY)));
    return concat(parts);
}

function rewriteIlst(data, tags) {
    const kept = children(data).filter(atom => {
        if (atom.type !== '----') return true;
        const fields = children(atom.payload);
        function field(name) {
            const matches = fields.filter(item => item.type === name);
            supported(matches.length === 1 && matches[0].payload.length >= 4);
            return utf8(matches[0].payload, 4).toUpperCase();
        }
        return field('mean') !== 'COM.APPLE.ITUNES' || !KEYS.has(field('name'));
    }).map(atom => atom.bytes);
    for (const [key, value] of Object.entries(tags)) {
        kept.push(box('----', box('mean', u32(0), ENCODER.encode('com.apple.iTunes')),
            box('name', u32(0), ENCODER.encode(key)), box('data', u32(1), u32(0), ENCODER.encode(value))));
    }
    return concat(kept);
}

function rewriteMeta(data, tags) {
    if (!data.length) {
        data = concat([u32(0), box('hdlr', new Uint8Array(8), latin1Bytes('mdir'), new Uint8Array(13))]);
    }
    supported(data.length >= 4 && u32At(data, 0) === 0);
    const atoms = children(data, 4);
    const handler = atoms.find(atom => atom.type === 'hdlr');
    supported(!atoms.some(atom => atom.type === 'iloc') && handler && text(handler.payload, 8, 12) === 'mdir');
    return replaceChild(data, 'ilst', ilst => rewriteIlst(ilst, tags), 4);
}

function relocateChunkTable(atom, mdat, delta, offsets) {
    const width = atom.type === 'stco' ? 4 : 8;
    const table = view(atom.payload);
    supported(table.byteLength >= 8 && table.getUint32(0) === 0);
    const count = table.getUint32(4);
    supported(table.byteLength === 8 + count * width && offsets.length + count <= 5_000_000);
    for (let i = 8; i < table.byteLength; i += width) {
        const offset = width === 4 ? table.getUint32(i) : Number(table.getBigUint64(i));
        supported(Number.isSafeInteger(offset) && offset >= mdat.start && offset < mdat.start + mdat.length);
        offsets.push(offset - mdat.start);
        if (!delta) continue;
        if (width === 4) {
            supported(offset + delta <= 0xffffffff);
            table.setUint32(i, offset + delta);
        } else {
            table.setBigUint64(i, BigInt(offset + delta));
        }
    }
}

function validateDataReferences(data) {
    const references = children(data);
    supported(references.length === 1 && references[0].type === 'dref');
    const dref = references[0].payload;
    supported(dref.length >= 8 && u32At(dref, 0) === 0);
    const entries = children(dref, 8);
    supported(entries.length === u32At(dref, 4) && entries.every(entry =>
        entry.type === 'url ' && entry.payload.length === 4 && u32At(entry.payload, 0) === 1));
}

function relocateChunks(moov, mdat, delta) {
    const originalOffsets = [];
    const containers = ['trak', 'mdia', 'minf', 'stbl'];
    function visit(data, depth) {
        const atoms = children(data);
        if (depth > 0 && depth < containers.length) {
            supported(atoms.filter(atom => atom.type === containers[depth]).length === 1);
        }
        if (depth === containers.length) {
            supported(atoms.filter(atom => atom.type === 'stco' || atom.type === 'co64').length === 1);
        }
        for (const atom of atoms) {
            // Auxiliary, item and fragmented offsets require a different relocation scheme.
            supported(!['saio', 'iloc', 'meta', 'mvex', 'cmov'].includes(atom.type));
            if (atom.type === 'dinf') {
                validateDataReferences(atom.payload);
            } else if (depth < containers.length) {
                if (atom.type === containers[depth]) visit(atom.payload, depth + 1);
            } else if (atom.type === 'stco' || atom.type === 'co64') {
                relocateChunkTable(atom, mdat, delta, originalOffsets);
            }
        }
    }
    visit(moov, 0);
    supported(originalOffsets.length > 0);
    return originalOffsets;
}

async function m4a(reader, size, tags) {
    let moov, mdat;
    for (let i = 0; i < size;) {
        const header = await readBytes(reader, i, 8);
        let length = u32At(header, 0);
        const type = text(header, 4);
        let headerSize = 8;
        if (length === 1) {
            headerSize = 16;
            length = Number(view(await readBytes(reader, i + 8, 8)).getBigUint64(0));
        } else if (length === 0) length = size - i;
        supported(Number.isSafeInteger(length) && length >= headerSize && length <= size - i);
        supported(!['moof', 'mfra', 'sidx', 'meta'].includes(type));
        if (type === 'mdat') { supported(!mdat); mdat = { start: i + headerSize, length: length - headerSize }; }
        if (type === 'moov') { supported(!moov); moov = { start: i, end: i + length, headerSize }; }
        i += length;
    }
    supported(moov && mdat);
    // The chunk tables are relocated in place, so this copy must be owned by the layout.
    const original = await readBytes(reader, moov.start + moov.headerSize, moov.end - moov.start - moov.headerSize);
    const atoms = children(original);
    const userData = atoms.filter(atom => atom.type === 'udta');
    supported(userData.length <= 1);
    const updated = box('udta', replaceChild(userData[0]?.payload ?? EMPTY,
        'meta', meta => rewriteMeta(meta, tags)));
    const delta = moov.start < mdat.start
        ? 8 - moov.headerSize + updated.length - (userData[0]?.bytes.length ?? 0) : 0;
    // Record each file's on-disk offsets before adjusting this in-memory copy.
    const offsets = relocateChunks(original, mdat, delta);
    const parts = atoms.map(atom => atom.type === 'udta' ? updated : atom.bytes);
    if (!userData.length) parts.push(updated);
    return { ...moov, replacement: box('moov', ...parts), mediaStart: mdat.start, mediaLength: mdat.length, offsets };
}

export async function readTagLayout(reader, size, extension, tags) {
    const format = { '.flac': flac, '.mp3': mp3, '.m4a': m4a }[extension];
    supported(format);
    return format(reader, size, tags);
}
