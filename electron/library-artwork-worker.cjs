'use strict';

const { parentPort } = require('node:worker_threads');
const fs = require('node:fs/promises');

const MAX_RAW_BYTES = 20 * 1024 * 1024;
let metadataModulePromise = null;

parentPort.on('message', async message => {
  if (!message || message.type !== 'extract' || !Number.isSafeInteger(message.requestId)) return;
  try {
    const handle = await fs.open(message.filePath, 'r');
    let before;
    try {
      before = await handle.stat();
    } finally {
      await handle.close();
    }
    metadataModulePromise ??= import('music-metadata');
    const metadata = await metadataModulePromise;
    const parsed = await metadata.parseFile(message.filePath, { duration: false, skipCovers: false });
    const picture = parsed.common?.picture?.find(candidate => candidate?.data?.byteLength > 0);
    if (!picture) {
      parentPort.postMessage({ type: 'result', requestId: message.requestId, result: null });
      return;
    }
    const bytes = Buffer.from(picture.data);
    if (bytes.byteLength > MAX_RAW_BYTES) throw typedError('artworkRawTooLarge', 'Artwork raw bytes exceed limit');
    const size = readImageSize(bytes, picture.format);
    const after = await fs.stat(message.filePath);
    if (before.size !== after.size || Math.round(before.mtimeMs) !== Math.round(after.mtimeMs)) {
      throw typedError('artwork-source-changed', 'Artwork source changed during extraction');
    }
    parentPort.postMessage({
      type: 'result', requestId: message.requestId,
      result: {
        bytes: new Uint8Array(bytes),
        mimeType: normalizeMimeType(picture.format),
        width: size.width,
        height: size.height,
        embeddedOffset: null,
        embeddedLength: bytes.byteLength,
        fileStat: { size: after.size, mtimeMs: Math.round(after.mtimeMs) }
      }
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'error', requestId: message.requestId,
      error: {
        code: String(error?.code || 'artwork-decode-failed').slice(0, 128),
        message: String(error?.message || 'Artwork extraction failed').slice(0, 1024)
      }
    });
  }
});

function readImageSize(bytes, format) {
  const mime = normalizeMimeType(format);
  if (mime === 'image/png') return readPngSize(bytes);
  if (mime === 'image/jpeg') return readJpegSize(bytes);
  if (mime === 'image/webp') return readWebpSize(bytes);
  throw typedError('artwork-unsupported-format', 'Artwork format is unsupported');
}

function readPngSize(bytes) {
  if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw typedError('artwork-invalid-header', 'PNG header is invalid');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw typedError('artwork-invalid-header', 'JPEG header is invalid');
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    if (offset + 4 > bytes.length) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (isJpegStartOfFrame(marker) && length >= 7) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  throw typedError('artwork-invalid-header', 'JPEG dimensions are unavailable');
}

function isJpegStartOfFrame(marker) {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function readWebpSize(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw typedError('artwork-invalid-header', 'WebP header is invalid');
  }
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    };
  }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  throw typedError('artwork-invalid-header', 'WebP dimensions are unavailable');
}

function normalizeMimeType(value) {
  const format = String(value || '').toLowerCase();
  if (format === 'image/jpg' || format === 'jpg' || format === 'jpeg' || format === 'image/jpeg') return 'image/jpeg';
  if (format === 'png' || format === 'image/png') return 'image/png';
  if (format === 'webp' || format === 'image/webp') return 'image/webp';
  return format.startsWith('image/') ? format : `image/${format}`;
}

function typedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
