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
    if (message.lyrics !== null) {
      const result = await readTrackLyrics(message, metadata, support);
      parentPort.postMessage({ type: 'result', requestId: message.requestId, result });
      return;
    }
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
  const expected = ['filePath', 'languageHints', 'lyrics', 'relativePath', 'requestId', 'skipCovers', 'type'];
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
  if (message.lyrics !== null) {
    const lyrics = message.lyrics;
    if (!lyrics || typeof lyrics !== 'object' || Array.isArray(lyrics) ||
        Object.keys(lyrics).sort().join(',') !== 'names,region' ||
        !Array.isArray(lyrics.names) || lyrics.names.length === 0 || lyrics.names.length > 8 ||
        lyrics.names.some(name => typeof name !== 'string' || !name || name.length > 32_768)) {
      throw typedError('invalidMetadataRequest', 'Metadata lyrics request is invalid');
    }
    const region = lyrics.region;
    if (region !== null && (!region || typeof region !== 'object' || Array.isArray(region) ||
        Object.keys(region).sort().join(',') !== 'end,start' ||
        !Number.isFinite(region.start) || region.start < 0 ||
        !(region.end === null || (Number.isFinite(region.end) && region.end > region.start)))) {
      throw typedError('invalidMetadataRequest', 'Metadata lyrics region is invalid');
    }
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
  const lyricsPath = pathToFileURL(path.join(__dirname, '../js/library/metadata/lyrics.js')).href;
  const textEncodingPath = pathToFileURL(path.join(__dirname, '../js/library/metadata/text-encoding.js')).href;
  const [mapper, riffInfo, lyrics, textEncoding] = await Promise.all([
    import(mapperPath), import(riffInfoPath), import(lyricsPath), import(textEncodingPath)
  ]);
  return {
    ...lyrics,
    TEXT_FILE_MAX_BYTES: textEncoding.TEXT_FILE_MAX_BYTES,
    createTrackFromMetadata: mapper.createTrackFromMetadata,
    shouldRetryDuration: mapper.shouldRetryDuration,
    readRiffInfoTagsFromReader: riffInfo.readRiffInfoTagsFromReader
  };
}

async function readTrackLyrics(message, metadata, support) {
  const { names, region } = message.lyrics;
  const embeddedPromise = metadata.parseFile(message.filePath, { duration: false, skipCovers: true })
    .then(parsed => support.lyricsFromMetadata(parsed)).catch(() => null);
  const sidecarPromise = (async () => {
    const directory = path.dirname(message.filePath);
    const match = support.findLyricsFileName(await fs.readdir(directory), names);
    if (!match) return null;
    const handle = await fs.open(path.join(directory, match.fileName), 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > support.TEXT_FILE_MAX_BYTES) return null;
      const bytes = await readFileBytes(handle, 0, Number(stat.size));
      return { data: support.lyricsFromLrcBytes(bytes), index: match.index };
    } finally {
      await handle.close();
    }
  })().catch(() => null);
  const [embedded, sidecar] = await Promise.all([embeddedPromise, sidecarPromise]);
  return { lyrics: support.selectLyrics({
    embedded, sidecar: sidecar?.data ?? null,
    perTrack: sidecar ? sidecar.index < names.length - 1 : false, region
  }) };
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
    albumArtists: boundedTextList(track.albumArtists, 64, 4096),
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

function boundedTextList(value, maximumItems, maximumCharacters) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximumItems).map(item => boundedText(item, maximumCharacters));
}

function integerOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function finiteOrNull(value) {
  if (value == null) return null;
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
