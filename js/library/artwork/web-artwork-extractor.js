import { parseBlob } from '../../vendor/music-metadata-browser.mjs';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';
import { cueCoverMimeType, selectCueCoverFileName } from '../metadata/cue-cover.js';

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

  async resolveSource({ source, maxRawBytes, signal } = {}) {
    throwIfAborted(signal);
    const filesystem = this.filesystemForFolder?.(source.folderId) ?? this.filesystem;
    const file = await filesystem.getFile(source.canonicalSourceIdentity, signal);
    const metadata = await this.parse(file, { duration: false, skipCovers: false });
    const picture = metadata?.common?.picture?.find(candidate => candidate?.data?.byteLength > 0);
    if (picture) {
      await this.#stagePicture(source, picture, maxRawBytes);
      return source;
    }
    if (source.trackSourceKind !== 'cue-track' || typeof filesystem.listFileNames !== 'function') {
      throw createRepositoryError('artwork-decode-failed', 'Track does not contain embedded artwork');
    }
    const directory = directoryName(source.cueRelativePath);
    const fileName = selectCueCoverFileName(
      await filesystem.listFileNames(directory, signal),
      source.canonicalSourceIdentity
    );
    if (!fileName) throw createRepositoryError('artwork-decode-failed', 'CUE cover image is unavailable');
    const relativePath = directory ? `${directory}/${fileName}` : fileName;
    const cover = await filesystem.getFile(relativePath, signal);
    if (!Number.isSafeInteger(cover.size) || cover.size <= 0 || cover.size > maxRawBytes) {
      throw createRepositoryError('artworkRawTooLarge', 'CUE cover image exceeds the raw byte limit');
    }
    if (!Number.isSafeInteger(cover.lastModified) || cover.lastModified < 0) {
      throw createRepositoryError('artwork-decode-failed', 'CUE cover image timestamp is invalid');
    }
    const bytes = new Uint8Array(await cover.arrayBuffer());
    throwIfAborted(signal);
    if (bytes.byteLength !== cover.size) {
      throw createRepositoryError('artwork-decode-failed', 'CUE cover image changed while it was read');
    }
    const resolved = {
      ...source,
      sourceKind: 'external-file',
      canonicalSourceIdentity: relativePath,
      embeddedOffset: null,
      embeddedLength: null,
      externalArtworkStat: {
        fileIdentity: `fsa:${relativePath}`,
        size: cover.size,
        mtimeMs: cover.lastModified
      }
    };
    await this.#stageBytes(resolved, bytes, cueCoverMimeType(fileName), maxRawBytes);
    return resolved;
  }

  async readHeader({ claim, maxRawBytes, signal } = {}) {
    throwIfAborted(signal);
    const staged = this.pending.get(sourceKey(claim));
    if (staged?.header) return staged.header;
    const filesystem = this.filesystemForFolder?.(claim.folderId) ?? this.filesystem;
    const file = await filesystem.getFile(claim.canonicalSourceIdentity, signal);
    const metadata = await this.parse(file, { duration: false, skipCovers: false });
    const picture = metadata?.common?.picture?.find(candidate => candidate?.data?.byteLength > 0);
    if (!picture) throw createRepositoryError('artwork-decode-failed', 'Track does not contain embedded artwork');
    return this.#stagePicture(claim, picture, maxRawBytes);
  }

  async isSourceCurrent({ claim, signal } = {}) {
    if (claim?.sourceKind !== 'external-file') return true;
    try {
      const filesystem = this.filesystemForFolder?.(claim.folderId) ?? this.filesystem;
      const file = await filesystem.getFile(claim.canonicalSourceIdentity, signal);
      const stat = claim.externalArtworkStat;
      return stat?.fileIdentity === `fsa:${claim.canonicalSourceIdentity}` &&
        stat.size === file.size && stat.mtimeMs === file.lastModified;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return false;
    }
  }

  #stagePicture(claim, picture, maxRawBytes) {
    const rawByteLength = binaryByteLength(picture.data);
    const bytes = copyBinaryData(picture.data, rawByteLength);
    return this.#stageBytes(claim, bytes, normalizeMimeType(picture.format), maxRawBytes);
  }

  async #stageBytes(claim, bytes, mimeType, maxRawBytes) {
    const rawByteLength = bytes.byteLength;
    if (rawByteLength > maxRawBytes) throw createRepositoryError('artworkRawTooLarge', 'Artwork exceeds the raw byte limit');
    const key = sourceKey(claim);
    this.discard({ claim });
    if (this.pending.size >= MAX_STAGED_SOURCES || this.pendingBytes + rawByteLength > MAX_STAGED_BYTES) {
      throw createRepositoryError('artworkQueueLimit', 'Artwork staging budget is full');
    }
    const stagedBytes = copyBinaryData(bytes, rawByteLength);
    const bitmap = await this.createBitmap(new Blob([stagedBytes], { type: mimeType }));
    let dimensions;
    try {
      dimensions = { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close?.();
    }
    const header = { rawByteLength: stagedBytes.byteLength, ...dimensions };
    this.pending.set(key, { bytes: stagedBytes, mimeType, header });
    this.pendingBytes += stagedBytes.byteLength;
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
  const external = claim.externalArtworkStat;
  return [
    claim.trackUid, claim.sourceKind, claim.canonicalSourceIdentity,
    claim.fileIdentity, claim.size, claim.mtimeMs,
    external?.fileIdentity ?? '', external?.size ?? '', external?.mtimeMs ?? ''
  ].join('\u0000');
}

function directoryName(value) {
  const path = String(value ?? '').replaceAll('\\', '/');
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Artwork request aborted', 'AbortError');
}
