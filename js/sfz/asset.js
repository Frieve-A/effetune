import { sfzError } from './parser.js';
import { SFZ_DEFAULT_MAX_BYTES, requireSfzMaxBytes } from './limits.js';

export const SFZ_TABLE_VERSION = 2;
export const SFZ_REGION_FIELDS = Object.freeze([
  'sampleOffset', 'sampleFrames', 'channels', 'sampleRate', 'lokey', 'hikey', 'lovel', 'hivel',
  'lorand', 'hirand', 'seq_length', 'seq_position', 'seqGroup', 'pitch_keycenter',
  'pitch_keytrack', 'transpose', 'tune', 'volume', 'pan', 'amp_veltrack', 'offset', 'end',
  'loop_mode', 'loop_start', 'loop_end', 'ampeg_attack', 'ampeg_hold', 'ampeg_decay',
  'ampeg_sustain', 'ampeg_release'
]);
const INDEX_FIELDS = new Set(['sampleOffset', 'sampleFrames', 'offset', 'end', 'loop_start', 'loop_end']);

export function sfzAssetWarmupSamples(payload) {
  const header = new DataView(payload, 32, 32);
  const regionCount = header.getUint32(8, true);
  const poolLength = header.getUint32(20, true) - header.getUint32(16, true);
  // Native preparation spends one operation per region in each of two table passes,
  // then one operation per 32 PCM words, with eight operations per audio frame.
  const preparationOperations = 2 * regionCount + 2 + Math.ceil(poolLength / 32);
  return Math.ceil(preparationOperations / 8);
}

export function packSfzAsset(regions, samples, { maxBytes = SFZ_DEFAULT_MAX_BYTES, onWarning,
  onDiagnostic = detail => console.warn('SFZ sample preparation:', detail) } = {}) {
  requireSfzMaxBytes(maxBytes);
  if (!regions.length) throw sfzError('no-regions', 'The SFZ has no playable regions.');
  let samplePaths = [...new Set(regions.map(region => region.sample))].sort();
  const sampleInfo = new Map();
  let poolLength = 0;
  for (const path of samplePaths) {
    const pcm = samples.get(path);
    const channels = pcm?.channels;
    const frames = channels?.[0]?.length;
    if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2 || !frames ||
        channels.some(channel => !(channel instanceof Float32Array) || channel.length !== frames) ||
        !Number.isSafeInteger(pcm.sampleRate) || pcm.sampleRate < 1 || pcm.sampleRate > 768000) {
      throw sfzError('prepare', 'SFZ samples must contain mono or stereo audio.');
    }
    sampleInfo.set(path, { sampleFrames: frames, channels: channels.length, sampleRate: pcm.sampleRate });
  }
  const playable = [];
  const invalidRegions = [];
  let firstInvalid;
  let ignoredLoopPoints = 0;
  for (const region of regions) {
    const info = sampleInfo.get(region.sample);
    const end = region.end ?? info.sampleFrames - 1;
    const normalized = { ...region, ...info, end, loop_end: region.loop_end ?? end };
    try {
      if (normalized.offset > end || end >= info.sampleFrames || end < 0) {
        throw sfzError('prepare', 'SFZ playback points exceed the sample.');
      }
      const invalidLoop = normalized.loop_start < 0 || normalized.loop_start > normalized.loop_end ||
        normalized.loop_end > end;
      if (invalidLoop && (normalized.loop_mode === 0 || normalized.loop_mode === 1)) {
        normalized.loop_start = 0;
        normalized.loop_end = end;
      } else if (invalidLoop) throw sfzError('prepare', 'SFZ loop points exceed the sample.');
      for (const key of SFZ_REGION_FIELDS) {
        if (key === 'sampleOffset') continue;
        const value = normalized[key];
        if (!Number.isFinite(value)) throw sfzError('prepare', 'SFZ region has invalid values.');
        if (INDEX_FIELDS.has(key) && (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)) {
          throw sfzError('prepare', 'SFZ sample positions must be non-negative integers.');
        }
      }
      if (invalidLoop) ignoredLoopPoints++;
      playable.push(normalized);
    } catch (error) {
      if (error?.code !== 'prepare') throw error;
      firstInvalid ??= error;
      invalidRegions.push(`${region.sample}: ${error.message}`);
    }
  }
  if (invalidRegions.length) onDiagnostic?.({ invalidRegions });
  if (!playable.length) throw firstInvalid;
  regions = playable;
  samplePaths = [...new Set(regions.map(region => region.sample))].sort();
  for (const path of samplePaths) {
    const info = sampleInfo.get(path);
    info.sampleOffset = poolLength;
    poolLength += info.sampleFrames * info.channels;
  }
  const groupIds = [...new Set(regions.map(region => region.seqGroup))].sort((a, b) => a - b);
  const groupCount = groupIds.length;
  const groups = new Map(groupIds.map((id, index) => [id, index]));
  const poolOffset = 8 + SFZ_REGION_FIELDS.length * regions.length;
  const floatCount = poolOffset + poolLength;
  const byteLength = 32 + floatCount * 4;
  const indexEntries = regions.reduce((sum, region) => sum + region.hikey - region.lokey + 1, 0);
  const footprintBytes = byteLength + 4 * (129 + 2 * groupCount + indexEntries);
  if (!Number.isSafeInteger(footprintBytes) || footprintBytes > maxBytes) {
    throw sfzError('too-large', 'The SFZ samples are too large to load.');
  }
  const payload = new ArrayBuffer(byteLength);
  const outer = new DataView(payload);
  outer.setUint32(0, 0x31415445, true);
  outer.setUint32(4, 1, true);
  outer.setUint32(8, floatCount, true);
  outer.setUint32(12, 1, true);
  const packed = new Float32Array(payload, 32);
  const integers = new Uint32Array(payload, 32);
  // The header and sample indices are uint32 bit lanes, never numeric float conversions.
  integers.set([0x53465a, SFZ_TABLE_VERSION, regions.length, SFZ_REGION_FIELDS.length,
    poolOffset, floatCount, groupCount, 0]);
  for (const [index, region] of regions.entries()) {
    const info = sampleInfo.get(region.sample);
    const normalized = { ...region, ...info, seqGroup: groups.get(region.seqGroup) };
    for (const [field, key] of SFZ_REGION_FIELDS.entries()) {
      const offset = 8 + index * SFZ_REGION_FIELDS.length + field;
      if (INDEX_FIELDS.has(key)) integers[offset] = normalized[key];
      else packed[offset] = normalized[key];
    }
  }
  for (const path of samplePaths) {
    const pcm = samples.get(path);
    const info = sampleInfo.get(path);
    let cursor = poolOffset + info.sampleOffset;
    for (let frame = 0; frame < info.sampleFrames; frame++) {
      for (const channel of pcm.channels) {
        const value = channel[frame];
        if (!Number.isFinite(value)) throw sfzError('prepare', 'SFZ audio contains invalid samples.');
        packed[cursor++] = value;
      }
    }
  }
  if (ignoredLoopPoints) onWarning?.({ code: 'loop-points-ignored', count: ignoredLoopPoints });
  if (invalidRegions.length) onWarning?.({ code: 'invalid-regions', count: invalidRegions.length });
  return { payload, warmupSamples: sfzAssetWarmupSamples(payload),
    channels: 1, samples: floatCount, sampleRate: 1, layout: 0, formatTag: 1,
    rateDivider: 1, headBlock: 128, processingChannels: 1, footprintBytes };
}
