'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parentPort } = require('node:worker_threads');

let metadataModulePromise = null;
let metadataSupportPromise = null;

parentPort?.on('message', async message => {
  if (!message || message.type !== 'parse' || !Number.isSafeInteger(message.requestId)) return;
  try {
    validateParseMessage(message);
    if (message.skipCovers !== true) throw typedError('metadataArtworkForbidden', 'Metadata scan must skip artwork');
    metadataModulePromise ??= import('music-metadata');
    metadataSupportPromise ??= loadMetadataSupport();
    const [metadata, support] = await Promise.all([metadataModulePromise, metadataSupportPromise]);
    const candidate = createCandidate(message);
    const riffInfoTagsPromise = candidate.ext === 'wav'
      ? readRiffInfoTagsFromFile(message.filePath, support.readRiffInfoTagsFromReader).catch(() => [])
      : Promise.resolve([]);
    let parsed = await metadata.parseFile(message.filePath, { duration: false, skipCovers: true });
    if (support.shouldRetryDuration(candidate, parsed)) {
      parsed = await metadata.parseFile(message.filePath, { duration: true, skipCovers: true });
    }
    const riffInfoTags = await riffInfoTagsPromise;
    const track = support.createTrackFromMetadata(candidate, parsed, Date.now(), {
      languageHints: message.languageHints,
      riffInfoTags
    });
    parentPort.postMessage({
      type: 'result',
      requestId: message.requestId,
      result: normalizeMetadata(track)
    });
  } catch (error) {
    parentPort.postMessage({ type: 'error', requestId: message.requestId, error: serializeError(error) });
  }
});

function validateParseMessage(message) {
  const expected = ['filePath', 'languageHints', 'relativePath', 'requestId', 'skipCovers', 'type'];
  const actual = Object.keys(message).sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw typedError('invalidMetadataRequest', 'Metadata parse request fields are invalid');
  }
  if (!Number.isSafeInteger(message.requestId) || message.requestId < 1) {
    throw typedError('invalidMetadataRequest', 'Metadata parse request ID is invalid');
  }
  if (typeof message.filePath !== 'string' || !path.isAbsolute(message.filePath) || message.filePath.length > 32_768) {
    throw typedError('invalidMetadataRequest', 'Metadata file path is invalid');
  }
  if (typeof message.relativePath !== 'string' || !message.relativePath || message.relativePath.length > 32_768) {
    throw typedError('invalidMetadataRequest', 'Metadata relative path is invalid');
  }
  let encoded;
  try {
    encoded = JSON.stringify(message.languageHints);
  } catch {
    throw typedError('invalidMetadataRequest', 'Metadata language hints are invalid');
  }
  if (encoded !== undefined && Buffer.byteLength(encoded, 'utf8') > 64 * 1024) {
    throw typedError('invalidMetadataRequest', 'Metadata language hints exceed their byte limit');
  }
}

async function loadMetadataSupport() {
  const mapperPath = pathToFileURL(path.join(__dirname, '../js/library/metadata/metadata-mapper.js')).href;
  const riffInfoPath = pathToFileURL(path.join(__dirname, '../js/library/metadata/riff-info.js')).href;
  const [mapper, riffInfo] = await Promise.all([import(mapperPath), import(riffInfoPath)]);
  return {
    createTrackFromMetadata: mapper.createTrackFromMetadata,
    shouldRetryDuration: mapper.shouldRetryDuration,
    readRiffInfoTagsFromReader: riffInfo.readRiffInfoTagsFromReader
  };
}

function createCandidate(message) {
  const relativePath = String(message.relativePath || path.basename(message.filePath));
  const fileName = relativePath.split('/').at(-1) || path.basename(message.filePath);
  return {
    path: message.filePath,
    relativePath,
    fileName,
    ext: path.extname(fileName).slice(1).toLowerCase()
  };
}

async function readRiffInfoTagsFromFile(filePath, readRiffInfoTagsFromReader) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return [];
    return await readRiffInfoTagsFromReader({
      size: Number(stat.size),
      read: (offset, length) => readFileBytes(handle, offset, length)
    });
  } finally {
    await handle.close();
  }
}

async function readFileBytes(handle, offset, length) {
  const buffer = Buffer.allocUnsafe(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const result = await handle.read(buffer, bytesRead, length - bytesRead, offset + bytesRead);
    if (result.bytesRead === 0) break;
    bytesRead += result.bytesRead;
  }
  return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
}

function normalizeMetadata(track) {
  return {
    title: boundedText(track.title, 4096),
    artist: boundedText(track.artist, 4096),
    albumArtist: boundedText(track.albumArtist, 4096),
    album: boundedText(track.album, 4096),
    genre: boundedText(track.genre, 4096),
    year: integerOrNull(track.year),
    compilation: track.compilation === true,
    discNo: integerOrNull(track.discNo),
    discTotal: integerOrNull(track.discOf),
    trackNo: integerOrNull(track.trackNo),
    trackTotal: integerOrNull(track.trackOf),
    durationSec: finiteOrNull(track.durationSec),
    sampleRate: integerOrNull(track.sampleRate),
    bitrate: integerOrNull(track.bitrate),
    bitsPerSample: integerOrNull(track.bitsPerSample),
    channels: integerOrNull(track.channels),
    codec: boundedText(track.codec, 512) || null
  };
}

function boundedText(value, maximum) {
  if (value == null) return '';
  return String(value).slice(0, maximum);
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function serializeError(error) {
  return {
    code: classifyError(error),
    message: String(error?.message || 'Metadata parse failed').slice(0, 1024)
  };
}

function classifyError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (['EACCES', 'EPERM'].includes(code)) return 'temporary-permission';
  if (['ENOENT', 'EBUSY'].includes(code)) return 'transient-io';
  if (['EMFILE', 'ENFILE', 'ENOMEM'].includes(code)) return 'resource-exhausted';
  if (code === 'METADATAARTWORKFORBIDDEN') return 'metadata-artwork-forbidden';
  if (code === 'INVALIDMETADATAREQUEST') return 'invalid-metadata-request';
  const parserName = String(error?.name || '');
  if (parserName === 'CouldNotDetermineFileTypeError' || parserName === 'UnsupportedFileTypeError') {
    return 'unsupported-container';
  }
  if (parserName === 'UnexpectedFileContentError') return 'corrupt-container';
  if (parserName === 'FieldDecodingError') return 'corrupt-tag';
  return 'unknown-internal';
}

function typedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  validateParseMessage
};
