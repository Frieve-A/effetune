import { SMF_MAX_BYTES } from '../../midi/smf-parser.js';
import { decodeName, fail, normalizePath, readBytes, u16, u32 } from './archive-binary.js';
import { listLzh, readLzh } from './lzh.js';

const FORMATS = Object.freeze({ zip: 'zip', lzh: 'lzh', lha: 'lzh', tar: 'tar', tgz: 'tgz', gz: 'gz' });
export const ARCHIVE_EXTENSIONS = Object.freeze(Object.keys(FORMATS));
export function getArchiveFormat(name) {
  const suffix = /\.([^.\\/]+)$/.exec(String(name).toLowerCase())?.[1];
  return /\.tar\.gz$/i.test(name) ? 'tgz' : Object.hasOwn(FORMATS, suffix) ? FORMATS[suffix] : null;
}

export function createBlobSource(blob) {
  return { size: blob.size, async read(offset, length) {
    return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  } };
}

export function createFileHandleSource(handle, size) {
  return { size, async read(offset, length) {
    const bytes = new Uint8Array(length);
    let cursor = 0;
    while (cursor < length) {
      const { bytesRead } = await handle.read(bytes, cursor, length - cursor, offset + cursor);
      if (!bytesRead) break;
      cursor += bytesRead;
    }
    return bytes.subarray(0, cursor);
  } };
}

async function decompress(source, offset, length, format, limit, signal) {
  let sourceError;
  const end = offset + length;
  const input = new ReadableStream({ async pull(controller) {
    if (offset === end) { controller.close(); return; }
    try {
      const bytes = await readBytes(source, offset, Math.min(65536, end - offset), signal);
      offset += bytes.length;
      controller.enqueue(bytes);
    } catch (error) { sourceError = error; controller.error(error); }
  } });
  const reader = input.pipeThrough(new DecompressionStream(format)).getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) fail('too-large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (sourceError) throw sourceError;
    if (signal?.aborted || error.code === 'archive-too-large') throw error;
    fail();
  }
  return new Blob(chunks);
}

async function listZip(source, signal, zipPolicy) {
  const tailSize = Math.min(source.size, 65557 + 20);
  const tail = await readBytes(source, source.size - tailSize, tailSize, signal);
  let end = tail.length - 22;
  while (end >= 0 && (u32(tail, end) !== 0x06054b50 || end + 22 + u16(tail, end + 20) !== tail.length)) end--;
  if (end < 0) fail();
  const count = u16(tail, end + 10), length = u32(tail, end + 12), start = u32(tail, end + 16);
  const split = Boolean(u16(tail, end + 4) || u16(tail, end + 6) || u16(tail, end + 8) !== count);
  zipPolicy?.checkDirectory(count, length, split);
  if (u32(tail, end - 20) === 0x07064b50 || start === 0xffffffff || length === 0xffffffff) fail('unsupported');
  if (split) fail('unsupported');
  if (start + length > source.size - tailSize + end) fail();
  const entries = [];
  let pos = start, windowStart = -1, window = new Uint8Array();
  // Read the central directory in bounded windows, even if comments and extras are large.
  for (let i = 0; i < count; i++) {
    if (pos + 46 > start + length) fail();
    if (windowStart < 0 || pos + 46 > windowStart + window.length) {
      windowStart = pos;
      window = await readBytes(source, pos, Math.min(65536, start + length - pos), signal);
    }
    const h = window.subarray(pos - windowStart);
    if (u32(h, 0) !== 0x02014b50) fail();
    const flags = u16(h, 8), method = u16(h, 10), size = u32(h, 24), nameSize = u16(h, 28);
    const offset = u32(h, 42), packed = u32(h, 20), extraSize = u16(h, 30);
    if (offset === 0xffffffff || size === 0xffffffff || packed === 0xffffffff) fail('unsupported');
    const next = pos + 46 + nameSize + extraSize + u16(h, 32);
    if (next > start + length) fail();
    const fields = h.length >= 46 + nameSize + extraSize ? h.subarray(46, 46 + nameSize + extraSize)
      : await readBytes(source, pos + 46, nameSize + extraSize, signal);
    for (let j = nameSize; j < fields.length;) {
      if (j + 4 > fields.length) fail();
      if (u16(fields, j) === 1) fail('unsupported');
      j += 4 + u16(fields, j + 2);
      if (j > fields.length) fail();
    }
    const nameBytes = fields.subarray(0, nameSize);
    const name = zipPolicy ? zipPolicy.decodeName(nameBytes, flags) : decodeName(nameBytes, flags & 0x800);
    const path = normalizePath(name);
    const attributes = u32(h, 38), unixType = attributes >>> 28;
    if (path && !(attributes & 16) && (!unixType || unixType === 8)) {
      entries.push({ path, method, size, packed, offset, crc: u32(h, 16), supported: !(flags & 1) && (method === 0 || method === 8) });
    }
    pos = next;
  }
  return { entries, count };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

async function readZip(source, entry, signal) {
  const { offset, size, packed, method, crc } = entry;
  const header = await readBytes(source, offset, 30, signal);
  if (u32(header, 0) !== 0x04034b50 || u16(header, 8) !== method || u16(header, 6) & 1) fail();
  const start = offset + 30 + u16(header, 26) + u16(header, 28);
  if (start + packed > source.size || method === 0 && packed !== size) fail();
  const data = method === 0 ? await readBytes(source, start, packed, signal)
    : new Uint8Array(await (await decompress(source, start, packed, 'deflate-raw', size, signal)).arrayBuffer());
  if (data.length !== size) fail();
  let computed = 0xffffffff;
  for (const byte of data) computed = computed >>> 8 ^ crcTable[(computed ^ byte) & 255];
  if ((computed ^ 0xffffffff) >>> 0 !== crc) fail();
  return data;
}

function tarText(bytes) {
  const nul = bytes.indexOf(0);
  return decodeName(nul < 0 ? bytes : bytes.subarray(0, nul));
}

function tarNumber(bytes) {
  const value = tarText(bytes).trim();
  if (!/^[0-7]+$/.test(value)) fail();
  return parseInt(value, 8);
}

function paxPath(bytes) {
  let path;
  for (let pos = 0; pos < bytes.length;) {
    const space = bytes.indexOf(32, pos);
    if (space < 0 || space - pos > 10) fail();
    const length = Number(tarText(bytes.subarray(pos, space)));
    if (!Number.isInteger(length) || pos + length <= space + 1 || pos + length > bytes.length || bytes[pos + length - 1] !== 10) fail();
    const field = decodeName(bytes.subarray(space + 1, pos + length - 1), true);
    if (field.startsWith('path=')) path = field.slice(5);
    pos += length;
  }
  return path;
}

async function listTar(source, signal) {
  const entries = [];
  let name, count = 0;
  for (let pos = 0; pos < source.size;) {
    const h = await readBytes(source, pos, 512, signal);
    if (h.every(byte => byte === 0)) break;
    if (++count > 65535) fail('too-large');
    let sum = 0;
    for (let i = 0; i < h.length; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== tarNumber(h.subarray(148, 156))) fail();
    const size = tarNumber(h.subarray(124, 136)), type = h[156], offset = pos + 512;
    pos = offset + Math.ceil(size / 512) * 512;
    if (pos > source.size) fail();
    if (type === 76 || type === 120) {
      if (size > SMF_MAX_BYTES) fail('too-large');
      const data = await readBytes(source, offset, size, signal);
      name = type === 76 ? tarText(data) : paxPath(data) ?? name;
    } else {
      if (type === 0 || type === 48) {
        const posix = String.fromCharCode(...h.subarray(257, 263)) === 'ustar\0';
        const prefix = posix ? tarText(h.subarray(345, 500)) : '';
        const path = normalizePath(name ?? (prefix ? prefix + '/' : '') + tarText(h.subarray(0, 100)));
        if (path) entries.push({ path, size, method: 'tar', offset, supported: true });
      }
      name = undefined;
    }
  }
  return { entries, count };
}

export async function openArchive(source, archiveName, { signal, zipPolicy } = {}) {
  let format = getArchiveFormat(archiveName);
  let listing, extract;
  if (format === 'tgz') {
    source = createBlobSource(await decompress(source, 0, source.size, 'gzip', 1024 ** 3, signal));
    format = 'tar';
  }
  if (format === 'zip') {
    listing = await listZip(source, signal, zipPolicy);
    extract = readZip;
  } else if (format === 'lzh') {
    listing = await listLzh(source, signal);
    extract = readLzh;
  } else if (format === 'tar') {
    listing = await listTar(source, signal);
    extract = (src, entry, sig) => readBytes(src, entry.offset, entry.size, sig);
  } else if (format === 'gz') {
    if (source.size < 18) fail();
    const header = await readBytes(source, 0, 10, signal);
    if (header[0] !== 31 || header[1] !== 139 || header[2] !== 8 || header[3] & 0xe0) fail();
    const size = u32(await readBytes(source, source.size - 4, 4, signal), 0);
    const path = normalizePath(archiveName.split(/[\\/]/).at(-1).slice(0, -3));
    listing = { entries: path ? [{ path, method: 'gzip', size, supported: true }] : [], count: 1 };
    extract = async (src, entry, sig) => new Uint8Array(await (await decompress(src, 0, src.size, 'gzip', SMF_MAX_BYTES, sig)).arrayBuffer());
  } else fail('unsupported');
  const byPath = new Map();
  for (const entry of listing.entries) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
    if (entry.size > SMF_MAX_BYTES) entry.supported = false;
  }
  return { ...listing, async read(path, { signal: readSignal } = {}) {
    const entry = byPath.get(path);
    if (!entry) fail();
    if (entry.size > SMF_MAX_BYTES) fail('too-large');
    if (!entry.supported) fail('unsupported');
    return extract(source, entry, readSignal);
  } };
}
