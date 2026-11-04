import { sfzError } from './parser.js';

export const SFZ_SAMPLE_RANGE_MAX_BYTES = 1024 * 1024;

export async function createSfzMemorySampleReader(bytes) {
  bytes = bytes.slice();
  const revision = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  return Object.freeze({ size: bytes.byteLength, revision,
    rangeSource: { kind: 'file', file: new Blob([bytes]), offset: 0, revision }, async readRange(offset, length) {
    requireSfzSampleRange(offset, length, bytes.byteLength);
    return bytes.slice(offset, offset + length);
  } });
}

export function requireSfzSampleRange(offset, length, size) {
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(length) || length < 0 || length > SFZ_SAMPLE_RANGE_MAX_BYTES ||
      !Number.isSafeInteger(offset + length) || offset + length > size) {
    throw sfzError('prepare', 'An instrument sample could not be read. Reload the instrument.');
  }
}

function fileRevision(file) {
  if (!Number.isSafeInteger(file?.size) || file.size < 0 || !Number.isFinite(file.lastModified) ||
      typeof file.slice !== 'function') {
    throw sfzError('prepare', 'An instrument sample could not be opened.');
  }
  return `${file.size}:${file.lastModified}`;
}

// File objects are immutable snapshots. Directory handles are checked against the
// captured revision on every read; bytes still come from the original snapshot.
export async function createSfzFileSampleReader(source) {
  const file = typeof source?.getFile === 'function' ? await source.getFile() : source;
  const revision = fileRevision(file), size = file.size;
  return Object.freeze({ size, revision, rangeSource: file instanceof Blob ? { kind: 'file', file, handle: typeof source?.getFile === 'function' ? source : null, offset: 0, revision } : null, async readRange(offset, length) {
    requireSfzSampleRange(offset, length, size);
    try {
      if (typeof source?.getFile === 'function' && fileRevision(await source.getFile()) !== revision) {
        throw sfzError('source-changed', 'An instrument sample changed. Reload the instrument.');
      }
      const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
      if (bytes.byteLength !== length) throw new Error('Short sample range');
      return bytes;
    } catch (cause) {
      if (cause?.code === 'source-changed') throw cause;
      throw sfzError('source-changed', 'An instrument sample changed or could not be read. Reload the instrument.', cause);
    }
  } });
}
