import { parseBlob } from '../../vendor/music-metadata-browser.mjs';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';

const MAX_STAGED_SOURCES = 8;
const MAX_STAGED_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_HEADER_BYTES = 256 * 1024;

export class WebArtworkExtractor {
  constructor({ filesystem, filesystemForFolder, parse = parseBlob, createBitmap = globalThis.createImageBitmap } = {}) {
    assertRepositoryContract(
      typeof filesystem?.getFile === 'function' || typeof filesystemForFolder === 'function',
      'invalidArtworkAdapter',
      'Artwork extraction requires a filesystem adapter'
    );
    assertRepositoryContract(typeof createBitmap === 'function', 'invalidArtworkAdapter', 'Artwork extraction requires createImageBitmap');
    this.filesystem = filesystem;
    this.filesystemForFolder = filesystemForFolder;
    this.parse = parse;
    this.createBitmap = createBitmap;
    this.pending = new Map();
    this.pendingBytes = 0;
  }

  async readHeader({ claim, maxRawBytes, signal } = {}) {
    throwIfAborted(signal);
    const filesystem = this.filesystemForFolder?.(claim.folderId) ?? this.filesystem;
    const file = await filesystem.getFile(claim.canonicalSourceIdentity, signal);
    const metadata = await this.parse(file, { duration: false, skipCovers: false });
    const picture = metadata?.common?.picture?.find(candidate => candidate?.data?.byteLength > 0);
    if (!picture) throw createRepositoryError('artwork-decode-failed', 'Track does not contain embedded artwork');
    const bytes = picture.data instanceof Uint8Array ? new Uint8Array(picture.data) : new Uint8Array(picture.data ?? 0);
    if (bytes.byteLength > maxRawBytes) throw createRepositoryError('artworkRawTooLarge', 'Embedded artwork exceeds the raw byte limit');
    const mimeType = normalizeMimeType(picture.format);
    const dimensions = readImageDimensions(bytes, mimeType);
    const key = sourceKey(claim);
    this.discard({ claim });
    if (this.pending.size >= MAX_STAGED_SOURCES || this.pendingBytes + bytes.byteLength > MAX_STAGED_BYTES) {
      throw createRepositoryError('artworkQueueLimit', 'Artwork staging budget is full');
    }
    this.pending.set(key, { bytes, mimeType });
    this.pendingBytes += bytes.byteLength;
    const header = { rawByteLength: bytes.byteLength, ...dimensions };
    return header;
  }

  async createThumbnail({ claim, maxWidth, maxHeight, maxBytes, signal } = {}) {
    throwIfAborted(signal);
    const key = sourceKey(claim);
    const source = this.pending.get(key);
    if (source) this.pendingBytes -= source.bytes.byteLength;
    this.pending.delete(key);
    if (!source) throw createRepositoryError('artwork-decode-failed', 'Artwork source is no longer staged');
    const bitmap = await this.createBitmap(new Blob([source.bytes], { type: source.mimeType }));
    try {
      const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', { alpha: false });
      assertRepositoryContract(context, 'artwork-decode-failed', 'Artwork canvas is unavailable');
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.86, 0.72, 0.58, 0.44]) {
        throwIfAborted(signal);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        if (blob.size <= maxBytes) {
          return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, mimeType: 'image/jpeg' };
        }
      }
      throw createRepositoryError('artworkThumbnailTooLarge', 'Artwork thumbnail exceeds the byte limit');
    } finally {
      bitmap.close?.();
    }
  }

  discard({ claim } = {}) {
    if (!claim) return;
    const key = sourceKey(claim);
    const source = this.pending.get(key);
    if (!source) return;
    this.pending.delete(key);
    this.pendingBytes -= source.bytes.byteLength;
  }
}

function readImageDimensions(bytes, mimeType) {
  if (mimeType === 'image/png') return readPngDimensions(bytes);
  if (mimeType === 'image/jpeg') return readJpegDimensions(bytes);
  if (mimeType === 'image/webp') return readWebpDimensions(bytes);
  throw createRepositoryError('artwork-decode-failed', 'Artwork format is unsupported');
}

function readPngDimensions(bytes) {
  if (bytes.byteLength < 24 || !bytesEqual(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    throw createRepositoryError('artwork-decode-failed', 'PNG header is invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegDimensions(bytes) {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw createRepositoryError('artwork-decode-failed', 'JPEG header is invalid');
  }
  const maximum = Math.min(bytes.byteLength, MAX_IMAGE_HEADER_BYTES);
  let offset = 2;
  while (offset + 9 < maximum) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    if (offset + 4 > maximum) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > maximum) break;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7) {
      return {
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        height: (bytes[offset + 5] << 8) | bytes[offset + 6]
      };
    }
    offset += 2 + length;
  }
  throw createRepositoryError('artwork-decode-failed', 'JPEG dimensions are unavailable within the header budget');
}

function readWebpDimensions(bytes) {
  if (bytes.byteLength < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP') {
    throw createRepositoryError('artwork-decode-failed', 'WebP header is invalid');
  }
  const kind = ascii(bytes, 12, 16);
  if (kind === 'VP8X') {
    return { width: 1 + uint24le(bytes, 24), height: 1 + uint24le(bytes, 27) };
  }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits = new DataView(bytes.buffer, bytes.byteOffset + 21, 4).getUint32(0, true);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (kind === 'VP8 ' && bytes.byteLength >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: ((bytes[27] << 8) | bytes[26]) & 0x3fff,
      height: ((bytes[29] << 8) | bytes[28]) & 0x3fff
    };
  }
  throw createRepositoryError('artwork-decode-failed', 'WebP dimensions are unavailable');
}

function bytesEqual(bytes, expected) {
  return expected.every((value, index) => bytes[index] === value);
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function uint24le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function normalizeMimeType(value) {
  const mimeType = String(value ?? '').toLowerCase();
  if (mimeType === 'jpg' || mimeType === 'jpeg' || mimeType === 'image/jpg') return 'image/jpeg';
  if (mimeType === 'png') return 'image/png';
  if (mimeType === 'webp') return 'image/webp';
  return mimeType.startsWith('image/') ? mimeType : 'application/octet-stream';
}

function sourceKey(claim) {
  return `${claim.trackUid}\u0000${claim.fileIdentity}\u0000${claim.size}\u0000${claim.mtimeMs}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Artwork request aborted', 'AbortError');
}
