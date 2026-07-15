const EXTINF_PATTERN = /^#EXTINF\s*:\s*([^,]*),(.*)$/i;
const XML_ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;

export const PLAYLIST_COMPATIBILITY_LIMITS = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxTextChars: 16 * 1024 * 1024,
  maxItems: 100000
});

export class PlaylistCompatibilityLimitError extends Error {
  constructor(kind, limit, actual) {
    super(`Synchronous playlist ${kind} exceeds the ${limit} compatibility limit (${actual}).`);
    this.name = 'PlaylistCompatibilityLimitError';
    this.code = 'PLAYLIST_COMPATIBILITY_LIMIT';
    this.kind = kind;
    this.limit = limit;
    this.actual = actual;
  }
}

function assertTextLimit(value) {
  const text = String(value ?? '');
  if (text.length > PLAYLIST_COMPATIBILITY_LIMITS.maxTextChars) {
    throw new PlaylistCompatibilityLimitError(
      'text characters',
      PLAYLIST_COMPATIBILITY_LIMITS.maxTextChars,
      text.length
    );
  }
  return text;
}

function* limitedEntries(entries) {
  let count = 0;
  for (const entry of entries ?? []) {
    count += 1;
    if (count > PLAYLIST_COMPATIBILITY_LIMITS.maxItems) {
      throw new PlaylistCompatibilityLimitError('items', PLAYLIST_COMPATIBILITY_LIMITS.maxItems, count);
    }
    yield entry;
  }
}

function assertItemCount(count) {
  if (count > PLAYLIST_COMPATIBILITY_LIMITS.maxItems) {
    throw new PlaylistCompatibilityLimitError('items', PLAYLIST_COMPATIBILITY_LIMITS.maxItems, count);
  }
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('Expected ArrayBuffer or typed array input.');
}

function decodeWith(label, bytes, fatal = false) {
  if (typeof TextDecoder === 'undefined') {
    throw new Error('TextDecoder is required to decode playlist bytes.');
  }
  return new TextDecoder(label, { fatal }).decode(bytes);
}

function stripTextBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeExtension(value = '') {
  const text = String(value).toLowerCase();
  const match = text.match(/\.?([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function decodeBom(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', text: decodeWith('utf-8', bytes.subarray(3), true) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', text: decodeWith('utf-16le', bytes.subarray(2), true) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', text: decodeWith('utf-16be', bytes.subarray(2), true) };
  }
  return null;
}

export function decodePlaylistBytes(input, options = {}) {
  const bytes = toUint8Array(input);
  if (bytes.byteLength > PLAYLIST_COMPATIBILITY_LIMITS.maxBytes) {
    throw new PlaylistCompatibilityLimitError(
      'bytes',
      PLAYLIST_COMPATIBILITY_LIMITS.maxBytes,
      bytes.byteLength
    );
  }
  const extension = normalizeExtension(options.extension ?? options.fileName ?? options.name);
  const bomResult = decodeBom(bytes);

  if (bomResult) {
    return { ...bomResult, text: stripTextBom(bomResult.text) };
  }

  if (extension === 'm3u8') {
    return { encoding: 'utf-8', text: stripTextBom(decodeWith('utf-8', bytes, true)) };
  }

  try {
    return { encoding: 'utf-8', text: stripTextBom(decodeWith('utf-8', bytes, true)) };
  } catch {
    // Continue through the legacy playlist fallback chain.
  }

  try {
    return { encoding: 'shift_jis', text: stripTextBom(decodeWith('shift_jis', bytes, true)) };
  } catch {
    return { encoding: 'latin1', text: stripTextBom(decodeWith('windows-1252', bytes, false)) };
  }
}

function splitLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
}

function parseDurationSec(value) {
  const duration = Number.parseFloat(String(value).trim());
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : undefined;
}

function parseDurationMs(value) {
  const duration = Number.parseFloat(String(value).trim());
  return Number.isFinite(duration) && duration >= 0 ? duration / 1000 : undefined;
}

function assignIfPresent(target, key, value) {
  if (value !== undefined && value !== '') target[key] = value;
}

function parseDisplayLabel(label) {
  const trimmed = String(label ?? '').trim();
  if (!trimmed) return {};

  const separatorIndex = trimmed.indexOf(' - ');
  if (separatorIndex > 0 && separatorIndex < trimmed.length - 3) {
    return {
      artist: trimmed.slice(0, separatorIndex).trim(),
      title: trimmed.slice(separatorIndex + 3).trim()
    };
  }

  return { title: trimmed };
}

function parseExtinf(line) {
  const match = line.match(EXTINF_PATTERN);
  if (!match) return {};

  const entry = parseDisplayLabel(match[2]);
  assignIfPresent(entry, 'durationSec', parseDurationSec(match[1]));
  return entry;
}

export function isFileUri(value) {
  return /^file:\/\//i.test(String(value ?? '').trim());
}

function decodeUriComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function fileUriToPath(value) {
  const text = String(value ?? '').trim();
  if (!isFileUri(text)) return text;

  try {
    const url = new URL(text);
    const host = decodeUriComponentSafe(url.hostname);
    const pathname = decodeUriComponentSafe(url.pathname);

    if (host && host.toLowerCase() !== 'localhost') {
      return `\\\\${host}${pathname.replace(/\//g, '\\')}`;
    }

    if (/^\/[A-Za-z]:/.test(pathname)) {
      return pathname.slice(1).replace(/\//g, '\\');
    }

    if (/^\/\/[^/]/.test(pathname)) {
      return pathname.replace(/\//g, '\\');
    }

    return pathname;
  } catch {
    return decodeUriComponentSafe(text.replace(/^file:\/\//i, ''));
  }
}

export function normalizePlaylistPath(value) {
  const text = String(value ?? '').trim();
  return isFileUri(text) ? fileUriToPath(text) : text;
}

function parseXspfLocation(value) {
  const text = String(value ?? '').trim();
  return isFileUri(text) ? fileUriToPath(text) : decodeUriComponentSafe(text);
}

function sanitizeLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function getEntryPath(entry) {
  return sanitizeLine(
    entry?.path
      ?? entry?.location
      ?? entry?.sourceLine
      ?? entry?.relativePathHint
      ?? entry?.unresolved?.sourceLine
      ?? entry?.unresolved?.relativePathHint
      ?? ''
  );
}

function getEntryTitle(entry) {
  const title = sanitizeLine(entry?.title ?? entry?.unresolved?.title ?? '');
  const artist = sanitizeLine(entry?.artist ?? entry?.creator ?? entry?.unresolved?.artist ?? '');
  if (artist && title) return `${artist} - ${title}`;
  return title || artist;
}

function formatDurationSec(value) {
  const duration = Number.parseFloat(value);
  return Number.isFinite(duration) && duration >= 0 ? String(Math.round(duration)) : '-1';
}

export function parseM3U(text) {
  const entries = [];
  let pendingInfo = null;

  for (const rawLine of splitLines(stripTextBom(assertTextLimit(text)))) {
    const line = rawLine.trim();
    if (!line) continue;

    if (EXTINF_PATTERN.test(line)) {
      pendingInfo = parseExtinf(line);
      continue;
    }

    if (line.startsWith('#')) continue;

    const entry = { path: normalizePlaylistPath(line) };
    if (pendingInfo) Object.assign(entry, pendingInfo);
    entries.push(entry);
    assertItemCount(entries.length);
    pendingInfo = null;
  }

  return { entries };
}

export const parseM3U8 = parseM3U;

export function serializeM3U8(entries) {
  const lines = ['#EXTM3U'];

  for (const entry of limitedEntries(entries)) {
    const path = getEntryPath(entry);
    if (!path) continue;
    lines.push(`#EXTINF:${formatDurationSec(entry?.durationSec ?? entry?.unresolved?.durationSec)},${getEntryTitle(entry)}`);
    lines.push(path);
  }

  return `${lines.join('\n')}\n`;
}

export const serializeM3U = serializeM3U8;

export function parsePLS(text) {
  const byIndex = new Map();

  for (const rawLine of splitLines(stripTextBom(assertTextLimit(text)))) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#') || /^\[.*\]$/.test(line)) continue;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    const match = key.match(/^(file|title|length)(\d+)$/i);
    if (!match) continue;

    const property = match[1].toLowerCase();
    const index = Number.parseInt(match[2], 10);
    if (!byIndex.has(index)) assertItemCount(byIndex.size + 1);
    const record = byIndex.get(index) ?? {};
    if (property === 'file') {
      record.path = normalizePlaylistPath(value);
    } else if (property === 'title') {
      Object.assign(record, parseDisplayLabel(value));
    } else if (property === 'length') {
      assignIfPresent(record, 'durationSec', parseDurationSec(value));
    }
    byIndex.set(index, record);
  }

  const entries = [...byIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, entry]) => entry)
    .filter(entry => entry.path);

  return { entries };
}

export function serializePLS(entries) {
  const usableEntries = [...limitedEntries(entries)].filter(entry => getEntryPath(entry));
  const lines = ['[playlist]'];

  usableEntries.forEach((entry, index) => {
    const plsIndex = index + 1;
    lines.push(`File${plsIndex}=${getEntryPath(entry)}`);
    const title = getEntryTitle(entry);
    if (title) lines.push(`Title${plsIndex}=${title}`);
    lines.push(`Length${plsIndex}=${formatDurationSec(entry?.durationSec ?? entry?.unresolved?.durationSec)}`);
  });

  lines.push(`NumberOfEntries=${usableEntries.length}`);
  lines.push('Version=2');
  return `${lines.join('\n')}\n`;
}

function decodeXmlEntities(value) {
  return String(value ?? '').replace(XML_ENTITY_PATTERN, (entity, body) => {
    const lowerBody = body.toLowerCase();
    if (lowerBody === 'amp') return '&';
    if (lowerBody === 'lt') return '<';
    if (lowerBody === 'gt') return '>';
    if (lowerBody === 'quot') return '"';
    if (lowerBody === 'apos') return "'";

    const codePoint = lowerBody.startsWith('#x')
      ? Number.parseInt(lowerBody.slice(2), 16)
      : Number.parseInt(lowerBody.slice(1), 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
  });
}

function extractXmlChild(block, name) {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`, 'i');
  const match = block.match(pattern);
  return match ? decodeXmlEntities(match[1].trim()) : '';
}

export function parseXSPF(text) {
  const entries = [];
  const source = stripTextBom(assertTextLimit(text));
  const trackPattern = /<(?:[\w.-]+:)?track\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?track>/gi;

  for (const match of source.matchAll(trackPattern)) {
    const block = match[1];
    const location = extractXmlChild(block, 'location');
    if (!location) continue;

    const entry = { path: parseXspfLocation(location) };
    assignIfPresent(entry, 'title', extractXmlChild(block, 'title'));
    assignIfPresent(entry, 'artist', extractXmlChild(block, 'creator'));
    assignIfPresent(entry, 'album', extractXmlChild(block, 'album'));
    assignIfPresent(entry, 'durationSec', parseDurationMs(extractXmlChild(block, 'duration')));
    entries.push(entry);
    assertItemCount(entries.length);
  }

  return { entries };
}

function encodePathSegments(path) {
  return path
    .split('/')
    .map((segment, index) => (index === 0 && segment === '' ? '' : encodeURIComponent(segment)))
    .join('/');
}

function isAbsoluteLocalPath(path) {
  const slashPath = String(path ?? '').trim().replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(slashPath) || slashPath.startsWith('/') || slashPath.startsWith('//');
}

export function pathToFileUri(value) {
  const text = String(value ?? '').trim();
  if (!text || isFileUri(text)) return text;

  const slashPath = text.replace(/\\/g, '/');
  if (/^\/\/[^/]+/.test(slashPath)) {
    const parts = slashPath.slice(2).split('/');
    const host = encodeURIComponent(parts.shift() ?? '');
    return `file://${host}/${parts.map(encodeURIComponent).join('/')}`;
  }

  if (/^[A-Za-z]:\//.test(slashPath)) {
    return `file:///${slashPath.slice(0, 2)}${encodePathSegments(slashPath.slice(2))}`;
  }

  if (slashPath.startsWith('/')) {
    return `file://${encodePathSegments(slashPath)}`;
  }

  return encodePathSegments(slashPath);
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatXspfLocation(path, entry = {}, options = {}) {
  const slashPath = path.replace(/\\/g, '/');
  if (entry?.relative || (options.fileUris === false && !isAbsoluteLocalPath(slashPath))) {
    return encodePathSegments(slashPath);
  }
  return pathToFileUri(path);
}

export function serializeXSPF(entries, options = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<playlist version="1" xmlns="http://xspf.org/ns/0/">',
    '  <trackList>'
  ];

  for (const entry of limitedEntries(entries)) {
    const path = getEntryPath(entry);
    if (!path) continue;
    const title = entry?.title ?? entry?.unresolved?.title;
    const creator = entry?.artist ?? entry?.creator ?? entry?.unresolved?.artist;
    const album = entry?.album ?? entry?.unresolved?.album;
    const durationSec = entry?.durationSec ?? entry?.unresolved?.durationSec;

    lines.push('    <track>');
    lines.push(`      <location>${escapeXml(formatXspfLocation(path, entry, options))}</location>`);
    if (title) lines.push(`      <title>${escapeXml(sanitizeLine(title))}</title>`);
    if (creator) lines.push(`      <creator>${escapeXml(sanitizeLine(creator))}</creator>`);
    if (album) lines.push(`      <album>${escapeXml(sanitizeLine(album))}</album>`);
    if (Number.isFinite(Number.parseFloat(durationSec))) {
      lines.push(`      <duration>${Math.round(Number.parseFloat(durationSec) * 1000)}</duration>`);
    }
    lines.push('    </track>');
  }

  lines.push('  </trackList>');
  lines.push('</playlist>');
  return `${lines.join('\n')}\n`;
}

export function detectPlaylistFormat(value) {
  const extension = normalizeExtension(value);
  if (extension === 'm3u' || extension === 'm3u8') return extension;
  if (extension === 'pls') return 'pls';
  if (extension === 'xspf') return 'xspf';
  return null;
}

export function parsePlaylist(input, options = {}) {
  const decoded = typeof input === 'string'
    ? { text: input, encoding: undefined }
    : decodePlaylistBytes(input, options);
  const format = options.format ?? detectPlaylistFormat(options.fileName ?? options.extension ?? '') ?? 'm3u';
  const result = format === 'pls'
    ? parsePLS(decoded.text)
    : format === 'xspf'
      ? parseXSPF(decoded.text)
      : parseM3U(decoded.text);

  return {
    format,
    encoding: decoded.encoding,
    entries: result.entries
  };
}

export function serializePlaylist(entries, options = {}) {
  const format = options.format ?? detectPlaylistFormat(options.fileName ?? options.extension ?? '') ?? 'm3u8';
  if (format === 'pls') return serializePLS(entries);
  if (format === 'xspf') return serializeXSPF(entries, options);
  return serializeM3U8(entries);
}
