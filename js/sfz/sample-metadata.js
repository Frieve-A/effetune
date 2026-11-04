import { sfzError } from './parser.js';
import { compileSfzModulation } from './modulation.js';
import { isSfzGenerator } from './generators.js';

// Read chunk descriptors and the first published WAVE sampler loop, never PCM.
export async function readSfzWaveLoop(reader, maxBytes) {
  if (reader.size < 12) return null;
  let consumed = 0;
  const read = async (offset, length) => {
    consumed += length;
    if (consumed > maxBytes) throw sfzError('too-large', 'The sample metadata exceeds the instrument size limit.');
    const bytes = await reader.readRange(offset, length);
    if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw sfzError('prepare', 'The sample metadata could not be read.');
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  };
  const header = await read(0, 12);
  if (header.getUint32(0, false) !== 0x52494646 || header.getUint32(8, false) !== 0x57415645) return null;
  const end = header.getUint32(4, true) + 8;
  if (end > reader.size || end < 12) throw sfzError('prepare', 'The WAVE sample has invalid metadata.');
  for (let offset = 12; offset + 8 <= end;) {
    const chunk = await read(offset, 8), size = chunk.getUint32(4, true), data = offset + 8;
    if (data + size > end) throw sfzError('prepare', 'The WAVE sample has an incomplete metadata chunk.');
    if (chunk.getUint32(0, false) === 0x736d706c && size >= 36) {
      const sampler = await read(data, Math.min(60, size));
      if (sampler.getUint32(28, true) > 0) {
        if (size < 60) throw sfzError('prepare', 'The WAVE sample has an incomplete loop definition.');
        const type = sampler.getUint32(40, true);
        if (type > 2) throw sfzError('prepare', 'The WAVE sample uses an unsupported loop direction.');
        return { start: sampler.getUint32(44, true), end: sampler.getUint32(48, true),
          type: ['forward', 'alternate', 'backward'][type], plays: sampler.getUint32(56, true) };
      }
    }
    offset = data + size + (size & 1);
  }
  return null;
}

export function applySfzLoopMetadata(parsed, loops) {
  if (parsed.sourceProfile || ![...loops.values()].some(Boolean)) return parsed;
  const correction = parsed.headers?.filter(header => header.name === 'control')
    .reduce((value, header) => header.opcodes.loop_end_offset === undefined ? value : Number(header.opcodes.loop_end_offset), 0) ?? 0;
  const regions = parsed.regions.map(region => {
    const loop = loops.get(region.sample);
    if (!loop) return region;
    const opcodes = { ...region.opcodes }, result = { ...region, opcodes };
    if (opcodes.loop_start === undefined) result.loop_start = loop.start + correction;
    if (opcodes.loop_end === undefined) result.loop_end = loop.end + correction;
    if (opcodes.loop_mode === undefined) result.loop_mode = Number(opcodes.count) > 0 ? 1 : 2;
    if (result.loop_mode >= 2 && opcodes.loop_count === undefined && loop.plays > 0) {
      result.loop_count = loop.plays - 1;
      opcodes.loop_count = String(result.loop_count);
    }
    if (result.loop_mode >= 2 && opcodes.loop_type === undefined && loop.type !== 'forward') opcodes.loop_type = loop.type;
    return result;
  });
  return { ...parsed, regions, modulation: compileSfzModulation(regions, parsed.headers) };
}

export async function prepareSfzLoopMetadata(parsed, createReader, maxBytes) {
  if (parsed.sourceProfile) return parsed;
  const loops = new Map();
  for (const path of new Set(parsed.regions.map(region => region.sample))) {
    if (!isSfzGenerator(path)) loops.set(path, await readSfzWaveLoop(await createReader(path), maxBytes));
  }
  return applySfzLoopMetadata(parsed, loops);
}
