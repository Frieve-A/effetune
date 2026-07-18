import { sha256Hex } from '../repository/sha256.js';

export const CUE_FRAMES_PER_SECOND = 75;
export const CUE_MAX_BYTES = 1024 * 1024;
export const CUE_MAX_TEXT_CHARACTERS = 4096;
export const CUE_MAX_RELATIVE_PATH_CHARACTERS = 32768;

const CUE_AUDIO_EXTENSIONS = new Set(['wav', 'flac']);
const IGNORED_COMMANDS = new Set([
  'CATALOG', 'CDTEXTFILE', 'FLAGS', 'ISRC', 'POSTGAP', 'PREGAP', 'SONGWRITER'
]);

export function decodeCueBytes(value) {
  const bytes = toBytes(value);
  if (bytes.byteLength > CUE_MAX_BYTES) return invalid('cue-too-large');
  if (bytes.byteLength === 0) return invalid('cue-empty');
  try {
    return Object.freeze({ ok: true, text: decodeCueText(bytes) });
  } catch {
    return invalid('cue-decode-failed');
  }
}

export function parseCueSheet(text, { cueRelativePath = '' } = {}) {
  const cuePath = normalizeStoredPath(cueRelativePath);
  if (!cuePath || cuePath.length > CUE_MAX_RELATIVE_PATH_CHARACTERS) return invalid('cue-invalid-path');
  if (typeof text !== 'string' || text.length === 0) return invalid('cue-empty');

  const disc = { title: '', performer: '', date: '', genre: '' };
  const files = [];
  const tracks = [];
  let currentFile = null;
  let currentTrack = null;
  let lastAudioTrackNo = 0;
  try {
    for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const commandMatch = /^([A-Za-z]+)(?:\s+(.*))?$/.exec(line);
      if (!commandMatch) throw cueError('cue-invalid-syntax');
      const command = commandMatch[1].toUpperCase();
      const argument = commandMatch[2] ?? '';
      if (command === 'REM') {
        const rem = /^([A-Za-z]+)(?:\s+(.*))?$/.exec(argument);
        if (!rem) continue;
        const key = rem[1].toUpperCase();
        if (!currentTrack && key === 'DATE') disc.date = parseText(rem[2] ?? '');
        else if (!currentTrack && key === 'GENRE') disc.genre = parseText(rem[2] ?? '');
        continue;
      }
      if (command === 'FILE') {
        const fileMatch = /^("(?:[^"\\]|\\.)*"|\S+)\s+\S+$/.exec(argument);
        if (!fileMatch) throw cueError('cue-invalid-file');
        const reference = parseText(fileMatch[1]);
        if (!isSafeCueFileReference(reference)) throw cueError('cue-unsafe-file');
        currentFile = { reference, tracks: [], resolvedRelativePath: null };
        files.push(currentFile);
        currentTrack = null;
        continue;
      }
      if (command === 'TRACK') {
        const trackMatch = /^(\d{1,2})\s+(\S+)$/.exec(argument);
        if (!trackMatch || !currentFile) throw cueError('cue-invalid-track');
        const trackNo = Number(trackMatch[1]);
        const audio = trackMatch[2].toUpperCase() === 'AUDIO';
        currentTrack = { trackNo, audio, title: '', performer: '', indexes: new Map(), file: currentFile };
        currentFile.tracks.push(currentTrack);
        if (!audio) continue;
        if (trackNo < 1 || trackNo > 99 || trackNo <= lastAudioTrackNo) {
          throw cueError('cue-invalid-track-order');
        }
        lastAudioTrackNo = trackNo;
        tracks.push(currentTrack);
        if (tracks.length > 99) throw cueError('cue-too-many-tracks');
        continue;
      }
      if (command === 'INDEX') {
        const indexMatch = /^(\d{1,2})\s+(\d+):(\d{2}):(\d{2})$/.exec(argument);
        if (!indexMatch || !currentTrack) throw cueError('cue-invalid-index');
        const indexNo = Number(indexMatch[1]);
        const frame = cueTimeToFrame(indexMatch[2], indexMatch[3], indexMatch[4]);
        if (currentTrack.indexes.has(indexNo)) throw cueError('cue-duplicate-index');
        currentTrack.indexes.set(indexNo, frame);
        continue;
      }
      if (command === 'TITLE' || command === 'PERFORMER') {
        const value = parseText(argument, { ellipsize: command === 'TITLE' });
        if (currentTrack) currentTrack[command === 'TITLE' ? 'title' : 'performer'] = value;
        else disc[command === 'TITLE' ? 'title' : 'performer'] = value;
        continue;
      }
      if (!IGNORED_COMMANDS.has(command)) throw cueError('cue-unsupported-command');
    }
    validateParsedTracks(tracks);
  } catch (error) {
    return invalid(error?.code ?? 'cue-invalid-syntax');
  }

  if (tracks.length === 0) return invalid('cue-no-audio-tracks', { unsupported: true });
  return Object.freeze({
    ok: true,
    cueRelativePath: cuePath,
    disc: Object.freeze({ ...disc }),
    files: Object.freeze(files.map(file => Object.freeze({
      reference: file.reference,
      audioTrackCount: file.tracks.filter(track => track.audio).length
    }))),
    tracks: Object.freeze(tracks.map(track => Object.freeze({
      trackNo: track.trackNo,
      title: track.title,
      performer: track.performer,
      fileReference: track.file.reference,
      index00: track.indexes.get(0) ?? null,
      startFrame: track.indexes.get(1)
    })))
  });
}

export function resolveCueSheet(parsed, availableRelativePaths) {
  if (!parsed?.ok) return parsed;
  const cueDirectory = parentPath(parsed.cueRelativePath);
  const available = [...availableRelativePaths].map(normalizeStoredPath);
  const directFiles = available.filter(path => parentPath(path) === cueDirectory && isCueAudioPath(path));
  const resolutions = new Map();
  for (const file of parsed.files) {
    if (file.audioTrackCount === 0 || !isCueAudioPath(file.reference)) continue;
    const exactName = file.reference.normalize('NFC');
    const exact = directFiles.filter(path => baseName(path).normalize('NFC') === exactName);
    let resolved = exact.length === 1 ? exact[0] : null;
    if (exact.length > 1) return invalid('cue-ambiguous-reference');
    if (!resolved) {
      const folded = exactName.toLowerCase();
      const compatible = directFiles.filter(path => baseName(path).normalize('NFC').toLowerCase() === folded);
      if (compatible.length !== 1) {
        return invalid(compatible.length > 1 ? 'cue-ambiguous-reference' : 'cue-missing-reference');
      }
      resolved = compatible[0];
    }
    resolutions.set(file.reference, resolved);
  }

  const resolvedTracks = parsed.tracks.map(track => ({
    ...track,
    relativePath: resolutions.get(track.fileReference) ?? null,
    endFrame: null
  }));
  if (resolvedTracks.some(track => !track.relativePath)) return invalid('cue-unsupported-source');
  const lastStartBySource = new Map();
  for (const track of resolvedTracks) {
    const previous = lastStartBySource.get(track.relativePath);
    if (previous !== undefined && track.startFrame <= previous) return invalid('cue-invalid-index-order');
    lastStartBySource.set(track.relativePath, track.startFrame);
  }
  for (let index = 0; index < resolvedTracks.length; index += 1) {
    const track = resolvedTracks[index];
    const next = resolvedTracks.slice(index + 1).find(item => item.relativePath === track.relativePath);
    if (next) track.endFrame = next.startFrame;
  }
  return Object.freeze({
    ...parsed,
    resolvedFiles: Object.freeze([...new Set(resolvedTracks.map(track => track.relativePath))]),
    tracks: Object.freeze(resolvedTracks.map(track => Object.freeze({
      ...track,
      entryKey: createCueEntryKey(parsed.cueRelativePath, track.trackNo),
      logicalStorageId: createCueEntryKey(parsed.cueRelativePath, track.trackNo)
    })))
  });
}

export function validateCueDurations(resolvedCue, physicalMetadataByPath) {
  if (!resolvedCue?.ok) return resolvedCue;
  const tracks = [];
  for (const track of resolvedCue.tracks) {
    const physical = physicalMetadataByPath.get(track.relativePath);
    const durationSec = Number(physical?.durationSec);
    if (!Number.isFinite(durationSec) || durationSec <= 0) return invalid('cue-source-duration-unavailable');
    if (track.startFrame / CUE_FRAMES_PER_SECOND >= durationSec) return invalid('cue-index-out-of-range');
    if (track.endFrame !== null && track.endFrame / CUE_FRAMES_PER_SECOND > durationSec) {
      return invalid('cue-index-out-of-range');
    }
    const logicalDurationSec = track.endFrame === null
      ? durationSec - track.startFrame / CUE_FRAMES_PER_SECOND
      : (track.endFrame - track.startFrame) / CUE_FRAMES_PER_SECOND;
    tracks.push(Object.freeze({ ...track, durationSec: logicalDurationSec }));
  }
  return Object.freeze({ ...resolvedCue, tracks: Object.freeze(tracks) });
}

export function createCueTrackMetadata(cue, track, physicalMetadata = {}) {
  const artist = track.performer || cue.disc.performer || bounded(physicalMetadata.artist);
  const album = cue.disc.title || bounded(physicalMetadata.album) || stripExtension(baseName(cue.cueRelativePath));
  const albumArtist = cue.disc.performer || bounded(physicalMetadata.albumArtist) || artist;
  const albumArtists = cue.disc.performer
    ? splitArtistValues([cue.disc.performer])
    : splitArtistValues(
        Array.isArray(physicalMetadata.albumArtists) && physicalMetadata.albumArtists.length > 0
          ? physicalMetadata.albumArtists
          : [albumArtist]
      );
  return Object.freeze({
    title: track.title || `Track ${String(track.trackNo).padStart(2, '0')}`,
    artist,
    albumArtist,
    albumArtists,
    album,
    genre: cue.disc.genre || bounded(physicalMetadata.genre),
    year: cueYear(cue.disc.date, physicalMetadata.year),
    compilation: Boolean(physicalMetadata.compilation),
    discNo: null,
    discTotal: null,
    trackNo: track.trackNo,
    trackTotal: cue.tracks.length,
    durationSec: track.durationSec,
    sampleRate: integerOrNull(physicalMetadata.sampleRate),
    bitrate: integerOrNull(physicalMetadata.bitrate),
    bitsPerSample: integerOrNull(physicalMetadata.bitsPerSample),
    channels: integerOrNull(physicalMetadata.channels),
    codec: bounded(physicalMetadata.codec, 512) || null
  });
}

export function createPlainLogicalStorageId(relativePath) {
  return `file:${normalizeStoredPath(relativePath)}`;
}

export function createCueEntryKey(cueRelativePath, audioTrackNo) {
  const path = normalizeStoredPath(cueRelativePath);
  const trackNo = Number(audioTrackNo);
  if (!path || !Number.isSafeInteger(trackNo) || trackNo < 1 || trackNo > 99) {
    throw new TypeError('Invalid CUE entry identity');
  }
  return `cue:${path}#${trackNo}`;
}

export function createCueSignature({ size, mtimeMs, bytes }) {
  const byteArray = toBytes(bytes);
  const stat = `${Number(size)}:${Number(mtimeMs)}:`;
  return `cue-v1:${sha256Hex(concatBytes(new TextEncoder().encode(stat), byteArray))}`;
}

export function cueFrameToSeconds(frame) {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new TypeError('CUE frame must be a non-negative safe integer');
  return frame / CUE_FRAMES_PER_SECOND;
}

function validateParsedTracks(tracks) {
  const startsByFile = new Map();
  for (const track of tracks) {
    if (!track.indexes.has(1)) throw cueError('cue-missing-index-01');
    const index00 = track.indexes.get(0);
    const index01 = track.indexes.get(1);
    if (index00 !== undefined && index00 > index01) throw cueError('cue-invalid-index-order');
    const previous = startsByFile.get(track.file);
    if (previous !== undefined && index01 <= previous) throw cueError('cue-invalid-index-order');
    startsByFile.set(track.file, index01);
  }
}

function cueTimeToFrame(minutesValue, secondsValue, framesValue) {
  const minutes = Number(minutesValue);
  const seconds = Number(secondsValue);
  const frames = Number(framesValue);
  if (!Number.isSafeInteger(minutes) || minutes < 0 || seconds < 0 || seconds >= 60 || frames < 0 || frames >= 75) {
    throw cueError('cue-invalid-index-time');
  }
  const total = (minutes * 60 + seconds) * 75 + frames;
  if (!Number.isSafeInteger(total)) throw cueError('cue-invalid-index-time');
  return total;
}

function parseText(value, { ellipsize = false } = {}) {
  const trimmed = String(value).trim();
  let result = trimmed;
  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"') || trimmed.length < 2) throw cueError('cue-invalid-text');
    result = trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (/[\0\r\n]/.test(result)) throw cueError('cue-text-too-long');
  if (result.length > CUE_MAX_TEXT_CHARACTERS) {
    if (!ellipsize) throw cueError('cue-text-too-long');
    const prefixLength = CUE_MAX_TEXT_CHARACTERS - 3;
    const endsWithHighSurrogate = /[\uD800-\uDBFF]/.test(result[prefixLength - 1]);
    return `${result.slice(0, prefixLength - (endsWithHighSurrogate ? 1 : 0))}...`;
  }
  return result;
}

function decodeCueText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes.subarray(2), true);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes.subarray(2), false);
  const utf8Bytes = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(utf8Bytes);
  } catch {
    for (const encoding of ['shift_jis', 'windows-31j']) {
      try {
        return new TextDecoder(encoding, { fatal: true }).decode(bytes);
      } catch {
        // Try the next CP932-compatible label.
      }
    }
    throw new TypeError('CUE text encoding is unsupported');
  }
}

function decodeUtf16(bytes, littleEndian) {
  if (bytes.byteLength % 2 !== 0) throw new TypeError('Invalid UTF-16 byte length');
  const characters = new Uint16Array(bytes.byteLength / 2);
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    characters[offset / 2] = littleEndian
      ? bytes[offset] | (bytes[offset + 1] << 8)
      : (bytes[offset] << 8) | bytes[offset + 1];
  }
  const chunks = [];
  for (let offset = 0; offset < characters.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...characters.subarray(offset, offset + 0x8000)));
  }
  return chunks.join('');
}

function isSafeCueFileReference(reference) {
  if (!reference || reference.length > CUE_MAX_RELATIVE_PATH_CHARACTERS) return false;
  if (/^(?:[A-Za-z]:|[\\/])/.test(reference) || reference.includes('/') || reference.includes('\\')) return false;
  return reference !== '.' && reference !== '..';
}

function isCueAudioPath(path) {
  const extension = baseName(path).split('.').at(-1)?.toLowerCase() ?? '';
  return CUE_AUDIO_EXTENSIONS.has(extension);
}

function normalizeStoredPath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean).join('/');
}

function parentPath(value) {
  const parts = normalizeStoredPath(value).split('/');
  parts.pop();
  return parts.join('/');
}

function baseName(value) {
  return normalizeStoredPath(value).split('/').at(-1) ?? '';
}

function stripExtension(value) {
  const dot = value.lastIndexOf('.');
  return dot > 0 ? value.slice(0, dot) : value;
}

function bounded(value, maximum = CUE_MAX_TEXT_CHARACTERS) {
  return value == null ? '' : String(value).slice(0, maximum);
}

function splitArtistValues(values) {
  return [...new Set(values
    .flatMap(value => bounded(value).split(';'))
    .map(value => value.trim())
    .filter(Boolean))];
}

function cueYear(date, embeddedYear) {
  const match = /^(\d{4})/.exec(String(date ?? '').trim());
  if (match) return Number(match[1]);
  return Number.isSafeInteger(embeddedYear) ? embeddedYear : null;
}

function integerOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function invalid(code, extra = {}) {
  return Object.freeze({ ok: false, code, retryable: extra.retryable === true, unsupported: extra.unsupported === true });
}

function cueError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('CUE content must be binary data');
}

function concatBytes(left, right) {
  const bytes = new Uint8Array(left.byteLength + right.byteLength);
  bytes.set(left);
  bytes.set(right, left.byteLength);
  return bytes;
}
