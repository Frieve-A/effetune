// Only metadata is resident. Media and any trailing tags are copied in ranges.
const METADATA_LIMIT = 64 * 1024 * 1024;
const KEYS = new Set(['REPLAYGAIN_TRACK_GAIN', 'REPLAYGAIN_TRACK_PEAK', 'REPLAYGAIN_ALBUM_GAIN', 'REPLAYGAIN_ALBUM_PEAK']);

function supported(condition) {
  if (!condition) throw Object.assign(new Error('Unsupported tag structure'), { code: 'UNSUPPORTED_TAG' });
}

export async function readBytes(file, start, length) {
  supported(Number.isSafeInteger(length) && length >= 0 && length <= METADATA_LIMIT);
  const buffer = Buffer.alloc(length);
  for (let i = 0; i < length;) {
    const { bytesRead } = await file.read(buffer, i, length - i, start + i);
    supported(bytesRead > 0);
    i += bytesRead;
  }
  return buffer;
}

function u32(value, little = false) {
  const result = Buffer.alloc(4);
  if (little) result.writeUInt32LE(value); else result.writeUInt32BE(value);
  return result;
}

function vorbisComments(payload, tags) {
  let cursor = 0;
  function string() {
    const length = payload.readUInt32LE(cursor);
    const end = cursor + 4 + length;
    supported(end <= payload.length);
    const bytes = payload.subarray(cursor + 4, end);
    cursor = end;
    return bytes;
  }
  const vendor = payload ? string() : Buffer.from('EffeTune');
  const retained = [];
  if (payload) {
    const count = payload.readUInt32LE(cursor);
    cursor += 4;
    for (let i = 0; i < count; i++) {
      const comment = string();
      const delimiter = comment.indexOf(61);
      if (delimiter < 0 || !KEYS.has(comment.toString('utf8', 0, delimiter).toUpperCase())) retained.push(comment);
    }
    supported(cursor === payload.length);
  }
  for (const [key, value] of Object.entries(tags)) retained.push(Buffer.from(`${key}=${value}`));
  return Buffer.concat([u32(vendor.length, true), vendor, u32(retained.length, true),
    ...retained.flatMap(value => [u32(value.length, true), value])]);
}

async function flac(file, size, tags) {
  const magic = await readBytes(file, 0, 4);
  supported(magic.toString() === 'fLaC');
  const blocks = [];
  let cursor = 4;
  let hasComment = false;
  let last;
  do {
    const h = await readBytes(file, cursor, 4);
    const type = h[0] & 127;
    const length = h.readUIntBE(1, 3);
    supported(type < 127 && (blocks.length > 0 || (type === 0 && length === 34)));
    cursor += 4;
    supported(cursor + length <= size && cursor + length <= METADATA_LIMIT);
    let data = await readBytes(file, cursor, length);
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
    const header = Buffer.alloc(4);
    header[0] = type | (i === blocks.length - 1 ? 128 : 0);
    header.writeUIntBE(data.length, 1, 3);
    parts.push(header, data);
  }
  return { start: 0, end: cursor, replacement: Buffer.concat(parts), mediaStart: cursor, mediaLength: size - cursor };
}

function syncSafe(bytes) {
  supported(bytes.length === 4 && bytes.every(byte => byte < 128));
  return bytes.reduce((value, byte) => value * 128 + byte, 0);
}

function syncSafeBytes(value) {
  supported(value < 2 ** 28);
  return Buffer.from([value >>> 21, value >>> 14 & 127, value >>> 7 & 127, value & 127]);
}

function id3Description(data) {
  if (data[0] === 0 || data[0] === 3) {
    const end = data.indexOf(0, 1);
    supported(end >= 1);
    return data.toString(data[0] === 0 ? 'latin1' : 'utf8', 1, end);
  }
  supported(data[0] === 1 || data[0] === 2);
  let start = 1;
  let little = false;
  if (data[0] === 1) {
    const bom = data.readUInt16BE(1);
    supported(bom === 0xfffe || bom === 0xfeff);
    little = bom === 0xfffe;
    start += 2;
  }
  for (let i = start; i + 1 < data.length; i += 2) {
    if (data.readUInt16BE(i) === 0) return new TextDecoder(little ? 'utf-16le' : 'utf-16be').decode(data.subarray(start, i));
  }
  supported(false);
}

async function rejectConflictingApe(file, size) {
  let end = size;
  if (size >= 128 && (await readBytes(file, size - 128, 3)).toString() === 'TAG') end -= 128;
  if (end < 32) return;
  const footer = await readBytes(file, end - 32, 32);
  if (footer.toString('ascii', 0, 8) !== 'APETAGEX') return;
  const sizeWithFooter = footer.readUInt32LE(12);
  supported(sizeWithFooter >= 32 && sizeWithFooter <= end);
  const items = await readBytes(file, end - sizeWithFooter, sizeWithFooter - 32);
  let cursor = 0;
  const count = footer.readUInt32LE(16);
  for (let i = 0; i < count; i++) {
    const length = items.readUInt32LE(cursor);
    const keyEnd = items.indexOf(0, cursor + 8);
    supported(keyEnd >= cursor + 8 && keyEnd + 1 + length <= items.length);
    supported(!KEYS.has(items.toString('utf8', cursor + 8, keyEnd).toUpperCase()));
    cursor = keyEnd + 1 + length;
  }
  supported(cursor === items.length);
}

async function mp3(file, size, tags) {
  await rejectConflictingApe(file, size);
  const header = await readBytes(file, 0, 10);
  const frames = [];
  let version = 4;
  let end = 0;
  let needsFixedAudioStart = false;
  if (header.toString('ascii', 0, 3) === 'ID3') {
    version = header[3];
    supported((version === 3 || version === 4) && header[4] === 0 && header[5] === 0);
    end = 10 + syncSafe(header.subarray(6));
    supported(end <= size);
    const body = await readBytes(file, 10, end - 10);
    let cursor = 0;
    while (cursor < body.length && body[cursor] !== 0) {
      const id = body.toString('latin1', cursor, cursor + 4);
      supported(/^[A-Z0-9]{4}$/.test(id) && cursor + 10 <= body.length);
      const length = version === 4 ? syncSafe(body.subarray(cursor + 4, cursor + 8)) : body.readUInt32BE(cursor + 4);
      const next = cursor + 10 + length;
      supported(next <= body.length);
      if (id === 'ASPI') needsFixedAudioStart = true;
      if (id === 'CHAP') {
        const chapter = body.subarray(cursor + 10, next);
        const fields = chapter.indexOf(0) + 1;
        // Chapters can use times alone, or carry absolute byte offsets after the two times.
        if (body[cursor + 9] !== 0 || !fields || fields + 16 > chapter.length ||
            chapter.readUInt32BE(fields + 8) !== 0xffffffff || chapter.readUInt32BE(fields + 12) !== 0xffffffff) {
          needsFixedAudioStart = true;
        }
      }
      if (id === 'TXXX') supported(body.readUInt16BE(cursor + 8) === 0);
      if (id !== 'TXXX' || !KEYS.has(id3Description(body.subarray(cursor + 10, next)).toUpperCase())) {
        frames.push(body.subarray(cursor, next));
      }
      cursor = next;
    }
    supported(body.subarray(cursor).every(byte => byte === 0));
  }
  const audioHeader = await readBytes(file, end, 2);
  supported(audioHeader[0] === 0xff && (audioHeader[1] & 0xe0) === 0xe0);
  for (const [key, value] of Object.entries(tags)) {
    const payload = Buffer.from(`\0${key}\0${value}`, 'latin1');
    frames.push(Buffer.from('TXXX'), version === 3 ? u32(payload.length) : syncSafeBytes(payload.length),
      Buffer.alloc(2), payload);
  }
  const length = frames.reduce((sum, frame) => sum + frame.length, 0);
  const originalLength = end ? end - 10 : 0;
  supported(!needsFixedAudioStart || length <= originalLength);
  const body = Buffer.concat(frames, Math.max(length, originalLength));
  const replacement = Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, 0]), syncSafeBytes(body.length), body]);
  return { start: 0, end, replacement, mediaStart: end, mediaLength: size - end };
}

function box(type, ...contents) {
  const size = contents.reduce((n, part) => n + part.length, 8);
  return Buffer.concat([u32(size), Buffer.from(type, 'latin1'), ...contents], size);
}

function children(data, start = 0) {
  const result = [];
  for (let i = start; i < data.length;) {
    supported(i + 8 <= data.length && result.length < 16_384);
    const size = data.readUInt32BE(i);
    supported(size >= 8 && size <= data.length - i);
    result.push({ type: data.toString('latin1', i + 4, i + 8), payload: data.subarray(i + 8, i + size),
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
  if (!atoms.some(atom => atom.type === type)) parts.push(box(type, build(Buffer.alloc(0))));
  return Buffer.concat(parts);
}

function rewriteIlst(data, tags) {
  const kept = children(data).filter(atom => {
    if (atom.type !== '----') return true;
    const fields = children(atom.payload);
    function field(name) {
      const matches = fields.filter(item => item.type === name);
      supported(matches.length === 1 && matches[0].payload.length >= 4);
      return matches[0].payload.subarray(4).toString().toUpperCase();
    }
    return field('mean') !== 'COM.APPLE.ITUNES' || !KEYS.has(field('name'));
  }).map(atom => atom.bytes);
  for (const [key, value] of Object.entries(tags)) {
    kept.push(box('----', box('mean', u32(0), Buffer.from('com.apple.iTunes')), box('name', u32(0), Buffer.from(key)),
      box('data', u32(1), u32(0), Buffer.from(value))));
  }
  return Buffer.concat(kept);
}

function rewriteMeta(data, tags) {
  if (!data.length) {
    data = Buffer.concat([u32(0), box('hdlr', Buffer.alloc(8), Buffer.from('mdir'), Buffer.alloc(13))]);
  }
  supported(data.length >= 4 && data.readUInt32BE(0) === 0);
  const atoms = children(data, 4);
  const handler = atoms.find(atom => atom.type === 'hdlr');
  supported(!atoms.some(atom => atom.type === 'iloc') && handler?.payload.toString('latin1', 8, 12) === 'mdir');
  return replaceChild(data, 'ilst', ilst => rewriteIlst(ilst, tags), 4);
}

function relocateChunkTable(atom, mdat, delta, offsets) {
  const width = atom.type === 'stco' ? 4 : 8;
  const table = atom.payload;
  supported(table.length >= 8 && table.readUInt32BE(0) === 0);
  const count = table.readUInt32BE(4);
  supported(table.length === 8 + count * width && offsets.length + count <= 5_000_000);
  for (let i = 8; i < table.length; i += width) {
    const offset = width === 4 ? table.readUInt32BE(i) : Number(table.readBigUInt64BE(i));
    supported(Number.isSafeInteger(offset) && offset >= mdat.start && offset < mdat.start + mdat.length);
    offsets.push(offset - mdat.start);
    if (!delta) continue;
    if (width === 4) {
      supported(offset + delta <= 0xffffffff);
      table.writeUInt32BE(offset + delta, i);
    } else {
      table.writeBigUInt64BE(BigInt(offset + delta), i);
    }
  }
}

function validateDataReferences(data) {
  const references = children(data);
  supported(references.length === 1 && references[0].type === 'dref');
  const dref = references[0].payload;
  supported(dref.length >= 8 && dref.readUInt32BE(0) === 0);
  const entries = children(dref, 8);
  supported(entries.length === dref.readUInt32BE(4) && entries.every(entry =>
    entry.type === 'url ' && entry.payload.length === 4 && entry.payload.readUInt32BE(0) === 1));
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

async function m4a(file, size, tags) {
  let moov, mdat;
  for (let i = 0; i < size;) {
    const header = await readBytes(file, i, 8);
    let length = header.readUInt32BE();
    const type = header.toString('latin1', 4);
    let headerSize = 8;
    if (length === 1) {
      headerSize = 16;
      length = Number((await readBytes(file, i + 8, 8)).readBigUInt64BE());
    } else if (length === 0) length = size - i;
    supported(Number.isSafeInteger(length) && length >= headerSize && length <= size - i);
    supported(!['moof', 'mfra', 'sidx', 'meta'].includes(type));
    if (type === 'mdat') { supported(!mdat); mdat = { start: i + headerSize, length: length - headerSize }; }
    if (type === 'moov') { supported(!moov); moov = { start: i, end: i + length, headerSize }; }
    i += length;
  }
  supported(moov && mdat);
  const original = await readBytes(file, moov.start + moov.headerSize, moov.end - moov.start - moov.headerSize);
  const atoms = children(original);
  const userData = atoms.filter(atom => atom.type === 'udta');
  supported(userData.length <= 1);
  const updated = box('udta', replaceChild(userData[0]?.payload ?? Buffer.alloc(0),
    'meta', meta => rewriteMeta(meta, tags)));
  const delta = moov.start < mdat.start
    ? 8 - moov.headerSize + updated.length - (userData[0]?.bytes.length ?? 0) : 0;
  // Record each file's on-disk offsets before adjusting this in-memory copy.
  const offsets = relocateChunks(original, mdat, delta);
  const parts = atoms.map(atom => atom.type === 'udta' ? updated : atom.bytes);
  if (!userData.length) parts.push(updated);
  return { ...moov, replacement: box('moov', ...parts), mediaStart: mdat.start, mediaLength: mdat.length, offsets };
}

export async function readTagLayout(file, size, extension, tags) {
  const format = { '.flac': flac, '.mp3': mp3, '.m4a': m4a }[extension];
  supported(format);
  return format(file, size, tags);
}
