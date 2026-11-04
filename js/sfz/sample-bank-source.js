import { SFZ_BANK_MAGIC, validateSfzBankIndex } from './bank.js';
import { createSfzFileSampleReader, SFZ_SAMPLE_RANGE_MAX_BYTES, requireSfzSampleRange } from './sample-reader.js';
import { normalizeSfzPath, sfzError } from './parser.js';

const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });

// The existing portable bank format stores an index followed by source files.
// Blob parts preserve File backing; constructing this value never reads all PCM
// or compressed source bytes into JavaScript memory.
export function encodeSfzBankBlob(selectedPath, files, { warnings = [] } = {}) {
  const ordered = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  let offset = 0;
  const entries = ordered.map(([path, file]) => {
    if (!(file instanceof Uint8Array) && !(file instanceof Blob)) throw sfzError('prepare', 'An SFZ source file could not be read.');
    const length = file instanceof Uint8Array ? file.byteLength : file?.size;
    if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset + length)) throw sfzError('too-large', 'The SFZ source files are too large.');
    const entry = { path: normalizeSfzPath(path), offset, length }; offset += length; return entry;
  });
  const index = { selectedPath: normalizeSfzPath(selectedPath), files: entries, ...(warnings.length && { warnings }) };
  validateSfzBankIndex(index, offset);
  const metadata = encoder.encode(JSON.stringify(index));
  if (metadata.length > MAX_INDEX_BYTES) throw sfzError('too-large', 'The SFZ file list is too large.');
  const prefix = new Uint8Array(12), view = new DataView(prefix.buffer);
  view.setUint32(0, SFZ_BANK_MAGIC, true); view.setUint32(4, 1, true); view.setUint32(8, metadata.length, true);
  return new Blob([prefix, metadata, ...ordered.map(([, file]) => file)]);
}

export async function openSfzBankSource(file) {
  const reader = await createSfzFileSampleReader(file);
  const prefix = await reader.readRange(0, 12), view = new DataView(prefix.buffer, prefix.byteOffset, 12);
  const length = view.getUint32(8, true);
  if (view.getUint32(0, true) !== SFZ_BANK_MAGIC || view.getUint32(4, true) !== 1 ||
      length > MAX_INDEX_BYTES || length > reader.size - 12) throw sfzError('prepare', 'The stored SFZ instrument could not be read.');
  const metadata = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += SFZ_SAMPLE_RANGE_MAX_BYTES) {
    metadata.set(await reader.readRange(12 + offset, Math.min(SFZ_SAMPLE_RANGE_MAX_BYTES, length - offset)), offset);
  }
  const bank = validateSfzBankIndex(JSON.parse(decoder.decode(metadata)), reader.size - 12 - length);
  const createSampleReader = path => {
    const entry = bank.files.get(normalizeSfzPath(path));
    if (!entry) throw sfzError('prepare', 'An instrument sample could not be found.');
    return Object.freeze({ size: entry.length,
      rangeSource: reader.rangeSource && { ...reader.rangeSource, offset: reader.rangeSource.offset + 12 + length + entry.offset },
      openRangePort: reader.openRangePort, revision: `${reader.revision}:${entry.offset}:${entry.length}`,
      async readRange(offset, count) {
        requireSfzSampleRange(offset, count, entry.length);
        return reader.readRange(12 + length + entry.offset + offset, count);
      } });
  };
  return { ...bank, size: reader.size, createSampleReader };
}
