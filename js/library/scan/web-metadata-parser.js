import { parseBlob } from '../../vendor/music-metadata-browser.mjs';
import { getFileExtension } from '../constants.js';
import { createTrackFromMetadata, shouldRetryDuration } from '../metadata/metadata-mapper.js';
import { readRiffInfoTagsFromBlob } from '../metadata/riff-info.js';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';

export const WEB_METADATA_PARSER_VERSION = 'web-metadata-1';
export const WEB_METADATA_RESULT_MAX_BYTES = 16 * 1024 * 1024;
export const WEB_METADATA_HEADER_MAX_BYTES = 16 * 1024 * 1024;

export class WebMetadataParser {
  constructor({ filesystem, parse = parseBlob, readRiffInfo = readRiffInfoTagsFromBlob, now = () => Date.now() } = {}) {
    assertRepositoryContract(typeof filesystem?.getFile === 'function', 'invalidMetadataParser', 'Web metadata parser requires the Worker filesystem adapter');
    this.filesystem = filesystem;
    this.parseBlob = parse;
    this.readRiffInfo = readRiffInfo;
    this.now = now;
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
    title: track.title,
    artist: track.artist,
    albumArtist: track.albumArtist,
    album: track.album,
    genre: track.genre,
    year: track.year,
    discNo: track.discNo,
    trackNo: track.trackNo,
    durationSec: track.durationSec,
    sampleRate: track.sampleRate,
    codec: track.codec
  };
}

function classifyParserError(error) {
  const name = String(error?.name ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  let code = 'unknown-internal';
  if (name === 'UnsupportedFileTypeError' || message.includes('not supported')) code = 'unsupported-container';
  else if (name === 'CouldNotDetermineFileTypeError' || message.includes('corrupt')) code = 'corrupt-container';
  else if (name === 'AbortError') code = 'parse-timeout';
  return createRepositoryError(code, 'Browser metadata parsing failed', { parserErrorName: name || 'Error' });
}
