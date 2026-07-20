const MAX_HEADER_SCAN_BYTES = 1024 * 1024;

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function parseWav(bytes) {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let channels = null;
  let sampleRate = null;
  let blockAlign = null;
  let dataBytes = null;
  while (offset + 8 <= Math.min(bytes.byteLength, MAX_HEADER_SCAN_BYTES)) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && size >= 16 && offset + 24 <= bytes.byteLength) {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      blockAlign = view.getUint16(offset + 20, true);
    } else if (id === 'data') {
      dataBytes = size;
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (!(channels > 0) || !(sampleRate > 0)) return null;
  return { channels, sampleRate, frames: blockAlign > 0 && dataBytes !== null ? Math.floor(dataBytes / blockAlign) : null };
}

function extended80(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const exponent = view.getUint16(offset, false);
  const high = view.getUint32(offset + 2, false);
  const low = view.getUint32(offset + 6, false);
  if (exponent === 0 && high === 0 && low === 0) return 0;
  const sign = exponent & 0x8000 ? -1 : 1;
  const power = (exponent & 0x7fff) - 16383;
  return sign * (high * 2 ** (power - 31) + low * 2 ** (power - 63));
}

function parseAiff(bytes) {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== 'FORM' || !['AIFF', 'AIFC'].includes(ascii(bytes, 8, 4))) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= Math.min(bytes.byteLength, MAX_HEADER_SCAN_BYTES)) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, false);
    if (id === 'COMM' && size >= 18 && offset + 26 <= bytes.byteLength) {
      const channels = view.getUint16(offset + 8, false);
      const frames = view.getUint32(offset + 10, false);
      const sampleRate = Math.round(extended80(bytes, offset + 16));
      return channels > 0 && sampleRate > 0 ? { channels, frames, sampleRate } : null;
    }
    offset += 8 + size + (size & 1);
  }
  return null;
}

function parseFlac(bytes) {
  if (bytes.byteLength < 42 || ascii(bytes, 0, 4) !== 'fLaC' || (bytes[4] & 0x7f) !== 0) return null;
  const length = (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
  if (length < 34 || bytes.byteLength < 8 + length) return null;
  const offset = 18;
  const packed = (BigInt(bytes[offset]) << 56n) | (BigInt(bytes[offset + 1]) << 48n) |
    (BigInt(bytes[offset + 2]) << 40n) | (BigInt(bytes[offset + 3]) << 32n) |
    (BigInt(bytes[offset + 4]) << 24n) | (BigInt(bytes[offset + 5]) << 16n) |
    (BigInt(bytes[offset + 6]) << 8n) | BigInt(bytes[offset + 7]);
  const sampleRate = Number((packed >> 44n) & 0xfffffn);
  const channels = Number((packed >> 41n) & 0x7n) + 1;
  const frames = Number(packed & 0xfffffffffn);
  return sampleRate > 0 ? { channels, sampleRate, frames: frames || null } : null;
}

export function parseIrAudioHeader(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (!bytes) return { channels: null, frames: null, sampleRate: null };
  return parseWav(bytes) || parseAiff(bytes) || parseFlac(bytes) ||
    { channels: null, frames: null, sampleRate: null };
}

export function isSupportedIrFileName(name) {
  return /\.(?:wav|wave|aif|aiff|flac|mp3|ogg|m4a)$/i.test(String(name || ''));
}
