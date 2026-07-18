import { parseBlob } from '../../vendor/music-metadata-browser.mjs';
import { getFileExtension } from '../constants.js';
import { createTrackFromMetadata, shouldRetryDuration } from '../metadata/metadata-mapper.js';
import { readRiffInfoTagsFromBlob } from '../metadata/riff-info.js';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';

export const WEB_METADATA_PARSER_VERSION = 'web-metadata-3';
export const WEB_METADATA_RESULT_MAX_BYTES = 16 * 1024 * 1024;
export const WEB_METADATA_HEADER_MAX_BYTES = 16 * 1024 * 1024;
const MAX_TRACK_TEXT_CHARACTERS = 4096;
const MAX_CODEC_CHARACTERS = 512;

export class WebMetadataParser {
  constructor({
    filesystem,
    parse = parseBlob,
    readRiffInfo = readRiffInfoTagsFromBlob,
    now = () => Date.now(),
    languageHints = null
  } = {}) {
    assertRepositoryContract(typeof filesystem?.getFile === 'function', 'invalidMetadataParser', 'Web metadata parser requires the Worker filesystem adapter');
    this.filesystem = filesystem;
    this.parseBlob = parse;
    this.readRiffInfo = readRiffInfo;
    this.now = now;
    this.languageHints = languageHints;
  }

  async parse({ relativePath, skipCovers, signal } = {}) {
    assertRepositoryContract(skipCovers === true, 'metadataArtworkForbidden', 'Scan metadata parsing must skip covers');
    const file = await this.filesystem.getFile(relativePath, signal);
    const candidate = {
      relativePath,
      fileName: relativePath.split('/').at(-1) || file.name,
      ext: getFileExtension(relativePath),
      size: file.size,
      mtimeMs: file.lastModified
    };
    try {
      const riffInfoPromise = this.readRiffInfo(file).catch(() => []);
      let metadata = await this.parseBlob(file, parserOptions(false));
      if (shouldRetryDuration(candidate, metadata)) {
        metadata = await this.parseBlob(file, parserOptions(true));
      }
      const mapped = createTrackFromMetadata(candidate, metadata, this.now(), {
        languageHints: this.languageHints,
        riffInfoTags: await riffInfoPromise
      });
      const result = projectMetadata(mapped);
      assertRepositoryContract(
        new TextEncoder().encode(JSON.stringify(result)).byteLength <= WEB_METADATA_RESULT_MAX_BYTES,
        'metadata-too-large',
        'Parsed metadata exceeds the configured byte limit'
      );
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error?.code) throw error;
      throw classifyParserError(error);
    }
  }
}

function parserOptions(duration) {
  let observedBytes = 0;
  return {
    duration,
    skipCovers: true,
    observer(event) {
      const tag = event?.tag;
      if (!tag) return;
      observedBytes += new TextEncoder().encode(JSON.stringify({
        type: tag.type,
        id: tag.id,
        value: tag.value
      })).byteLength;
      assertRepositoryContract(
        observedBytes <= WEB_METADATA_HEADER_MAX_BYTES,
        'metadata-too-large',
        'Metadata headers exceed the configured byte limit'
      );
    }
  };
}

function projectMetadata(track) {
  return {
    title: boundedText(track.title, MAX_TRACK_TEXT_CHARACTERS),
    artist: boundedText(track.artist, MAX_TRACK_TEXT_CHARACTERS),
    albumArtist: boundedText(track.albumArtist, MAX_TRACK_TEXT_CHARACTERS),
    albumArtists: boundedTextList(track.albumArtists, 64, MAX_TRACK_TEXT_CHARACTERS),
    album: boundedText(track.album, MAX_TRACK_TEXT_CHARACTERS),
    genre: boundedText(track.genre, MAX_TRACK_TEXT_CHARACTERS),
    year: track.year,
    compilation: track.compilation,
    discNo: nonNegativeIntegerOrNull(track.discNo),
    discTotal: nonNegativeIntegerOrNull(track.discOf),
    trackNo: nonNegativeIntegerOrNull(track.trackNo),
    trackTotal: nonNegativeIntegerOrNull(track.trackOf),
    durationSec: nonNegativeFiniteOrNull(track.durationSec),
    sampleRate: nonNegativeIntegerOrNull(track.sampleRate),
    bitrate: nonNegativeIntegerOrNull(track.bitrate),
    bitsPerSample: nonNegativeIntegerOrNull(track.bitsPerSample),
    channels: nonNegativeIntegerOrNull(track.channels),
    codec: boundedText(track.codec, MAX_CODEC_CHARACTERS) || null
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

function nonNegativeIntegerOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function nonNegativeFiniteOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function classifyParserError(error) {
  const name = String(error?.name ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  let code = 'unknown-internal';
  if (name === 'UnsupportedFileTypeError' || message.includes('not supported')) code = 'unsupported-container';
  else if (name === 'CouldNotDetermineFileTypeError' || message.includes('corrupt')) code = 'corrupt-container';
  return createRepositoryError(code, 'Browser metadata parsing failed', { parserErrorName: name || 'Error' });
}
