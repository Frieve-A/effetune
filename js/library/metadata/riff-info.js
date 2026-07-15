const RIFF_INFO_TAG_IDS = new Set([
  'IART',
  'ICMT',
  'ICOP',
  'ICRD',
  'IGNR',
  'INAM',
  'IPRD',
  'IPRT',
  'IRPD',
  'ITRK',
  'TITL',
  'YEAR'
]);

const MAX_RIFF_SCAN_CHUNKS = 8192;
const MAX_RIFF_INFO_LIST_BYTES = 1024 * 1024;
const MAX_RIFF_INFO_VALUE_BYTES = 64 * 1024;

export async function readRiffInfoTagsFromBlob(blob) {
  if (!blob || typeof blob.slice !== 'function' || typeof blob.arrayBuffer !== 'function') return [];
  return readRiffInfoTagsFromReader({
    size: blob.size,
    read: (offset, length) => readBlobBytes(blob, offset, length)
  });
}

export async function readRiffInfoTagsFromReader({ size, read } = {}) {
  const fileSize = Number(size);
  if (typeof read !== 'function') return [];
  if (!Number.isFinite(fileSize) || fileSize < 12) return [];

  const header = normalizeBytes(await read(0, 12));
  if (!header || header.length < 12 || !isRiffWaveHeader(header)) return [];

  const riffSize = readUint32LE(header, 4);
  const scanEnd = Math.min(fileSize, riffSize === 0xffffffff ? fileSize : riffSize + 8);
  const tags = [];
  let offset = 12;
  let chunkCount = 0;

  while (offset + 8 <= scanEnd && chunkCount < MAX_RIFF_SCAN_CHUNKS) {
    const chunkHeader = normalizeBytes(await read(offset, 8));
    if (!chunkHeader || chunkHeader.length < 8) break;
    const chunkId = readAscii(chunkHeader, 0, 4);
    const chunkSize = readUint32LE(chunkHeader, 4);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + chunkSize + (chunkSize % 2);
    if (chunkSize < 0 || nextOffset <= offset || dataOffset + chunkSize > scanEnd) break;

    if (chunkId === 'LIST' && chunkSize >= 4 && chunkSize <= MAX_RIFF_INFO_LIST_BYTES) {
      const listData = normalizeBytes(await read(dataOffset, chunkSize));
      if (listData) tags.push(...parseRiffInfoListBytes(listData));
    }

    offset = nextOffset;
    chunkCount += 1;
  }

  return tags;
}

export function parseRiffInfoTagsFromBytes(data) {
  const bytes = normalizeBytes(data);
  if (!bytes || bytes.length < 12 || !isRiffWaveHeader(bytes)) return [];

  const riffSize = readUint32LE(bytes, 4);
  const scanEnd = Math.min(bytes.length, riffSize === 0xffffffff ? bytes.length : riffSize + 8);
  const tags = [];
  let offset = 12;
  let chunkCount = 0;

  while (offset + 8 <= scanEnd && chunkCount < MAX_RIFF_SCAN_CHUNKS) {
    const chunkId = readAscii(bytes, offset, offset + 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + chunkSize + (chunkSize % 2);
    if (chunkSize < 0 || nextOffset <= offset || dataOffset + chunkSize > scanEnd) break;

    if (chunkId === 'LIST' && chunkSize >= 4 && chunkSize <= MAX_RIFF_INFO_LIST_BYTES) {
      tags.push(...parseRiffInfoListBytes(bytes.subarray(dataOffset, dataOffset + chunkSize)));
    }

    offset = nextOffset;
    chunkCount += 1;
  }

  return tags;
}

function parseRiffInfoListBytes(listData) {
  if (readAscii(listData, 0, 4) !== 'INFO') return [];
  const tags = [];
  let offset = 4;

  while (offset + 8 <= listData.length) {
    const id = readAscii(listData, offset, offset + 4);
    const size = readUint32LE(listData, offset + 4);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + size + (size % 2);
    if (size < 0 || nextOffset <= offset || dataOffset + size > listData.length) break;

    const normalizedId = normalizeInfoId(id);
    if (RIFF_INFO_TAG_IDS.has(normalizedId) && size <= MAX_RIFF_INFO_VALUE_BYTES) {
      tags.push({
        id: normalizedId,
        data: Uint8Array.from(listData.subarray(dataOffset, dataOffset + size))
      });
    }

    offset = nextOffset;
  }

  return tags;
}

async function readBlobBytes(blob, offset, length) {
  return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}

function isRiffWaveHeader(bytes) {
  const riffId = readAscii(bytes, 0, 4);
  return (riffId === 'RIFF' || riffId === 'RF64') && readAscii(bytes, 8, 12) === 'WAVE';
}

function normalizeInfoId(id) {
  return String(id || '').trim().toUpperCase();
}

function normalizeBytes(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  return null;
}

function readAscii(bytes, start, end) {
  let text = '';
  for (let index = start; index < end && index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function readUint32LE(bytes, offset) {
  if (offset + 4 > bytes.length) return 0;
  return (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>> 0;
}
