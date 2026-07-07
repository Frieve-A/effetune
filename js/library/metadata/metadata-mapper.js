import { createFallbackDisplayName, getFileExtension, stripExtension } from '../constants.js';
import { repairLegacyMetadataMojibake } from './text-encoding.js';

export function createFallbackTrack(candidate = {}, now = Date.now()) {
  const fileName = candidate.fileName || String(candidate.relativePath || '').split('/').pop() || 'Unknown';
  const ext = candidate.ext || getFileExtension(fileName);
  const title = stripExtension(fileName) || createFallbackDisplayName(fileName);
  return {
    folderId: candidate.folderId,
    relativePath: candidate.relativePath,
    fileName,
    ext,
    size: candidate.size,
    mtimeMs: candidate.mtimeMs,
    title,
    artist: '',
    albumArtist: '',
    album: '',
    genre: '',
    year: null,
    trackNo: null,
    trackOf: null,
    discNo: null,
    discOf: null,
    compilation: false,
    sortTitle: '',
    sortAlbum: '',
    sortAlbumArtist: '',
    durationSec: null,
    sampleRate: null,
    bitrate: null,
    bitsPerSample: null,
    channels: null,
    codec: ext ? ext.toUpperCase() : '',
    artworkId: null,
    artworkBytes: null,
    artworkMime: null,
    artworkSourceKind: null,
    file: candidate.file || undefined,
    addedAt: now,
    updatedAt: now
  };
}

export function createTrackFromMetadata(candidate, metadata, now = Date.now(), { languageHints = null } = {}) {
  const common = metadata?.common || {};
  const format = metadata?.format || {};
  const fallback = createFallbackTrack(candidate, now);
  const artist = joinedArtists(common, languageHints);
  const albumArtist = stringOrEmpty(common.albumartist, languageHints) || artist || '';
  const genre = firstArrayString(common.genre, languageHints) || stringOrEmpty(common.genre, languageHints);
  const title = stringOrEmpty(common.title, languageHints) || fallback.title;
  const lowerAlbumArtist = albumArtist.toLowerCase();
  const picture = selectPicture(common.picture);
  const pictureBytes = toArrayBuffer(picture?.data);

  return {
    ...fallback,
    title,
    artist,
    albumArtist,
    album: stringOrEmpty(common.album, languageHints),
    genre,
    year: integerOrNull(common.year),
    trackNo: common.track ? integerOrNull(common.track.no) : null,
    trackOf: common.track ? integerOrNull(common.track.of) : null,
    discNo: common.disk ? integerOrNull(common.disk.no) : null,
    discOf: common.disk ? integerOrNull(common.disk.of) : null,
    compilation: common.compilation === true || lowerAlbumArtist === 'various artists',
    sortTitle: getSortText(common, ['titlesort', 'titleSort', 'sorttitle'], languageHints),
    sortAlbum: getSortText(common, ['albumsort', 'albumSort', 'sortalbum'], languageHints),
    sortAlbumArtist: getSortText(common, ['albumartistsort', 'albumArtistSort', 'sortalbumartist'], languageHints),
    durationSec: numberOrNull(format.duration),
    sampleRate: numberOrNull(format.sampleRate),
    bitrate: numberOrNull(format.bitrate),
    bitsPerSample: numberOrNull(format.bitsPerSample),
    channels: numberOrNull(format.numberOfChannels),
    codec: stringOrEmpty(format.codec, languageHints) || stringOrEmpty(format.dataformat, languageHints).toUpperCase() || fallback.codec,
    artworkBytes: pictureBytes,
    artworkMime: pictureBytes ? stringOrEmpty(picture.format, languageHints) || 'application/octet-stream' : null,
    artworkSourceKind: pictureBytes ? 'embedded' : null
  };
}

export function shouldRetryDuration(candidate = {}, metadata = {}) {
  if (Number.isFinite(metadata?.format?.duration)) return false;
  const ext = String(candidate.ext || getFileExtension(candidate.fileName || '')).toLowerCase();
  return ext === 'aac' || ext === 'mp3';
}

function toArrayBuffer(data) {
  if (!data) return null;
  if (data instanceof ArrayBuffer) return data.slice(0);
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  if (Array.isArray(data)) return Uint8Array.from(data).buffer;
  return null;
}

function stringOrEmpty(value, languageHints = null) {
  if (typeof value === 'string') return repairLegacyMetadataMojibake(value.trim(), languageHints);
  if (value === null || value === undefined) return '';
  return repairLegacyMetadataMojibake(String(value).trim(), languageHints);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function firstArrayString(value, languageHints = null) {
  if (!Array.isArray(value)) return '';
  for (const item of value) {
    const text = stringOrEmpty(item, languageHints);
    if (text) return text;
  }
  return '';
}

function joinedArtists(common, languageHints = null) {
  if (Array.isArray(common.artists)) {
    const artists = common.artists.map(artist => stringOrEmpty(artist, languageHints)).filter(Boolean);
    if (artists.length > 0) return artists.join('; ');
  }
  return stringOrEmpty(common.artist, languageHints);
}

function getSortText(common, names, languageHints = null) {
  for (const name of names) {
    const value = stringOrEmpty(common[name], languageHints);
    if (value) return value;
  }
  return '';
}

function selectPicture(pictures) {
  if (!Array.isArray(pictures) || pictures.length === 0) return null;
  for (const picture of pictures) {
    const descriptor = `${picture.type || ''} ${picture.description || ''}`.toLowerCase();
    if (descriptor.includes('front')) return picture;
  }
  return pictures[0];
}
