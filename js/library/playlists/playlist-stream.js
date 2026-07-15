import {
  detectPlaylistFormat,
  normalizePlaylistPath,
  pathToFileUri
} from './playlist-formats.js';

export const DEFAULT_PLAYLIST_STREAM_LIMITS = Object.freeze({
  maxInputChunkBytes: 256 * 1024,
  maxLineChars: 1024 * 1024,
  maxXmlTokenChars: 64 * 1024,
  maxXmlValueChars: 1024 * 1024,
  maxOutputChunkChars: 64 * 1024
});

export class PlaylistStreamLimitError extends Error {
  constructor(kind, limit, actual) {
    super(`Playlist ${kind} exceeds the ${limit} limit (${actual}).`);
    this.name = 'PlaylistStreamLimitError';
    this.code = 'PLAYLIST_STREAM_LIMIT';
    this.kind = kind;
    this.limit = limit;
    this.actual = actual;
  }
}

export class PlaylistEncodingReplayRequiredError extends Error {
  constructor() {
    super('Playlist encoding auto-detection requires a replayable source, a BOM, an M3U8 file, or an explicit encoding.');
    this.name = 'PlaylistEncodingReplayRequiredError';
    this.code = 'PLAYLIST_ENCODING_REPLAY_REQUIRED';
  }
}

function isByteInput(value) {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('Playlist byte streams must yield ArrayBuffer or typed-array chunks.');
}

async function* singleChunk(value) {
  yield value;
}

function sourceFactory(source) {
  if (typeof source === 'function') return source;
  if (isByteInput(source) || typeof source === 'string') return () => singleChunk(source);
  return null;
}

function openSource(source) {
  const value = typeof source === 'function' ? source() : source;
  if (isByteInput(value) || typeof value === 'string') return singleChunk(value);
  if (value?.[Symbol.asyncIterator] || value?.[Symbol.iterator]) return value;
  throw new TypeError('Expected a playlist chunk iterable or a function that creates one.');
}

function streamLimits(options) {
  return { ...DEFAULT_PLAYLIST_STREAM_LIMITS, ...(options.limits ?? {}) };
}

function assertChunkLimit(bytes, limits) {
  if (bytes.byteLength > limits.maxInputChunkBytes) {
    throw new PlaylistStreamLimitError('input chunk bytes', limits.maxInputChunkBytes, bytes.byteLength);
  }
}

function bomEncoding(prefix) {
  if (prefix.length >= 3 && prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 };
  }
  if (prefix.length >= 2 && prefix[0] === 0xff && prefix[1] === 0xfe) {
    return { encoding: 'utf-16le', length: 2 };
  }
  if (prefix.length >= 2 && prefix[0] === 0xfe && prefix[1] === 0xff) {
    return { encoding: 'utf-16be', length: 2 };
  }
  return null;
}

async function readBom(factory, limits) {
  const prefix = [];
  for await (const value of openSource(factory)) {
    const bytes = asBytes(value);
    assertChunkLimit(bytes, limits);
    for (let index = 0; index < bytes.length && prefix.length < 3; index += 1) prefix.push(bytes[index]);
    if (prefix.length >= 3) break;
  }
  return bomEncoding(prefix);
}

async function validatesAs(factory, encoding, limits) {
  const decoder = new TextDecoder(encoding, { fatal: true });
  try {
    for await (const value of openSource(factory)) {
      const bytes = asBytes(value);
      assertChunkLimit(bytes, limits);
      decoder.decode(bytes, { stream: true });
    }
    decoder.decode();
    return true;
  } catch (error) {
    if (error instanceof PlaylistStreamLimitError) throw error;
    return false;
  }
}

async function chooseReplayableEncoding(factory, format, options, limits) {
  if (options.encoding) return options.encoding;
  const bom = await readBom(factory, limits);
  if (bom) return bom.encoding;
  if (format === 'm3u8') return 'utf-8';
  if (await validatesAs(factory, 'utf-8', limits)) return 'utf-8';
  if (await validatesAs(factory, 'shift_jis', limits)) return 'shift_jis';
  return 'windows-1252';
}

async function* decodeByteChunks(source, encoding, format, options, limits) {
  const iterable = openSource(source);
  const iterator = iterable[Symbol.asyncIterator]
    ? iterable[Symbol.asyncIterator]()
    : toAsyncIterator(iterable);
  const pending = [];
  let pendingLength = 0;
  let firstRemainder = null;

  while (pendingLength < 3) {
    const next = await iterator.next();
    if (next.done) break;
    const bytes = asBytes(next.value);
    assertChunkLimit(bytes, limits);
    if (bytes.length === 0) continue;
    const needed = 3 - pendingLength;
    const prefixPart = bytes.subarray(0, needed);
    pending.push(prefixPart);
    pendingLength += prefixPart.length;
    if (bytes.length > prefixPart.length) firstRemainder = bytes.subarray(prefixPart.length);
  }

  const prefix = new Uint8Array(pendingLength);
  let prefixOffset = 0;
  for (const part of pending) {
    prefix.set(part, prefixOffset);
    prefixOffset += part.length;
  }
  const bom = bomEncoding(prefix);
  const selectedEncoding = bom?.encoding ?? encoding ?? (format === 'm3u8' ? 'utf-8' : null);
  if (!selectedEncoding) throw new PlaylistEncodingReplayRequiredError();

  const decoder = new TextDecoder(selectedEncoding, { fatal: selectedEncoding !== 'windows-1252' });
  const decodedPrefix = prefix.subarray(bom?.length ?? 0);
  if (decodedPrefix.length) {
    const text = decoder.decode(decodedPrefix, { stream: true });
    if (text) yield text;
  }
  if (firstRemainder?.length) {
    const text = decoder.decode(firstRemainder, { stream: true });
    if (text) yield text;
  }
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    const bytes = asBytes(next.value);
    assertChunkLimit(bytes, limits);
    const text = decoder.decode(bytes, { stream: true });
    if (text) yield text;
  }
  const finalText = decoder.decode();
  if (finalText) yield finalText;
}

async function* decodeTextChunks(source, limits) {
  let first = true;
  for await (const value of openSource(source)) {
    if (typeof value !== 'string') throw new TypeError('Playlist text streams must yield string chunks.');
    if (value.length > limits.maxInputChunkBytes) {
      throw new PlaylistStreamLimitError('input chunk characters', limits.maxInputChunkBytes, value.length);
    }
    const text = first && value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
    if (value.length) first = false;
    if (text) yield text;
  }
}

function toAsyncIterator(iterable) {
  const iterator = iterable[Symbol.iterator]();
  return {
    next() {
      return Promise.resolve(iterator.next());
    }
  };
}

async function firstChunk(source) {
  const iterable = openSource(source);
  const iterator = iterable[Symbol.asyncIterator]
    ? iterable[Symbol.asyncIterator]()
    : toAsyncIterator(iterable);
  const first = await iterator.next();
  await iterator.return?.();
  return first.done ? '' : first.value;
}

async function prepareTextChunks(source, format, options, limits) {
  const factory = sourceFactory(source);
  if (!factory) {
    const iterable = openSource(source);
    const iterator = iterable[Symbol.asyncIterator]
      ? iterable[Symbol.asyncIterator]()
      : toAsyncIterator(iterable);
    const first = await iterator.next();
    if (first.done) return decodeTextChunks('', limits);
    const remainder = async function* remainderChunks() {
      yield first.value;
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        yield next.value;
      }
    };
    return typeof first.value === 'string'
      ? decodeTextChunks(remainder, limits)
      : decodeByteChunks(remainder, options.encoding, format, options, limits);
  }

  const sample = await firstChunk(factory);
  const textInput = typeof source === 'string' || typeof sample === 'string';
  if (textInput) return decodeTextChunks(source, limits);

  const encoding = await chooseReplayableEncoding(factory, format, options, limits);
  return decodeByteChunks(source, encoding, format, options, limits);
}

async function* linesFromChunks(chunks, limits) {
  let line = '';
  let skipLf = false;
  for await (const chunk of chunks) {
    let start = 0;
    if (skipLf && chunk[0] === '\n') start = 1;
    skipLf = false;
    for (let index = start; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (char !== '\n' && char !== '\r') continue;
      line += chunk.slice(start, index);
      if (line.length > limits.maxLineChars) {
        throw new PlaylistStreamLimitError('line characters', limits.maxLineChars, line.length);
      }
      yield line;
      line = '';
      skipLf = char === '\r';
      start = index + 1;
    }
    line += chunk.slice(start);
    if (line.length > limits.maxLineChars) {
      throw new PlaylistStreamLimitError('line characters', limits.maxLineChars, line.length);
    }
  }
  if (line) yield line;
}

function durationSeconds(value) {
  const duration = Number.parseFloat(String(value).trim());
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : undefined;
}

function displayFields(value) {
  const label = String(value ?? '').trim();
  if (!label) return {};
  const separator = label.indexOf(' - ');
  return separator > 0 && separator < label.length - 3
    ? { artist: label.slice(0, separator).trim(), title: label.slice(separator + 3).trim() }
    : { title: label };
}

async function* parseM3uRecords(chunks, limits) {
  let pending = null;
  for await (const rawLine of linesFromChunks(chunks, limits)) {
    const line = rawLine.trim();
    if (!line) continue;
    const info = line.match(/^#EXTINF\s*:\s*([^,]*),(.*)$/i);
    if (info) {
      pending = displayFields(info[2]);
      const durationSec = durationSeconds(info[1]);
      if (durationSec !== undefined) pending.durationSec = durationSec;
      continue;
    }
    if (line.startsWith('#')) continue;
    yield { type: 'entry', entry: { path: normalizePlaylistPath(line), ...(pending ?? {}) } };
    pending = null;
  }
}

async function* parsePlsRecords(chunks, limits) {
  for await (const rawLine of linesFromChunks(chunks, limits)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#') || /^\[.*\]$/.test(line)) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const match = line.slice(0, equals).trim().match(/^(file|title|length)(\d+)$/i);
    if (!match) continue;
    const index = Number.parseInt(match[2], 10);
    const value = line.slice(equals + 1).trim();
    let fields;
    if (match[1].toLowerCase() === 'file') fields = { path: normalizePlaylistPath(value) };
    else if (match[1].toLowerCase() === 'title') fields = displayFields(value);
    else {
      const durationSec = durationSeconds(value);
      fields = durationSec === undefined ? {} : { durationSec };
    }
    if (Object.keys(fields).length) yield { type: 'fields', index, fields };
  }
}

function decodeXml(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, body) => {
    const lower = body.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const codePoint = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

function xmlName(token) {
  const match = token.match(/^<\/?\s*([\w.-]+:)?([\w.-]+)/);
  return match?.[2]?.toLowerCase() ?? '';
}

async function* parseXspfRecords(chunks, limits) {
  const fields = new Set(['location', 'title', 'creator', 'album', 'duration']);
  let tokenBuffer = '';
  let track = null;
  let activeField = null;
  let valueBuffer = '';

  for await (const chunk of chunks) {
    tokenBuffer += chunk;
    for (;;) {
      const open = tokenBuffer.indexOf('<');
      if (open < 0) {
        if (activeField) {
          valueBuffer += tokenBuffer;
          if (valueBuffer.length > limits.maxXmlValueChars) {
            throw new PlaylistStreamLimitError('XML value characters', limits.maxXmlValueChars, valueBuffer.length);
          }
        }
        tokenBuffer = '';
        break;
      }
      if (open > 0) {
        if (activeField) {
          valueBuffer += tokenBuffer.slice(0, open);
          if (valueBuffer.length > limits.maxXmlValueChars) {
            throw new PlaylistStreamLimitError('XML value characters', limits.maxXmlValueChars, valueBuffer.length);
          }
        }
        tokenBuffer = tokenBuffer.slice(open);
      }
      const specialEnd = tokenBuffer.startsWith('<!--')
        ? '-->'
        : tokenBuffer.startsWith('<?')
          ? '?>'
          : null;
      const close = specialEnd
        ? tokenBuffer.indexOf(specialEnd) + (tokenBuffer.indexOf(specialEnd) >= 0 ? specialEnd.length - 1 : 0)
        : tokenBuffer.indexOf('>');
      if (close < 0) {
        if (tokenBuffer.length > limits.maxXmlTokenChars) {
          throw new PlaylistStreamLimitError('XML token characters', limits.maxXmlTokenChars, tokenBuffer.length);
        }
        break;
      }
      const token = tokenBuffer.slice(0, close + 1);
      tokenBuffer = tokenBuffer.slice(close + 1);
      if (specialEnd) continue;
      const name = xmlName(token);
      const closing = /^<\//.test(token);
      if (name === 'track' && !closing) {
        track = {};
      } else if (name === 'track' && closing) {
        if (track?.path) yield { type: 'entry', entry: track };
        track = null;
        activeField = null;
        valueBuffer = '';
      } else if (track && fields.has(name) && !closing && !/\/>$/.test(token)) {
        activeField = name;
        valueBuffer = '';
      } else if (track && name === activeField && closing) {
        const value = decodeXml(valueBuffer.trim());
        if (activeField === 'location' && value) track.path = normalizePlaylistPath(decodeURIComponentSafe(value));
        else if (activeField === 'creator' && value) track.artist = value;
        else if (activeField === 'duration') {
          const duration = Number.parseFloat(value);
          if (Number.isFinite(duration) && duration >= 0) track.durationSec = duration / 1000;
        } else if (value) track[activeField] = value;
        activeField = null;
        valueBuffer = '';
      }
    }
  }
  if (tokenBuffer.trim()) {
    throw new Error('Unexpected end of XSPF XML token.');
  }
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function* parsePlaylistStream(source, options = {}) {
  const format = options.format
    ?? detectPlaylistFormat(options.fileName ?? options.extension ?? '')
    ?? 'm3u';
  const limits = streamLimits(options);
  const chunks = await prepareTextChunks(source, format, options, limits);
  if (format === 'pls') yield* parsePlsRecords(chunks, limits);
  else if (format === 'xspf') yield* parseXspfRecords(chunks, limits);
  else yield* parseM3uRecords(chunks, limits);
}

function cleanLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function entryPath(entry) {
  return cleanLine(entry?.path ?? entry?.location ?? entry?.sourceLine
    ?? entry?.relativePathHint ?? entry?.unresolved?.sourceLine
    ?? entry?.unresolved?.relativePathHint ?? '');
}

function entryTitle(entry) {
  const title = cleanLine(entry?.title ?? entry?.unresolved?.title ?? '');
  const artist = cleanLine(entry?.artist ?? entry?.creator ?? entry?.unresolved?.artist ?? '');
  return artist && title ? `${artist} - ${title}` : title || artist;
}

function durationText(value) {
  const duration = Number.parseFloat(value);
  return Number.isFinite(duration) && duration >= 0 ? String(Math.round(duration)) : '-1';
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function xspfLocation(path, entry, options) {
  const slashPath = path.replace(/\\/g, '/');
  const absolute = /^[A-Za-z]:\//.test(slashPath) || slashPath.startsWith('/') || slashPath.startsWith('//');
  if (entry?.relative || (options.fileUris === false && !absolute)) {
    return slashPath.split('/').map(encodeURIComponent).join('/');
  }
  return pathToFileUri(path);
}

async function* asyncEntries(entries) {
  if (entries?.[Symbol.asyncIterator]) yield* entries;
  else yield* entries ?? [];
}

async function* boundedOutput(records, limits) {
  let chunk = '';
  for await (const record of records) {
    if (record.length > limits.maxOutputChunkChars) {
      throw new PlaylistStreamLimitError('output record characters', limits.maxOutputChunkChars, record.length);
    }
    if (chunk && chunk.length + record.length > limits.maxOutputChunkChars) {
      yield chunk;
      chunk = '';
    }
    chunk += record;
  }
  if (chunk) yield chunk;
}

async function* m3u8Records(entries) {
  yield '#EXTM3U\n';
  for await (const entry of asyncEntries(entries)) {
    const path = entryPath(entry);
    if (!path) continue;
    yield `#EXTINF:${durationText(entry?.durationSec ?? entry?.unresolved?.durationSec)},${entryTitle(entry)}\n${path}\n`;
  }
}

export function serializeM3U8Stream(entries, options = {}) {
  return boundedOutput(m3u8Records(entries), streamLimits(options));
}

async function* xspfRecords(entries, options) {
  yield '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <trackList>\n';
  for await (const entry of asyncEntries(entries)) {
    const path = entryPath(entry);
    if (!path) continue;
    const title = entry?.title ?? entry?.unresolved?.title;
    const creator = entry?.artist ?? entry?.creator ?? entry?.unresolved?.artist;
    const album = entry?.album ?? entry?.unresolved?.album;
    const duration = Number.parseFloat(entry?.durationSec ?? entry?.unresolved?.durationSec);
    let record = `    <track>\n      <location>${escapeXml(xspfLocation(path, entry, options))}</location>\n`;
    if (title) record += `      <title>${escapeXml(cleanLine(title))}</title>\n`;
    if (creator) record += `      <creator>${escapeXml(cleanLine(creator))}</creator>\n`;
    if (album) record += `      <album>${escapeXml(cleanLine(album))}</album>\n`;
    if (Number.isFinite(duration)) record += `      <duration>${Math.round(duration * 1000)}</duration>\n`;
    yield `${record}    </track>\n`;
  }
  yield '  </trackList>\n</playlist>\n';
}

export function serializeXSPFStream(entries, options = {}) {
  return boundedOutput(xspfRecords(entries, options), streamLimits(options));
}
