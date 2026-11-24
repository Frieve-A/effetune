import { decodeLegacyMetadataBytes } from '../metadata/text-encoding.js';

export function fail(kind = 'corrupt') {
  throw Object.assign(new Error('Archive ' + kind), { code: 'archive-' + kind });
}

export const u16 = (bytes, i) => bytes[i] | bytes[i + 1] << 8;
export const u32 = (bytes, i) => (u16(bytes, i) | u16(bytes, i + 2) << 16) >>> 0;

export async function readBytes(source, offset, length, signal) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > source.size) fail();
  const bytes = await source.read(offset, length);
  if (bytes.byteLength !== length) throw Object.assign(new Error('Archive source changed during read'), { code: 'EIO' });
  signal?.throwIfAborted();
  return bytes;
}

const JAPANESE_LETTER = /[぀-ヿ一-鿿ｦ-ﾟ]/;

export function decodeName(bytes, utf8 = false) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { if (utf8) return ''; }
  // Short names give the metadata mojibake repair too little evidence, so try
  // Shift_JIS first: legacy MIDI archives are mostly Japanese.
  try {
    const name = new TextDecoder('shift_jis', { fatal: true }).decode(bytes);
    if (JAPANESE_LETTER.test(name)) return name;
  } catch { /* Not Shift_JIS. */ }
  return decodeLegacyMetadataBytes(bytes, null);
}

export function normalizePath(name) {
  const path = name.replaceAll('\\', '/');
  const parts = path.split('/');
  if (path.includes('\0') || parts.some(part => !part || part === '..')) return '';
  const normalized = parts.filter(part => part !== '.').join('/');
  return /^[a-z]:/i.test(normalized) ? '' : normalized;
}
