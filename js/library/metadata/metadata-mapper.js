import { createFallbackDisplayName, getFileExtension, stripExtension } from '../constants.js';
import { decodeLegacyMetadataBytes, repairLegacyMetadataMojibake } from './text-encoding.js';

const RIFF_INFO_NATIVE_TAG_TYPE = 'riff-info';
const NATIVE_TAG_PRIORITY = ['matroska', 'vorbis', 'ID3v2.4', 'ID3v2.3', 'ID3v2.2', 'iTunes', 'asf', 'AIFF', 'APEv2', RIFF_INFO_NATIVE_TAG_TYPE, 'exif', 'ID3v1'];
const LOW_PRIORITY_TEXT_NATIVE_TAG_TYPES = new Set(['ID3v1']);
const TITLE_NATIVE_IDS = new Set(['TITLE', 'TIT2', 'TT2', 'INAM', 'TITL', '\u00A9NAM', 'WM/TITLE']);
const ARTIST_NATIVE_IDS = new Set(['ARTIST', 'ARTISTS', 'TPE1', 'TP1', 'IART', '\u00A9ART', 'AUTHOR', 'WM/AUTHOR']);
const ALBUM_ARTIST_NATIVE_IDS = new Set(['ALBUMARTIST', 'ALBUM ARTIST', 'ALBUM_ARTIST', 'ALBUMARTISTS', 'TPE2', 'TP2', 'AART', 'WM/ALBUMARTIST']);
const ALBUM_NATIVE_IDS = new Set(['ALBUM', 'TALB', 'TAL', 'IPRD', 'IRPD', '\u00A9ALB', 'WM/ALBUMTITLE']);
const GENRE_NATIVE_IDS = new Set(['GENRE', 'TCON', 'TCO', 'IGNR', '\u00A9GEN', 'WM/GENRE']);
const YEAR_NATIVE_IDS = new Set(['DATE', 'YEAR', 'ORIGINALDATE', 'ORIGINALYEAR', 'TDRC', 'TYER', 'TYE', 'TDAT', 'TORY', 'TDOR', 'TDRL', 'ICRD', '\u00A9DAY', 'WM/YEAR', 'WM/ORIGINALRELEASEYEAR']);
const TITLE_SORT_NATIVE_IDS = new Set(['TITLESORT', 'TITLE SORT', 'TITLE_SORT', 'SORTTITLE', 'SORT TITLE', 'TSOT', 'SONM']);
const ALBUM_SORT_NATIVE_IDS = new Set(['ALBUMSORT', 'ALBUM SORT', 'ALBUM_SORT', 'SORTALBUM', 'SORT ALBUM', 'TSOA', 'SOAL']);
const ALBUM_ARTIST_SORT_NATIVE_IDS = new Set(['ALBUMARTISTSORT', 'ALBUM ARTIST SORT', 'ALBUM_ARTIST_SORT', 'SORTALBUMARTIST', 'SORT ALBUM ARTIST', 'TSO2', 'SOAA']);
const COMPILATION_NATIVE_IDS = new Set(['COMPILATION', 'TCMP', 'TCP', 'CPIL', 'ITUNESCOMPILATION', 'WM/ISCOMPILATION']);
const TRACK_NATIVE_IDS = new Set(['PART_NUMBER', 'TRACK', 'TRACKNUMBER', 'TRCK', 'TRK', 'ITRK', 'IPRT', 'TRKN']);
const DISC_NATIVE_IDS = new Set(['TOTAL_PARTS', 'DISC', 'DISK', 'DISCNUMBER', 'DISKNUMBER', 'TPOS', 'TPA', 'DISKNUMBER']);

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
    albumArtists: [],
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

export function createTrackFromMetadata(candidate, metadata, now = Date.now(), { languageHints = null, riffInfoTags = null } = {}) {
  const fallback = createFallbackTrack(candidate, now);
  const baseTextHints = createMetadataRepairHints(languageHints, candidate, metadata);
  const mappedMetadata = withRiffInfoTags(metadata, riffInfoTags, baseTextHints);
  const common = mappedMetadata?.common || {};
  const format = mappedMetadata?.format || {};
  const commonTitle = stringOrEmpty(common.title, baseTextHints);
  const title = getMetadataText(mappedMetadata, TITLE_NATIVE_IDS, commonTitle, baseTextHints) || fallback.title;
  const textHints = addRepairReferenceTexts(baseTextHints, [title]);
  const commonArtist = joinedArtists(common, textHints);
  const artist = getMetadataText(mappedMetadata, ARTIST_NATIVE_IDS, commonArtist, textHints, { join: true });
  const commonAlbumArtists = textValues(common.albumartists, textHints);
  const commonAlbumArtist = stringOrEmpty(common.albumartist, textHints) || joinTextValues(commonAlbumArtists);
  const albumArtistSelection = selectMetadataText(
    mappedMetadata,
    ALBUM_ARTIST_NATIVE_IDS,
    commonAlbumArtist,
    textHints,
    { join: true, commonValues: commonAlbumArtists }
  );
  const albumArtist = albumArtistSelection.value || artist || '';
  const albumArtists = splitArtistValues(
    albumArtistSelection.values.length > 0 ? albumArtistSelection.values : [albumArtist]
  );
  const commonGenre = firstArrayString(common.genre, textHints) || stringOrEmpty(common.genre, textHints);
  const genre = getMetadataText(mappedMetadata, GENRE_NATIVE_IDS, commonGenre, textHints, { rejectNative: looksLikeId3GenreCode });
  const lowerAlbumArtist = albumArtist.toLowerCase();
  const picture = selectPicture(common.picture);
  const pictureBytes = toArrayBuffer(picture?.data);
  const trackNumber = getMetadataNumberPair(mappedMetadata, 'track', TRACK_NATIVE_IDS, textHints);
  const discNumber = getMetadataNumberPair(mappedMetadata, 'disk', DISC_NATIVE_IDS, textHints);
  const compilation = getMetadataBoolean(mappedMetadata, COMPILATION_NATIVE_IDS, common.compilation) === true ||
    lowerAlbumArtist === 'various artists';

  return {
    ...fallback,
    title,
    artist,
    albumArtist,
    albumArtists,
    album: getMetadataText(mappedMetadata, ALBUM_NATIVE_IDS, stringOrEmpty(common.album, textHints), textHints),
    genre,
    year: getMetadataYear(mappedMetadata, common.year, textHints),
    trackNo: trackNumber.value,
    trackOf: trackNumber.total,
    discNo: discNumber.value,
    discOf: discNumber.total,
    compilation,
    sortTitle: getMetadataText(mappedMetadata, TITLE_SORT_NATIVE_IDS, getSortText(common, ['titlesort', 'titleSort', 'sorttitle'], textHints), textHints),
    sortAlbum: getMetadataText(mappedMetadata, ALBUM_SORT_NATIVE_IDS, getSortText(common, ['albumsort', 'albumSort', 'sortalbum'], textHints), textHints),
    sortAlbumArtist: getMetadataText(mappedMetadata, ALBUM_ARTIST_SORT_NATIVE_IDS, getSortText(common, ['albumartistsort', 'albumArtistSort', 'sortalbumartist'], textHints), textHints),
    durationSec: numberOrNull(format.duration),
    sampleRate: numberOrNull(format.sampleRate),
    bitrate: numberOrNull(format.bitrate),
    bitsPerSample: numberOrNull(format.bitsPerSample),
    channels: numberOrNull(format.numberOfChannels),
    codec: stringOrEmpty(format.codec, textHints) || stringOrEmpty(format.dataformat, textHints).toUpperCase() || fallback.codec,
    artworkBytes: pictureBytes,
    artworkMime: pictureBytes ? stringOrEmpty(picture.format, textHints) || 'application/octet-stream' : null,
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
  if (typeof value === 'string') return repairAndTrimMetadataText(value, languageHints);
  if (value === null || value === undefined) return '';
  return repairAndTrimMetadataText(String(value), languageHints);
}

function repairAndTrimMetadataText(value, languageHints = null) {
  return repairLegacyMetadataMojibake(String(value), languageHints).trim();
}

function createMetadataRepairHints(languageHints, candidate = {}, metadata = {}) {
  return addRepairReferenceTexts(languageHints, [
    candidate.fileName,
    candidate.relativePath,
    candidate.path,
    metadata?.common?.title
  ]);
}

function addRepairReferenceTexts(languageHints, referenceTexts) {
  const cleanReferences = referenceTexts
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean);
  if (!cleanReferences.length) return languageHints;

  const base = typeof languageHints === 'string'
    ? { language: languageHints }
    : { ...(languageHints || {}) };
  const existingReferences = Array.isArray(base.referenceTexts) ? base.referenceTexts : [];
  return {
    ...base,
    referenceTexts: [...existingReferences, ...cleanReferences]
  };
}

function withRiffInfoTags(metadata, riffInfoTags, languageHints = null) {
  const nativeTags = normalizeRiffInfoTags(riffInfoTags, languageHints);
  if (!nativeTags.length) return metadata || {};
  const native = { ...(metadata?.native || {}) };
  const existing = Array.isArray(native[RIFF_INFO_NATIVE_TAG_TYPE]) ? native[RIFF_INFO_NATIVE_TAG_TYPE] : [];
  native[RIFF_INFO_NATIVE_TAG_TYPE] = [...nativeTags, ...existing];
  return {
    ...(metadata || {}),
    native
  };
}

function normalizeRiffInfoTags(riffInfoTags, languageHints = null) {
  if (!Array.isArray(riffInfoTags)) return [];
  const tags = [];
  for (const tag of riffInfoTags) {
    const id = normalizeNativeId(tag?.id);
    if (!id) continue;
    const value = decodeRiffInfoTagValue(tag, languageHints);
    if (!value) continue;
    tags.push({ id, value });
  }
  return tags;
}

function decodeRiffInfoTagValue(tag, languageHints = null) {
  if (typeof tag?.value === 'string') return repairAndTrimMetadataText(tag.value, languageHints);
  const bytes = tag?.data ?? tag?.bytes ?? tag?.value;
  return decodeLegacyMetadataBytes(bytes, languageHints);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function integerOrNull(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const number = integerOrNull(item);
      if (number !== null) return number;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    return integerOrNull(value.no ?? value.value ?? value.total ?? value.of);
  }
  const text = normalizeNumericText(stringOrEmpty(value));
  const match = text.match(/\d+/);
  if (!match) return null;
  const number = Number.parseInt(match[0], 10);
  return Number.isSafeInteger(number) ? number : null;
}

export function parseNumberPair(value, languageHints = null) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseNumberPair(item, languageHints);
      if (parsed.value !== null || parsed.total !== null) return parsed;
    }
    return { value: null, total: null, hasExplicitTotal: false };
  }
  if (value && typeof value === 'object') {
    const valuePair = parseNumberPair(value.no ?? value.value ?? value.track ?? value.trackNo, languageHints);
    const total = integerOrNull(value.of ?? value.total ?? value.trackOf);
    return {
      value: valuePair.value,
      total: total ?? valuePair.total,
      hasExplicitTotal: total !== null || valuePair.hasExplicitTotal
    };
  }

  const text = normalizeNumericText(stringOrEmpty(value, languageHints))
    .replace(/[\u2044\u2215\uFF0F\\]/g, '/')
    .replace(/\bof\b/gi, '/')
    .trim();
  if (!text) return { value: null, total: null, hasExplicitTotal: false };

  const hasExplicitTotal = text.includes('/');
  const [valueText, totalText] = text.split('/', 2);
  return {
    value: integerOrNull(valueText),
    total: totalText === undefined ? null : integerOrNull(totalText),
    hasExplicitTotal
  };
}

function normalizeNumericText(value) {
  return String(value || '').replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\uFF10-\uFF19]/g, char => {
    const code = char.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    if (code >= 0x0966 && code <= 0x096f) return String(code - 0x0966);
    return String(code - 0xff10);
  });
}

function getMetadataText(metadata, nativeIds, commonText, languageHints = null, { join = false, rejectNative = null } = {}) {
  return selectMetadataText(metadata, nativeIds, commonText, languageHints, { join, rejectNative }).value;
}

function selectMetadataText(
  metadata,
  nativeIds,
  commonText,
  languageHints = null,
  { join = false, rejectNative = null, commonValues = [] } = {}
) {
  const commonValue = stringOrEmpty(commonText, languageHints);
  const nativeText = getNativeText(metadata, nativeIds, languageHints, { join });
  if (nativeText.value &&
    (commonValue === '' || !LOW_PRIORITY_TEXT_NATIVE_TAG_TYPES.has(nativeText.tagType)) &&
    !(commonValue && rejectNative?.(nativeText.value))) {
    return nativeText;
  }
  if (commonValue) {
    return {
      value: commonValue,
      values: uniqueTextValues(commonValues.length > 0 ? commonValues : [commonValue]),
      tagType: ''
    };
  }
  return nativeText;
}

function looksLikeId3GenreCode(value) {
  return /^\(?\d{1,3}\)?$/.test(String(value || '').trim());
}

function getNativeText(metadata, nativeIds, languageHints = null, { join = false } = {}) {
  const native = metadata?.native || {};
  for (const tagType of getNativeTagTypes(native)) {
    const values = [];
    for (const tag of native[tagType] || []) {
      if (!hasNativeId(nativeIds, tag?.id)) continue;
      values.push(...textValues(tag.value, languageHints));
    }
    if (values.length > 0) {
      const uniqueValues = uniqueTextValues(values);
      return {
        value: join ? uniqueValues.join('; ') : uniqueValues[0],
        values: uniqueValues,
        tagType
      };
    }
  }
  return { value: '', values: [], tagType: '' };
}

function textValues(value, languageHints = null) {
  if (Array.isArray(value)) return value.flatMap(item => textValues(item, languageHints));
  if (value && typeof value === 'object') {
    return textValues(value.text ?? value.value ?? value.name ?? value.description, languageHints);
  }
  const text = stringOrEmpty(value, languageHints);
  return text ? [text] : [];
}

function joinTextValues(values) {
  return uniqueTextValues(values).join('; ');
}

function uniqueTextValues(values) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function splitArtistValues(values) {
  return uniqueTextValues(values.flatMap(value => String(value).split(';')));
}

function getMetadataYear(metadata, commonYear, languageHints = null) {
  const commonValue = integerOrNull(commonYear);
  const nativeYear = getNativeYear(metadata, languageHints);
  if (nativeYear.value !== null &&
    (commonValue === null || (nativeYear.value >= 1000 && !LOW_PRIORITY_TEXT_NATIVE_TAG_TYPES.has(nativeYear.tagType)))) {
    return nativeYear.value;
  }
  return commonValue ?? nativeYear.value;
}

function getNativeYear(metadata, languageHints = null) {
  const native = metadata?.native || {};
  for (const tagType of getNativeTagTypes(native)) {
    for (const tag of native[tagType] || []) {
      if (!hasNativeId(YEAR_NATIVE_IDS, tag?.id)) continue;
      const value = yearOrNull(tag.value, languageHints);
      if (value !== null) return { value, tagType };
    }
  }
  return { value: null, tagType: '' };
}

function yearOrNull(value, languageHints = null) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const year = yearOrNull(item, languageHints);
      if (year !== null) return year;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    return yearOrNull(value.year ?? value.text ?? value.value ?? value.date, languageHints);
  }
  const text = normalizeNumericText(stringOrEmpty(value, languageHints));
  const match = text.match(/(?:^|\D)([12]\d{3})(?:\D|$)/);
  return match ? Number.parseInt(match[1], 10) : integerOrNull(value);
}

function getMetadataBoolean(metadata, nativeIds, commonValue) {
  const nativeValue = getNativeBoolean(metadata, nativeIds);
  if (nativeValue !== null) return nativeValue;
  return commonValue === true ? true : commonValue === false ? false : null;
}

function getNativeBoolean(metadata, nativeIds) {
  const native = metadata?.native || {};
  for (const tagType of getNativeTagTypes(native)) {
    for (const tag of native[tagType] || []) {
      if (!hasNativeId(nativeIds, tag?.id)) continue;
      const value = booleanOrNull(tag.value);
      if (value !== null) return value;
    }
  }
  return null;
}

function booleanOrNull(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = booleanOrNull(item);
      if (parsed !== null) return parsed;
    }
    return null;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : null;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes') return true;
  if (text === '0' || text === 'false' || text === 'no') return false;
  return null;
}

function getMetadataNumberPair(metadata, commonKey, nativeIds, languageHints = null) {
  const common = metadata?.common || {};
  const commonPair = parseNumberPair(common[commonKey], languageHints);
  const nativePair = getNativeNumberPair(metadata, nativeIds, languageHints);
  if (nativePair.value !== null) {
    return {
      value: nativePair.value,
      total: nativePair.total ?? commonPair.total,
      hasExplicitTotal: nativePair.hasExplicitTotal || commonPair.hasExplicitTotal
    };
  }
  if (commonPair.value !== null || commonPair.total !== null) {
    return {
      value: commonPair.value,
      total: commonPair.total ?? nativePair.total,
      hasExplicitTotal: commonPair.hasExplicitTotal || nativePair.hasExplicitTotal
    };
  }
  return nativePair;
}

function getNativeNumberPair(metadata, nativeIds, languageHints = null) {
  const native = metadata?.native || {};
  for (const tagType of getNativeTagTypes(native)) {
    for (const tag of native[tagType] || []) {
      if (!hasNativeId(nativeIds, tag?.id)) continue;
      const parsed = parseNumberPair(tag.value, languageHints);
      if (parsed.value !== null || parsed.total !== null) return parsed;
    }
  }
  return { value: null, total: null, hasExplicitTotal: false };
}

function getNativeTagTypes(native) {
  const known = NATIVE_TAG_PRIORITY.filter(tagType => Array.isArray(native[tagType]));
  const rest = Object.keys(native).filter(tagType => !known.includes(tagType));
  return [...known, ...rest];
}

function hasNativeId(nativeIds, id) {
  return nativeIds.has(normalizeNativeId(id));
}

function normalizeNativeId(id) {
  return String(id || '').trim().replace(/\s+/g, ' ').toUpperCase();
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
