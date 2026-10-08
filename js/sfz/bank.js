import { normalizeSfzPath, sfzError } from './parser.js';
import { SFZ_DEFAULT_MAX_BYTES, requireSfzMaxBytes } from './limits.js';
import { parseIrAudioHeader } from '../ir-library/audio-header-metadata.js';

const MAGIC = 0x315a4653;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const WARNING_CODES = new Set(['invalid-regions', 'missing-samples', 'unsupported-regions',
  'reduced-bank', 'loop-points-ignored']);

export async function readSfzAudioHeader(readRange, size) {
  const read = async (position, length) => {
    if (position + length > size) return null;
    const bytes = await readRange(position, length);
    return bytes?.byteLength === length ? bytes : null;
  };
  const prefix = await read(0, 12);
  if (!prefix) return {};
  const signature = String.fromCharCode(...prefix.subarray(0, 4));
  let header;
  if (signature === 'fLaC') header = await read(0, 42);
  else if (signature === 'RIFF' || signature === 'FORM') {
    let position = 12;
    let format;
    for (let count = 0; count < 128 && position < 1024 * 1024; count++) {
      const chunk = await read(position, 8);
      if (!chunk) break;
      const tag = String.fromCharCode(...chunk.subarray(0, 4));
      const length = new DataView(chunk.buffer, chunk.byteOffset, 8).getUint32(4, signature === 'RIFF');
      if (signature === 'RIFF' && tag === 'fmt ' && length >= 16) {
        const data = await read(position + 8, 16);
        if (!data) break;
        format = new Uint8Array(24);
        format.set(chunk); format.set(data, 8);
        new DataView(format.buffer).setUint32(4, 16, true);
      } else if (signature === 'RIFF' && tag === 'data' && format) {
        header = new Uint8Array(44);
        header.set(prefix); header.set(format, 12); header.set(chunk, 36);
        break;
      } else if (signature === 'FORM' && tag === 'COMM' && length >= 18) {
        const data = await read(position + 8, 18);
        if (!data) break;
        header = new Uint8Array(38);
        header.set(prefix); header.set(chunk, 12); header.set(data, 20);
        break;
      }
      position += 8 + length + (length & 1);
    }
  }
  const metadata = parseIrAudioHeader(header);
  return metadata.channels > 0 && metadata.frames > 0 && metadata.sampleRate > 0 ? metadata : {};
}

export function encodeSfzBank(selectedPath, files, { maxBytes = SFZ_DEFAULT_MAX_BYTES, warnings = [] } = {}) {
  requireSfzMaxBytes(maxBytes);
  const ordered = [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  let offset = 0;
  const entries = ordered.map(([path, bytes]) => {
    const entry = { path: normalizeSfzPath(path), offset, length: bytes.byteLength };
    offset += bytes.byteLength;
    return entry;
  });
  const metadata = encoder.encode(JSON.stringify({ selectedPath, files: entries,
    ...(warnings.length ? { warnings } : {}) }));
  const size = 12 + metadata.byteLength + offset;
  if (size > maxBytes) throw sfzError('too-large', 'The SFZ bank is too large to save.');
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, metadata.byteLength, true);
  bytes.set(metadata, 12);
  offset = 12 + metadata.byteLength;
  for (const [, data] of ordered) {
    bytes.set(data, offset);
    offset += data.byteLength;
  }
  return bytes;
}

export function estimateSfzBankBytes(selectedPath, sizes) {
  let offset = 0;
  const files = [...sizes].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, length]) => {
      const entry = { path: normalizeSfzPath(path), offset, length };
      offset += length;
      return entry;
    });
  return 12 + encoder.encode(JSON.stringify({ selectedPath, files })).byteLength + offset;
}

export function decodeSfzBank(bytes, { maxBytes = SFZ_DEFAULT_MAX_BYTES } = {}) {
  requireSfzMaxBytes(maxBytes);
  if (bytes?.byteLength > maxBytes) throw sfzError('too-large', 'The SFZ bank is too large to load.');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) {
    throw sfzError('prepare', 'Invalid SFZ bank.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metadataLength = view.getUint32(8, true);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 1 ||
      metadataLength > bytes.byteLength - 12) throw sfzError('prepare', 'Invalid SFZ bank header.');
  const metadata = JSON.parse(decoder.decode(bytes.subarray(12, 12 + metadataLength)));
  if (!Array.isArray(metadata.files) || metadata.files.length > 10000) throw sfzError('prepare', 'Invalid SFZ bank file list.');
  if (metadata.warnings !== undefined && (!Array.isArray(metadata.warnings) || metadata.warnings.length > WARNING_CODES.size ||
      metadata.warnings.some(warning => !WARNING_CODES.has(warning?.code) ||
        !Number.isSafeInteger(warning.count) || warning.count < 1))) {
    throw sfzError('prepare', 'Invalid SFZ bank load warnings.');
  }
  const files = new Map();
  let expectedOffset = 0;
  for (const entry of metadata.files) {
    const path = normalizeSfzPath(entry.path);
    if (files.has(path) || entry.offset !== expectedOffset || !Number.isSafeInteger(entry.length) ||
        entry.length < 0 || entry.offset + entry.length > bytes.byteLength - 12 - metadataLength) {
      throw sfzError('prepare', 'Invalid SFZ bank file range.');
    }
    files.set(path, bytes.subarray(12 + metadataLength + entry.offset, 12 + metadataLength + entry.offset + entry.length));
    expectedOffset += entry.length;
  }
  if (expectedOffset !== bytes.byteLength - 12 - metadataLength) throw sfzError('prepare', 'Invalid SFZ bank size.');
  const selectedPath = normalizeSfzPath(metadata.selectedPath);
  if (!files.has(selectedPath)) throw sfzError('prepare', 'The SFZ bank has no selected instrument.');
  return { selectedPath, files, warnings: metadata.warnings || [] };
}

export async function identifySfzBank(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
