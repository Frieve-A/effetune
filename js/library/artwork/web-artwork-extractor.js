import { parseBlob } from '../../vendor/music-metadata-browser.mjs';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';

const MAX_STAGED_SOURCES = 8;
const MAX_STAGED_BYTES = 40 * 1024 * 1024;

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
    this.createBitmap = (...args) => createBitmap.call(globalThis, ...args);
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
    const rawByteLength = binaryByteLength(picture.data);
    if (rawByteLength > maxRawBytes) throw createRepositoryError('artworkRawTooLarge', 'Embedded artwork exceeds the raw byte limit');
    const mimeType = normalizeMimeType(picture.format);
    const key = sourceKey(claim);
    this.discard({ claim });
    if (this.pending.size >= MAX_STAGED_SOURCES || this.pendingBytes + rawByteLength > MAX_STAGED_BYTES) {
      throw createRepositoryError('artworkQueueLimit', 'Artwork staging budget is full');
    }
    const bytes = copyBinaryData(picture.data, rawByteLength);
    const bitmap = await this.createBitmap(new Blob([bytes], { type: mimeType }));
    let dimensions;
    try {
      dimensions = { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close?.();
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

function binaryByteLength(value) {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
  throw createRepositoryError('artwork-decode-failed', 'Embedded artwork data is invalid');
}

function copyBinaryData(value, byteLength) {
  const source = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, byteLength);
  const copy = new Uint8Array(byteLength);
  copy.set(source);
  return copy;
}

function normalizeMimeType(value) {
  const mimeType = String(value ?? '').toLowerCase();
  if (mimeType === 'jpg' || mimeType === 'jpeg' || mimeType === 'image/jpg') return 'image/jpeg';
  if (mimeType === 'png') return 'image/png';
  if (mimeType === 'webp') return 'image/webp';
  if (!mimeType) return 'application/octet-stream';
  return mimeType.startsWith('image/') ? mimeType : `image/${mimeType}`;
}

function sourceKey(claim) {
  return `${claim.trackUid}\u0000${claim.fileIdentity}\u0000${claim.size}\u0000${claim.mtimeMs}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Artwork request aborted', 'AbortError');
}
