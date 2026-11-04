import { parseSf2, sf2Error } from './parser.js';
import { compileSf2 } from './compiler.js';
import { createSf2SampleReader, createSf3SampleReader } from './sample-reader.js';
import { readOggVorbisMetadata } from './ogg-vorbis.js';

export async function openSf2Source(reader) {
  const parsed = await parseSf2(reader);
  for (const sample of parsed.tables.shdr.slice(0, -1)) {
    if (!(sample.sampleType & 0x10)) {
      if (parsed.sm24Offset !== null && sample.end > parsed.sm24Bytes) throw sf2Error('Incomplete PCM low-byte pool');
      continue;
    }
    if (parsed.version.major !== 3 || sample.start >= sample.end || sample.end > parsed.smplBytes) throw sf2Error('Invalid compressed sample bounds');
    const dataOffset = parsed.smplOffset + sample.start, dataBytes = Math.min(sample.end + 1, parsed.smplBytes) - sample.start;
    const metadata = await readOggVorbisMetadata((offset, length) => reader.readRange(dataOffset + offset, length), dataBytes);
    if (metadata.sampleRate !== sample.sampleRate) throw sf2Error('Compressed sample rate differs from SHDR');
    sample.compressed = { dataOffset, dataBytes: metadata.endOffset, frames: metadata.frames };
    sample.start = 0; sample.end = metadata.frames;
  }
  const compiled = compileSf2(parsed), views = new Map();
  // A sample has one stable provider entry across the complete collection, even
  // when different zones change its start/end addresses. Linked stereo samples
  // remain individual mono sources, as authored by the instrument zones.
  for (const region of compiled.regions) {
    const { sampleId, sample } = region;
    const view = views.get(sampleId);
    if (view) { view.start = Math.min(view.start, sample.start); view.end = Math.max(view.end, sample.end); }
    else views.set(sampleId, { sampleId, start: sample.start, end: sample.end, sampleRate: sample.sampleRate,
      ...(sample.compressed && { compressed: sample.compressed }) });
  }
  const samples = [...views.values()].sort((a, b) => a.sampleId - b.sampleId).map(view =>
    Object.freeze({ ...view, path: `sample:${String(view.sampleId).padStart(5, '0')}`, frames: view.end - view.start }));
  const byPath = new Map(samples.map(sample => [sample.path, sample]));
  return { parsed, compiled, samples, sourceBytes: reader.size, createSampleReader(path) {
    const sample = byPath.get(path);
    if (!sample) throw new RangeError('Unknown SoundFont sample');
    return sample.compressed ? createSf3SampleReader(reader, sample)
      : createSf2SampleReader(reader, { ...sample, smplOffset: parsed.smplOffset, sm24Offset: parsed.sm24Offset });
  } };
}
