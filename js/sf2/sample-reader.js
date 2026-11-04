// Creative/E-mu SoundFont2.04 specification, sections6.1 and6.2:
// https://musescore.org/sites/musescore.org/files/2023-01/sfspec24.pdf
// The container parser validates RIFF/sfbk and chooses sm24 only when its
// declared version and complete chunk length satisfy the specification.
export function createSf2SampleReader(reader, { start, frames, sampleRate, smplOffset, sm24Offset = null }) {
  if (!reader || !Number.isSafeInteger(reader.size) || typeof reader.readRange !== 'function' ||
      !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(frames) || frames < 1 ||
      !Number.isSafeInteger(smplOffset) || smplOffset < 0 ||
      !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 768000 ||
      sm24Offset !== null && (!Number.isSafeInteger(sm24Offset) || sm24Offset < 0)) throw new RangeError('Invalid SoundFont sample range');
  const dataOffset = smplOffset + start * 2, lowByteOffset = sm24Offset === null ? null : sm24Offset + start;
  const end = dataOffset + frames * 2, lowEnd = lowByteOffset === null ? 0 : lowByteOffset + frames;
  if (!Number.isSafeInteger(end) || end > reader.size || !Number.isSafeInteger(lowEnd) || lowEnd > reader.size) {
    throw new RangeError('SoundFont sample exceeds its source');
  }
  const pcm = Object.freeze({ format: 'sf2-pcm', channels: 1, frames, sampleRate, dataOffset, lowByteOffset });
  return Object.freeze({ size: reader.size, pcm, rangeSource: reader.rangeSource, openRangePort: reader.openRangePort, revision: `${reader.revision}:${JSON.stringify(pcm)}`,
    readRange: (offset, length) => reader.readRange(offset, length) });
}

export function createSf3SampleReader(reader, { start, frames, sampleRate, compressed }) {
  const pcm = Object.freeze({ format: 'sf3-vorbis', channels: 1, ...compressed, frames, sampleRate, firstFrame: start,
    sourceFrames: compressed.frames });
  return Object.freeze({ size: reader.size, pcm, rangeSource: reader.rangeSource,
    openRangePort: reader.openRangePort, revision: `${reader.revision}:${JSON.stringify(pcm)}`,
    readRange: (offset, length) => reader.readRange(offset, length) });
}
