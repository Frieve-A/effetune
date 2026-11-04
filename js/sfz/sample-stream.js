import { decodeFlacFrame, readFlacFrameHeader, readFlacMetadata, FLAC_MAX_FRAME_BYTES } from './flac-stream.js';
import { SFZ_SAMPLE_RANGE_MAX_BYTES } from './sample-reader.js';
import { decodeOggVorbisFrames } from '../sf2/ogg-vorbis.js';

export const SFZ_SAMPLE_PAGE_FRAMES = 4096;
export const SFZ_SAMPLE_MAX_READ_BYTES = SFZ_SAMPLE_RANGE_MAX_BYTES;
const error = code => Object.assign(new Error('The instrument sample could not be prepared.'), { code });
const text = bytes => String.fromCharCode(...bytes);

async function pcmMetadata(read, size, prefix) {
  const wave = text(prefix.subarray(0, 4)) === 'RIFF';
  const kind = text(prefix.subarray(8, 12));
  if (wave ? kind !== 'WAVE' : kind !== 'AIFF' && kind !== 'AIFC') throw error('sample-format');
  let offset = 12, format, data;
  for (let count = 0; count < 1024 && offset + 8 <= size; count++) {
    const header = await read(offset, 8), view = new DataView(header.buffer, header.byteOffset, 8);
    const tag = text(header.subarray(0, 4)), length = view.getUint32(4, wave), start = offset + 8;
    if (start + length > size) throw error('sample-format');
    if (wave && tag === 'fmt ') {
      if (length < 16) throw error('sample-format');
      const bytes = await read(start, Math.min(length, 40)), v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      let code = v.getUint16(0, true);
      if (code === 0xfffe) {
        if (length < 40 || v.getUint16(16, true) < 22) throw error('sample-format');
        code = v.getUint16(24, true);
        if (text(bytes.subarray(26, 40)) !== '\0\0\0\0\x10\0\x80\0\0\xaa\0\x38\x9b\x71') throw error('sample-format');
      }
      format = { channels: v.getUint16(2, true), sampleRate: v.getUint32(4, true),
        blockAlign: v.getUint16(12, true), bitsPerSample: v.getUint16(14, true), float: code === 3, littleEndian: true, unsigned: true };
      if (code !== 1 && code !== 3) throw error('sample-format');
    } else if (!wave && tag === 'COMM') {
      if (length < (kind === 'AIFC' ? 22 : 18)) throw error('sample-format');
      const bytes = await read(start, kind === 'AIFC' ? 22 : 18), v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const exponent = v.getUint16(8), fraction = Number(v.getBigUint64(10));
      const compression = kind === 'AIFC' ? text(bytes.subarray(18, 22)) : 'NONE';
      if (!['NONE', 'twos', 'sowt', 'fl32', 'FL32', 'fl64', 'FL64'].includes(compression)) throw error('sample-format');
      format = { channels: v.getUint16(0), frames: v.getUint32(2), bitsPerSample: v.getUint16(6),
        sampleRate: fraction * 2 ** ((exponent & 32767) - 16383 - 63), littleEndian: compression === 'sowt',
        float: compression.toLowerCase().startsWith('fl'), unsigned: false };
      if (exponent & 32768) throw error('sample-format');
      format.blockAlign = format.channels * Math.ceil(format.bitsPerSample / 8);
    } else if (wave && tag === 'data') data = { dataOffset: start, dataBytes: length };
    else if (!wave && tag === 'SSND') {
      if (length < 8) throw error('sample-format');
      const bytes = await read(start, 8), skip = new DataView(bytes.buffer, bytes.byteOffset, 8).getUint32(0);
      if (skip > length - 8) throw error('sample-format');
      data = { dataOffset: start + 8 + skip, dataBytes: length - 8 - skip };
    }
    if (format && data) break;
    offset = start + length + (length & 1);
  }
  if (!format || !data || !Number.isSafeInteger(format.sampleRate) || format.sampleRate < 1 || format.sampleRate > 768000 ||
      format.channels < 1 || format.channels > 2 || ![8, 16, 24, 32, 64].includes(format.bitsPerSample) ||
      format.float && ![32, 64].includes(format.bitsPerSample) || !format.float && format.bitsPerSample === 64 ||
      format.blockAlign !== format.channels * format.bitsPerSample / 8 || data.dataBytes % format.blockAlign) throw error('sample-format');
  const frames = data.dataBytes / format.blockAlign;
  if (!frames || format.frames !== undefined && format.frames !== frames) throw error('sample-format');
  return Object.freeze({ format: 'pcm', ...format, ...data, frames, size });
}

function decodePcm(bytes, metadata) {
  const { bitsPerSample: bits, channels, littleEndian: le, float, unsigned } = metadata;
  const width = bits / 8, frames = bytes.length / (width * channels), pcm = new Float32Array(frames * channels);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (let i = 0; i < pcm.length; i++) {
    const at = i * width;
    let value;
    if (float) value = bits === 32 ? view.getFloat32(at, le) : view.getFloat64(at, le);
    else if (bits === 8) value = unsigned ? bytes[at] - 128 : view.getInt8(at);
    else if (bits === 16) value = view.getInt16(at, le);
    else if (bits === 24) {
      value = le ? bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536 : bytes[at] * 65536 + bytes[at + 1] * 256 + bytes[at + 2];
      if (value >= 0x800000) value -= 0x1000000;
    } else value = view.getInt32(at, le);
    if (!Number.isFinite(value)) throw error('sample-format');
    pcm[i] = float ? value : value * 2 ** (1 - bits);
    if (!Number.isFinite(pcm[i])) throw error('sample-format');
  }
  return pcm;
}

// This object belongs to a preparation Worker. Its immutable metadata never owns PCM.
export class SfzSampleStream {
  static async open(readRange, size, pcm = null) {
    if (!Number.isSafeInteger(size) || size < 12) throw error('sample-format');
    const read = async (offset, length) => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 ||
          length > SFZ_SAMPLE_MAX_READ_BYTES || offset + length > size) throw error('sample-range');
      const result = await readRange(offset, length), bytes = result instanceof Uint8Array ? result : new Uint8Array(result);
      if (bytes.length !== length) throw error('sample-changed');
      return bytes;
    };
    if (pcm) {
      if (pcm.format === 'sf3-vorbis') {
        if (pcm.channels !== 1 || !Number.isSafeInteger(pcm.frames) || pcm.frames < 1 ||
            !Number.isInteger(pcm.sampleRate) || pcm.sampleRate < 1 || pcm.sampleRate > 768000 ||
            !Number.isSafeInteger(pcm.firstFrame) || pcm.firstFrame < 0 ||
            !Number.isSafeInteger(pcm.sourceFrames) || pcm.firstFrame + pcm.frames > pcm.sourceFrames ||
            !Number.isSafeInteger(pcm.dataOffset) || pcm.dataOffset < 0 ||
            !Number.isSafeInteger(pcm.dataBytes) || pcm.dataBytes < 58 || pcm.dataOffset + pcm.dataBytes > size) throw error('sample-format');
        return new SfzSampleStream(read, Object.freeze({ ...pcm, size }));
      }
      const { frames, sampleRate, dataOffset, lowByteOffset } = pcm;
      if (pcm.format !== 'sf2-pcm' || pcm.channels !== 1 || !Number.isSafeInteger(frames) || frames < 1 ||
          !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 768000 ||
          !Number.isSafeInteger(dataOffset) || dataOffset < 0 || !Number.isSafeInteger(dataOffset + frames * 2) || dataOffset + frames * 2 > size ||
          lowByteOffset !== null && (!Number.isSafeInteger(lowByteOffset) || lowByteOffset < 0 ||
            !Number.isSafeInteger(lowByteOffset + frames) || lowByteOffset + frames > size)) throw error('sample-format');
      return new SfzSampleStream(read, Object.freeze({ ...pcm, size }));
    }
    const prefix = await read(0, 12), signature = text(prefix.subarray(0, 4));
    const metadata = signature === 'fLaC' ? await readFlacMetadata(read, size)
      : signature === 'RIFF' || signature === 'FORM' ? await pcmMetadata(read, size, prefix) : null;
    if (!metadata) throw error('sample-format');
    return new SfzSampleStream(read, metadata);
  }
  constructor(read, metadata) {
    this.read = read; this.metadata = metadata;
    this.index = metadata.format === 'flac' ? [{ frame: 0, offset: metadata.dataOffset },
      ...metadata.seekPoints.filter(point => point.frame > 0).map(point => ({ frame: point.frame, offset: metadata.dataOffset + point.offset }))] : [];
  }
  async readFrames(firstFrame, count) {
    const m = this.metadata;
    if (!Number.isSafeInteger(firstFrame) || !Number.isSafeInteger(count) || firstFrame < 0 || count < 1 ||
        count > 65536 || firstFrame + count > m.frames) throw error('sample-range');
    if (m.format === 'pcm') return decodePcm(await this.read(m.dataOffset + firstFrame * m.blockAlign, count * m.blockAlign), m);
    if (m.format === 'sf3-vorbis') return decodeOggVorbisFrames((offset, length) => this.read(m.dataOffset + offset, length),
      m.dataBytes, m.firstFrame + firstFrame, count, { frames: m.sourceFrames, sampleRate: m.sampleRate });
    if (m.format === 'sf2-pcm') {
      const bytes = await this.read(m.dataOffset + firstFrame * 2, count * 2);
      const low = m.lowByteOffset === null ? null : await this.read(m.lowByteOffset + firstFrame, count);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), pcm = new Float32Array(count);
      for (let frame = 0; frame < count; frame++) {
        const high = view.getInt16(frame * 2, true);
        pcm[frame] = low ? (high * 256 + low[frame]) / 8388608 : high / 32768;
      }
      return pcm;
    }
    let anchor = this.index[0];
    for (const point of this.index) if (point.frame <= firstFrame && point.frame >= anchor.frame) anchor = point;
    // Files without a seek table are located by validated frame headers. Bisection
    // reads bounded windows and never decodes the preceding duration of the sample.
    let lower = anchor.offset, upper = m.size;
    const next = this.index.find(point => point.frame > firstFrame);
    if (next) upper = next.offset;
    const seekWindow = Math.min(FLAC_MAX_FRAME_BYTES, (m.maxFrameBytes || FLAC_MAX_FRAME_BYTES) * 2);
    while (firstFrame - anchor.frame > m.maxBlockFrames * 8 && upper - lower > seekWindow * 2) {
      const middle = Math.floor((lower + upper) / 2);
      const candidate = await this.findFrame(middle);
      if (!candidate || candidate.frame > firstFrame) upper = middle;
      else { anchor = candidate; lower = candidate.offset; }
    }
    let offset = anchor.offset, expected = anchor.frame, copied = 0;
    const output = new Float32Array(count * m.channels);
    while (copied < count) {
      const length = Math.min(m.maxFrameBytes || FLAC_MAX_FRAME_BYTES, FLAC_MAX_FRAME_BYTES, m.size - offset);
      if (!length) throw error('sample-format');
      const decoded = decodeFlacFrame(await this.read(offset, length), m);
      if (decoded.firstFrame !== expected) throw error('sample-format');
      const start = Math.max(firstFrame, decoded.firstFrame), end = Math.min(firstFrame + count, decoded.firstFrame + decoded.frames);
      if (end > start) {
        output.set(decoded.pcm.subarray((start - decoded.firstFrame) * m.channels, (end - decoded.firstFrame) * m.channels), (start - firstFrame) * m.channels);
        copied += end - start;
      }
      expected += decoded.frames; offset += decoded.bytesConsumed;
    }
    this.remember({ frame: expected, offset });
    return output;
  }
  remember(point) {
    if (point.frame >= this.metadata.frames || this.index.some(existing => existing.frame === point.frame)) return;
    // A bounded sparse acceleration index is independent of immutable sample identity.
    if (this.index.length >= Math.max(256, this.metadata.seekPoints.length + 1)) return;
    this.index.push(point); this.index.sort((a, b) => a.frame - b.frame);
  }
  async findFrame(offset) {
    const m = this.metadata, bytes = await this.read(offset, Math.min(FLAC_MAX_FRAME_BYTES,
      (m.maxFrameBytes || FLAC_MAX_FRAME_BYTES) * 2, m.size - offset));
    for (let at = 0; at + 6 < bytes.length; at++) {
      if (bytes[at] !== 255 || (bytes[at + 1] & 254) !== 248) continue;
      try {
        const header = readFlacFrameHeader(bytes.subarray(at), m);
        decodeFlacFrame(bytes.subarray(at), m);
        return { frame: header.firstFrame, offset: offset + at };
      } catch { /* A sync-shaped byte sequence inside a coded residual is not a frame. */ }
    }
    return null;
  }
  async readPage(pageIndex) {
    return this.readPages(pageIndex, 1);
  }
  async readPages(pageIndex, pageCount) {
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 16) throw error('sample-range');
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw error('sample-range');
    const firstFrame = pageIndex * SFZ_SAMPLE_PAGE_FRAMES;
    const frames = Math.min(SFZ_SAMPLE_PAGE_FRAMES * pageCount, this.metadata.frames - firstFrame);
    return { pageIndex, firstFrame, frames, channels: this.metadata.channels, pcm: await this.readFrames(firstFrame, frames) };
  }
}
