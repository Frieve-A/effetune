// Independently implemented from RFC 9639. No reference decoder code is used.
const fail = () => { throw Object.assign(new Error('The FLAC sample could not be read.'), { code: 'sample-format' }); };
export const FLAC_MAX_FRAME_BYTES = 1024 * 1024;

class Bits {
  constructor(bytes) { this.bytes = bytes; this.position = 0; }
  read(count) {
    if (count < 0 || count > 36 || this.position + count > this.bytes.length * 8) fail();
    let value = 0;
    while (count) {
      const bit = this.position % 8, take = Math.min(count, 8 - bit);
      value = value * 2 ** take + ((this.bytes[this.position >>> 3] >>> (8 - bit - take)) & (2 ** take - 1));
      this.position += take; count -= take;
    }
    return value;
  }
  signed(count) { const value = this.read(count); return count && value >= 2 ** (count - 1) ? value - 2 ** count : value; }
  unary() {
    let zeros = 0;
    while (!this.read(1)) if (++zeros > FLAC_MAX_FRAME_BYTES * 8) fail();
    return zeros;
  }
}

function crc(bytes, width, polynomial) {
  let value = 0;
  const top = 2 ** (width - 1), mask = 2 ** width - 1;
  for (const byte of bytes) {
    value ^= byte << (width - 8);
    for (let bit = 0; bit < 8; bit++) value = ((value << 1) ^ (value & top ? polynomial : 0)) & mask;
  }
  return value;
}

function codedNumber(bits) {
  const first = bits.read(8);
  if (first < 128) return first;
  let count = 0;
  for (let mask = 128; first & mask; mask >>>= 1) count++;
  if (count < 2 || count > 7) fail();
  let value = first & (2 ** (7 - count) - 1);
  for (let i = 1; i < count; i++) {
    const byte = bits.read(8);
    if ((byte & 192) !== 128) fail();
    value = value * 64 + (byte & 63);
  }
  if (value < (count === 2 ? 128 : 2 ** (5 * count - 4))) fail();
  return value;
}

export function readFlacFrameHeader(bytes, metadata) {
  const bits = new Bits(bytes);
  if (bits.read(14) !== 0x3ffe || bits.read(1)) fail();
  const variable = bits.read(1), blockCode = bits.read(4), rateCode = bits.read(4);
  const assignment = bits.read(4), depthCode = bits.read(3);
  if (bits.read(1) || !blockCode || rateCode === 15 || assignment > 10 || depthCode === 3) fail();
  const number = codedNumber(bits);
  if (!variable && number > 0x7fffffff) fail();
  const frames = blockCode === 1 ? 192 : blockCode <= 5 ? 144 * 2 ** blockCode
    : blockCode === 6 ? bits.read(8) + 1 : blockCode === 7 ? bits.read(16) + 1 : 2 ** blockCode;
  const rates = [metadata.sampleRate, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
  const rate = rateCode < 12 ? rates[rateCode] : rateCode === 12 ? bits.read(8) * 1000 : bits.read(16) * (rateCode === 14 ? 10 : 1);
  const depth = [metadata.bitsPerSample, 8, 12, 0, 16, 20, 24, 32][depthCode];
  const channels = assignment < 8 ? assignment + 1 : 2;
  const headerBytes = bits.position / 8;
  if (bits.read(8) !== crc(bytes.subarray(0, headerBytes), 8, 7) || frames > 65535 ||
      channels !== metadata.channels || rate !== metadata.sampleRate || depth !== metadata.bitsPerSample) fail();
  const firstFrame = variable ? number : number * metadata.maxBlockFrames;
  if (!Number.isSafeInteger(firstFrame) || firstFrame + frames > metadata.frames) fail();
  return { bits, frames, firstFrame, assignment, depth, channels };
}

function residual(bits, output, order) {
  const method = bits.read(2), partitions = 2 ** bits.read(4);
  if (method > 1 || output.length % partitions || output.length / partitions <= order) fail();
  const parameterBits = method + 4, escape = 2 ** parameterBits - 1;
  let cursor = order;
  for (let part = 0; part < partitions; part++) {
    const parameter = bits.read(parameterBits), count = output.length / partitions - (part === 0 ? order : 0);
    const rawBits = parameter === escape ? bits.read(5) : 0;
    for (let i = 0; i < count; i++) {
      if (parameter === escape) output[cursor++] = bits.signed(rawBits);
      else {
        const folded = bits.unary() * 2 ** parameter + bits.read(parameter);
        if (folded > 0xfffffffe) fail();
        output[cursor++] = folded % 2 ? -(folded + 1) / 2 : folded / 2;
      }
    }
  }
}

function subframe(bits, frames, depth) {
  if (bits.read(1)) fail();
  const type = bits.read(6), wasted = bits.read(1) ? bits.unary() + 1 : 0;
  depth -= wasted;
  if (depth < 1 || depth > 33) fail();
  const output = new Float64Array(frames);
  if (type === 0) output.fill(bits.signed(depth));
  else if (type === 1) for (let i = 0; i < frames; i++) output[i] = bits.signed(depth);
  else {
    const order = type >= 32 ? type - 31 : type >= 8 && type <= 12 ? type - 8 : -1;
    if (order < 0 || order >= frames) fail();
    for (let i = 0; i < order; i++) output[i] = bits.signed(depth);
    const coefficients = [];
    let shift = 0;
    if (type >= 32) {
      const precision = bits.read(4) + 1;
      shift = bits.signed(5);
      if (precision === 16 || shift < 0) fail();
      for (let i = 0; i < order; i++) coefficients.push(bits.signed(precision));
    } else coefficients.push(...[[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]][order]);
    residual(bits, output, order);
    for (let i = order; i < frames; i++) {
      let prediction = 0;
      for (let j = 0; j < order; j++) prediction += coefficients[j] * output[i - j - 1];
      if (!Number.isSafeInteger(prediction)) fail();
      output[i] += Math.floor(prediction / 2 ** shift);
      if (!Number.isSafeInteger(output[i])) fail();
    }
  }
  if (wasted) for (let i = 0; i < frames; i++) output[i] *= 2 ** wasted;
  return output;
}

export function decodeFlacFrame(bytes, metadata) {
  const header = readFlacFrameHeader(bytes, metadata);
  const { bits, frames, channels, assignment, depth } = header;
  const decoded = [];
  for (let channel = 0; channel < channels; channel++) {
    const side = (assignment === 8 || assignment === 10) && channel === 1 || assignment === 9 && channel === 0;
    decoded.push(subframe(bits, frames, depth + (side ? 1 : 0)));
  }
  if (bits.position % 8 && bits.read(8 - bits.position % 8)) fail();
  const footer = bits.position / 8;
  if (bits.read(16) !== crc(bytes.subarray(0, footer), 16, 0x8005)) fail();
  const pcm = new Float32Array(frames * channels), scale = 2 ** (1 - depth);
  for (let i = 0; i < frames; i++) {
    let left = decoded[0][i], right = channels === 2 ? decoded[1][i] : left;
    if (assignment === 8) right = left - right;
    else if (assignment === 9) left += right;
    else if (assignment === 10) {
      const mid = left * 2 + (Math.abs(right) % 2);
      left = (mid + right) / 2; right = (mid - right) / 2;
    }
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) fail();
    // Store the signed PCM bit width only after prediction and decorrelation.
    // Predictor history must retain its wider arithmetic domain. This also
    // preserves legacy boundary encodings whose packed PCM checksum is valid.
    const modulus = 2 ** depth, half = modulus / 2;
    left = ((left % modulus) + modulus) % modulus;
    right = ((right % modulus) + modulus) % modulus;
    if (left >= half) left -= modulus;
    if (right >= half) right -= modulus;
    pcm[i * channels] = left * scale;
    if (channels === 2) pcm[i * channels + 1] = right * scale;
  }
  return { firstFrame: header.firstFrame, frames, pcm, bytesConsumed: bits.position / 8 };
}

export async function readFlacMetadata(read, size) {
  let offset = 4, info, last = false;
  const seekPoints = [];
  for (let count = 0; !last && count < 1024; count++) {
    const header = await read(offset, 4), type = header[0] & 127;
    last = Boolean(header[0] & 128);
    const length = header[1] * 65536 + header[2] * 256 + header[3];
    offset += 4;
    if (offset + length > size || type === 127 || !info && type !== 0) fail();
    if (type === 0) {
      if (info || length !== 34) fail();
      const bytes = await read(offset, length), view = new DataView(bytes.buffer, bytes.byteOffset, length);
      const packed = view.getBigUint64(10);
      info = { format: 'flac', channels: Number(packed >> 41n & 7n) + 1,
        bitsPerSample: Number(packed >> 36n & 31n) + 1, sampleRate: Number(packed >> 44n),
        frames: Number(packed & 0xfffffffffn), maxBlockFrames: view.getUint16(2),
        maxFrameBytes: bytes[7] * 65536 + bytes[8] * 256 + bytes[9],
        contentDigest: Array.from(bytes.subarray(18), byte => byte.toString(16).padStart(2, '0')).join('') };
      if (info.channels > 2 || !info.sampleRate || !info.frames || !info.maxBlockFrames || info.bitsPerSample < 4) fail();
    } else if (type === 3) {
      if (length % 18 || length / 18 > 65536) fail();
      for (let position = 0; position < length; position += 18 * 256) {
        const bytes = await read(offset + position, Math.min(length - position, 18 * 256));
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < bytes.length; i += 18) {
          const frame = view.getBigUint64(i), relative = view.getBigUint64(i + 8);
          if (frame === 0xffffffffffffffffn) continue;
          if (frame >= BigInt(info.frames) || relative > BigInt(size) || seekPoints.length && Number(frame) <= seekPoints.at(-1).frame) fail();
          seekPoints.push(Object.freeze({ frame: Number(frame), offset: Number(relative) }));
        }
      }
    }
    offset += length;
  }
  if (!last || !info || offset >= size) fail();
  return Object.freeze({ ...info, dataOffset: offset, size, seekPoints: Object.freeze(seekPoints) });
}
