'use strict';

const path = require('node:path');
const { parentPort } = require('node:worker_threads');

let metadataModulePromise = null;

parentPort.on('message', async message => {
  if (!message || message.type !== 'parse' || !Number.isSafeInteger(message.requestId)) return;
  try {
    if (message.skipCovers !== true) throw typedError('metadataArtworkForbidden', 'Metadata scan must skip artwork');
    metadataModulePromise ??= import('music-metadata');
    const metadata = await metadataModulePromise;
    const parsed = await metadata.parseFile(message.filePath, { duration: true, skipCovers: true });
    parentPort.postMessage({
      type: 'result',
      requestId: message.requestId,
      result: normalizeMetadata(parsed, message.relativePath)
    });
  } catch (error) {
    parentPort.postMessage({ type: 'error', requestId: message.requestId, error: serializeError(error) });
  }
});

function normalizeMetadata(parsed, relativePath) {
  const common = parsed?.common ?? {};
  const format = parsed?.format ?? {};
  return {
    title: boundedText(common.title || path.basename(relativePath, path.extname(relativePath)), 4096),
    artist: boundedText(common.artist, 4096),
    albumArtist: boundedText(common.albumartist, 4096),
    album: boundedText(common.album, 4096),
    genre: Array.isArray(common.genre)
      ? common.genre.slice(0, 64).map(value => boundedText(value, 1024)).filter(Boolean)
      : [],
    year: integerOrNull(common.year),
    compilation: common.compilation === true,
    discNo: integerOrNull(common.disk?.no),
    discTotal: integerOrNull(common.disk?.of),
    trackNo: integerOrNull(common.track?.no),
    trackTotal: integerOrNull(common.track?.of),
    durationSec: finiteOrNull(format.duration),
    sampleRate: integerOrNull(format.sampleRate),
    bitrate: integerOrNull(format.bitrate),
    bitsPerSample: integerOrNull(format.bitsPerSample),
    channels: integerOrNull(format.numberOfChannels),
    codec: boundedText(format.codec || format.container, 1024) || null
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
