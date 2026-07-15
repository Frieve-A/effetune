'use strict';

const { parentPort } = require('node:worker_threads');
const fs = require('node:fs/promises');

const MAX_RAW_BYTES = 20 * 1024 * 1024;
let parserModulesPromise = null;

parentPort?.on('message', async message => {
  if (!message || message.type !== 'extract' || !Number.isSafeInteger(message.requestId)) return;
  try {
    const handle = await fs.open(message.filePath, 'r');
    let before;
    try {
      before = await handle.stat();
    } finally {
      await handle.close();
    }
    parserModulesPromise ??= Promise.all([import('music-metadata'), import('strtok3')]);
    const [metadata, tokenizerModule] = await parserModulesPromise;
    const tokenizer = capArtworkParserAllocations(await tokenizerModule.fromFile(message.filePath));
    let parsed;
    try {
      parsed = await metadata.parseFromTokenizer(tokenizer, { duration: false, skipCovers: false });
    } finally {
      await tokenizer.close();
    }
    const picture = parsed.common?.picture?.find(candidate => candidate?.data?.byteLength > 0);
    if (!picture) {
      parentPort.postMessage({ type: 'result', requestId: message.requestId, result: null });
      return;
    }
    if (picture.data.byteLength > MAX_RAW_BYTES) {
      throw typedError('artworkRawTooLarge', 'Artwork raw bytes exceed limit');
    }
    const bytes = Buffer.from(picture.data.buffer, picture.data.byteOffset, picture.data.byteLength);
    const after = await fs.stat(message.filePath);
    if (before.size !== after.size || Math.round(before.mtimeMs) !== Math.round(after.mtimeMs)) {
      throw typedError('artwork-source-changed', 'Artwork source changed during extraction');
    }
    parentPort.postMessage({
      type: 'result', requestId: message.requestId,
      result: {
        bytes: new Uint8Array(bytes),
        mimeType: normalizeMimeType(picture.format),
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

function capArtworkParserAllocations(tokenizer, maximumBytes = MAX_RAW_BYTES) {
  const readToken = tokenizer.readToken.bind(tokenizer);
  const peekToken = tokenizer.peekToken.bind(tokenizer);
  tokenizer.readToken = (token, ...args) => {
    assertArtworkParserToken(token, maximumBytes);
    return readToken(token, ...args);
  };
  tokenizer.peekToken = (token, ...args) => {
    assertArtworkParserToken(token, maximumBytes);
    return peekToken(token, ...args);
  };
  return tokenizer;
}

function assertArtworkParserToken(token, maximumBytes) {
  if (!Number.isSafeInteger(token?.len) || token.len < 0) {
    throw typedError('artwork-decode-failed', 'Artwork parser requested an invalid allocation');
  }
  if (token.len > maximumBytes) {
    throw typedError('artworkRawTooLarge', 'Artwork parser allocation exceeds limit');
  }
}

function normalizeMimeType(value) {
  const format = String(value || '').toLowerCase();
  if (format === 'image/jpg' || format === 'jpg' || format === 'jpeg' || format === 'image/jpeg') return 'image/jpeg';
  if (format === 'png' || format === 'image/png') return 'image/png';
  if (format === 'webp' || format === 'image/webp') return 'image/webp';
  if (!format) return 'application/octet-stream';
  return format.startsWith('image/') ? format : `image/${format}`;
}

function typedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { capArtworkParserAllocations };
