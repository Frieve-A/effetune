export const IR_LIBRARY_MAX_ORIGINAL_BYTES = 64 * 1024 * 1024;
export const IR_LIBRARY_MAX_INDEX_BYTES = 32 * 1024 * 1024;
export const IR_LIBRARY_MAX_ANALYSIS_BYTES = 4 * 1024 * 1024;
export const IR_LIBRARY_MAX_CACHE_ENTRY_BYTES = 64 * 1024 * 1024;
export const IR_LIBRARY_MAX_CACHE_INDEX_BYTES = 4 * 1024 * 1024;
export const IR_LIBRARY_MAX_DECODED_PCM_BYTES = IR_LIBRARY_MAX_CACHE_ENTRY_BYTES;
export const IR_LIBRARY_MAX_DECODED_PCM_CHANNELS = 8;
export const IR_LIBRARY_INDEX_TOO_LARGE_CODE = 'ir-library-index-too-large';

const ANALYSIS_NAME_PATTERN = /^[a-f0-9]{24}(?:\.analysis|\.a[0-9]{9})$/;

export function maxIrLibraryBytesForName(name) {
  if (name === 'index.json') return IR_LIBRARY_MAX_INDEX_BYTES;
  if (ANALYSIS_NAME_PATTERN.test(name)) return IR_LIBRARY_MAX_ANALYSIS_BYTES;
  return IR_LIBRARY_MAX_ORIGINAL_BYTES;
}

export function maxIrCacheBytesForName(name) {
  return name === 'index.json' ? IR_LIBRARY_MAX_CACHE_INDEX_BYTES : IR_LIBRARY_MAX_CACHE_ENTRY_BYTES;
}

export function requireBoundedIrBytes(value, maxBytes, label = 'IR library data') {
  const byteLength = value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? value.byteLength : null;
  if (!Number.isSafeInteger(byteLength)) throw new TypeError(`${label} must be binary.`);
  if (byteLength > maxBytes) throw new RangeError(`${label} is too large.`);
  return byteLength;
}

export function requireBoundedDecodedIrShape(channels, frames, sampleRate, label = 'Decoded impulse response') {
  if (!Number.isSafeInteger(channels) || channels < 1 || channels > IR_LIBRARY_MAX_DECODED_PCM_CHANNELS ||
      !Number.isSafeInteger(frames) || frames < 1 ||
      !Number.isSafeInteger(sampleRate) || sampleRate < 1000 || sampleRate > 999999) {
    throw new RangeError(`${label} has an unsupported audio format.`);
  }
  const byteLength = channels * frames * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(byteLength) || byteLength > IR_LIBRARY_MAX_DECODED_PCM_BYTES) {
    throw new RangeError(`${label} is too large.`);
  }
  return byteLength;
}

export function requireBoundedDecodedIrHeader(header, label = 'Impulse response') {
  const channels = header?.channels;
  const frames = header?.frames;
  const sampleRate = header?.sampleRate;
  if (channels !== null && channels !== undefined &&
      (!Number.isSafeInteger(channels) || channels < 1 || channels > IR_LIBRARY_MAX_DECODED_PCM_CHANNELS)) {
    throw new RangeError(`${label} has an unsupported audio format.`);
  }
  if (frames !== null && frames !== undefined && (!Number.isSafeInteger(frames) || frames < 1)) {
    throw new RangeError(`${label} has an unsupported audio format.`);
  }
  if (sampleRate !== null && sampleRate !== undefined &&
      (!Number.isSafeInteger(sampleRate) || sampleRate < 1000 || sampleRate > 999999)) {
    throw new RangeError(`${label} has an unsupported audio format.`);
  }
  if (!Number.isSafeInteger(channels) || !Number.isSafeInteger(frames) ||
      !Number.isSafeInteger(sampleRate)) return null;
  return requireBoundedDecodedIrShape(channels, frames, sampleRate, label);
}

export function requireBoundedDecodedIrPcm(pcm, label = 'Decoded impulse response') {
  const channels = pcm?.channels;
  if (!Array.isArray(channels) || channels.length < 1 ||
      !channels.every(channel => channel instanceof Float32Array)) {
    throw new TypeError(`${label} must contain floating-point audio channels.`);
  }
  const frames = channels[0].length;
  if (!channels.every(channel => channel.length === frames)) {
    throw new TypeError(`${label} channels must have the same length.`);
  }
  return requireBoundedDecodedIrShape(channels.length, frames, pcm.sampleRate, label);
}
