import { SFZ_MOD_STORAGE as STORAGE } from './modulation-schema.js';
import { SFZ_EXTRA_DEFAULTS, SFZ_CONTROLLER_FAMILIES, sfzControllerOpcode } from './schema.js';
import { sfzError, resolveSfzRegionOffset } from './parser.js';
import { SFZ_DEFAULT_MAX_BYTES, requireSfzMaxBytes } from './limits.js';
import { SFZ_SCRIPT_PROGRAM_VERSION } from './script-format.js';
import { packSfzModulation } from './modulation.js';
import { sfzRuntimeLimitations } from './runtime-support.js';
import { effectSamplePaths, packSfzEffectModulation } from './effects-asset.js';
import { packSf2Modulation } from '../sf2/modulation.js';

export const SFZ_TABLE_VERSION = 6;
export const SFZ_MODULATION_TABLE_VERSION = 7;
export const SFZ_TABLE_HEADER_WORDS = 12;
export const SFZ_STREAM_TABLE_VERSION = 8;
export const SFZ_STREAM_TABLE_HEADER_WORDS = 16;
export const SFZ_STORAGE_TABLE_VERSION = 10;
export const SFZ_STORAGE_TABLE_HEADER_WORDS = 20;
export const SF2_TABLE_VERSION = 9;
export const SF2_TABLE_HEADER_WORDS = 18;
const HEADER_WORDS = SFZ_TABLE_HEADER_WORDS;
export const SFZ_REGION_FIELDS = Object.freeze([
  'sampleOffset', 'sampleFrames', 'channels', 'sampleRate', 'lokey', 'hikey', 'lovel', 'hivel',
  'lorand', 'hirand', 'seq_length', 'seq_position', 'seqGroup', 'pitch_keycenter',
  'pitch_keytrack', 'transpose', 'tune', 'volume', 'pan', 'amp_veltrack', 'offset', 'end',
  'loop_mode', 'loop_start', 'loop_end', 'ampeg_attack', 'ampeg_hold', 'ampeg_decay',
  'ampeg_sustain', 'ampeg_release', ...Object.keys(SFZ_EXTRA_DEFAULTS), 'controlOffset', 'controlCount'
]);
const INDEX_FIELDS = new Set(['sampleOffset', 'sampleFrames', 'offset', 'end', 'loop_start', 'loop_end', 'controlOffset', 'controlCount']);
const CONTROLLER_IDS = new Map(Object.keys(SFZ_CONTROLLER_FAMILIES).map((family, index) => [family, index]));

export function sfzAssetWarmupSamples(payload) {
  const header = new DataView(payload, 32, 32);
  const regionCount = header.getUint32(8, true);
  const words = header.getUint32(20, true);
  // Native preparation spends one operation per region in each of two table passes,
  // then hashes the whole immutable bank in32-word slices, with eight operations per frame.
  const preparationOperations = 2 * regionCount + 2 + Math.ceil(words / 32);
  return Math.ceil(preparationOperations / 8);
}

// This proof covers exactly the v6/113-lane sampler contract without scripts or
// modulation routes. Scripts can schedule future output and require a bounded drain.
// New duration or modulation lanes need review before claiming a finite export tail.
export function sfzAssetTailSeconds(payload, dataEntry = null) {
  if (!(payload instanceof ArrayBuffer) || payload.byteLength < 32 + HEADER_WORDS * 4 || payload.byteLength % 4) return null;
  const words = new Uint32Array(payload, 32), values = new Float32Array(payload, 32);
  if (words[0] !== 0x53465a || words[1] !== 6 || words[3] !== 113 || SFZ_REGION_FIELDS.length !== 113 ||
      Object.keys(SFZ_CONTROLLER_FAMILIES).length !== 26 ||
      words[9] !== 0 || words[11] !== 0 ||
      words[4] > words.length || HEADER_WORDS + words[2] * words[3] > words[4]) return null;
  const indices = Object.fromEntries(SFZ_REGION_FIELDS.map((name, index) => [name, index]));
  let initialCoarse = 0, initialFine = 0, tailSeconds = .2;
  for (let index = 0; index < words[2]; index++) {
    const base = HEADER_WORDS + index * words[3];
    const get = name => (INDEX_FIELDS.has(name) ? words : values)[base + indices[name]];
    const start = get('controlOffset'), count = get('controlCount');
    if (start < HEADER_WORDS + words[2] * words[3] || start + 2 * count > words[4]) return null;
    let pitchControllers = 0, pitchMagnitude = 0, controllerTrigger = false;
    let releaseControllers = 0, envelopeDelayControllers = 0;
    for (let cursor = start; cursor < start + 2 * count; cursor += 2) {
      const id = words[cursor], value = values[cursor + 1], family = Math.floor(id / 512), cc = id % 512;
      if (!Number.isFinite(value) || family > 25 || cc > 127) return null;
      if (family === 5) {
        pitchControllers += Math.min(0, value);
        pitchMagnitude += Math.abs(value);
      }
      if (family === 8 || family === 9) controllerTrigger = true;
      if (family === 10) envelopeDelayControllers += Math.max(0, value);
      if (family === 16) releaseControllers += Math.max(0, value);
      // The native bank initializes every channel from its first region.
      if (index === 0 && family === 2 && cc === 6) initialCoarse = value;
      if (index === 0 && family === 2 && cc === 38) initialFine = value;
    }
    const maximumRelease = Math.min(100, get('ampeg_release') + releaseControllers);
    const maximumEnvelopeDelay = Math.min(100, get('ampeg_delay') + envelopeDelayControllers);
    let tail = Math.max(maximumRelease, get('off_time'));
    const sampleTail = get('loop_mode') === 1 || get('trigger') === 1 || get('trigger') === 2 || controllerTrigger;
    if (sampleTail) {
      const looped = get('loop_mode') === 2 || get('loop_mode') === 3;
      if (looped && get('loop_count') < 0) return null;
      // Data Entry may update RPN bend range. Taking maxima regardless of RPN
      // selection overestimates safely, including initial CC6/38 and resets.
      const bendRange = dataEntry ? Math.max(2, Math.max(initialCoarse, dataEntry.coarse) +
        Math.max(initialFine, dataEntry.fine) * .01) : 2;
      const key = Math.min((get('lokey') - get('pitch_keycenter')) * get('pitch_keytrack'),
        (get('hikey') - get('pitch_keycenter')) * get('pitch_keytrack'),
        controllerTrigger ? (60 - get('pitch_keycenter')) * get('pitch_keytrack') : Infinity);
      const velocity = Math.min(get('pitch_veltrack') * get('lovel') / 127,
        get('pitch_veltrack') * get('hivel') / 127);
      const bend = Math.min(0, get('bend_down'), get('bend_up')) * bendRange / 2;
      let cents = key + get('transpose') * 100 + get('tune') + velocity - Math.abs(get('pitch_random')) +
        pitchControllers + bend + Math.min(0, get('pitcheg_depth')) - Math.abs(get('pitchlfo_depth'));
      // Outward allowance for the native float32 pitch sums and exp2 rounding.
      const magnitude = Math.abs(key) + Math.abs(get('transpose') * 100) + Math.abs(get('tune')) +
        Math.abs(velocity) + Math.abs(get('pitch_random')) + pitchMagnitude + Math.abs(bend) +
        Math.abs(get('pitcheg_depth')) + Math.abs(get('pitchlfo_depth'));
      cents -= 1 + magnitude * 512 * 2 ** -23;
      const frames = get('end') - get('offset') + 2 + (looped ? Math.max(0, get('loop_count')) *
        (get('loop_end') - get('loop_start') + 1) : 0);
      tail = Math.max(tail, frames / get('sampleRate') / 2 ** (cents / 1200));
    }
    tail += get('delay') + get('delay_random') + maximumEnvelopeDelay;
    if (!Number.isFinite(tail) || tail < 0) return null;
    tailSeconds = Math.max(tailSeconds, tail);
  }
  return tailSeconds;
}

export function sfzSampleCacheFootprint(sampleCount, cacheSlots, channels = 2, storage = null) {
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 10000 ||
      !Number.isInteger(cacheSlots) || cacheSlots < 1 || cacheSlots > 32768 ||
      (channels !== 1 && channels !== 2) ||
      (storage && (!Number.isInteger(storage.slots16) || storage.slots16 < 0 || storage.slots16 > cacheSlots))) throw sfzError('prepare', 'Invalid SFZ sample cache capacity.');
  let buckets = 1;
  while (buckets < cacheSlots * STORAGE.CacheHashLoad) buckets *= 2;
  const slots16 = storage?.slots16 ?? 0;
  return STORAGE.CachePageFrames * channels * ((cacheSlots - slots16) * Float32Array.BYTES_PER_ELEMENT + slots16 * Int16Array.BYTES_PER_ELEMENT) +
    cacheSlots * STORAGE.CachePageBytes + buckets * Uint32Array.BYTES_PER_ELEMENT +
    sampleCount * (2 * STORAGE.CacheSampleMetadataBytes + (storage ? 2 * STORAGE.CacheModeBytes : 0)) +
    STORAGE.CacheRequestCapacity * STORAGE.CacheRequestBytes +
    cacheSlots * STORAGE.CacheForecastPageBytes +
    STORAGE.CacheForecastSourceBytes * STORAGE.CacheForecastSourceCapacity;
}

export function sfzRequiresSampleStreaming(regions) {
  return regions.some(region => region.load_mode !== undefined ||
    region.load_start !== undefined || region.load_end !== undefined);
}

export function packStreamedSfzAsset(regions, samples, { cacheSlots, storagePlan = null, ...options } = {}) {
  return packSfzAsset(regions, samples, { ...options, stream: { cacheSlots, storagePlan } });
}

export function packSfzAsset(regions, samples, { maxBytes = SFZ_DEFAULT_MAX_BYTES, onWarning, script = null,
  stream = null, modulation = null, effects = null, sourceProfile = null, presets = null,
  preparationContext = null,
  onDiagnostic = detail => console.warn('SFZ sample preparation:', detail) } = {}) {
  requireSfzMaxBytes(maxBytes);
  if (!stream && sfzRequiresSampleStreaming(regions))
    throw sfzError('prepare', 'This instrument needs sample streaming, which is unavailable in this audio configuration.');
  const soundFont = sourceProfile !== null;
  const genericModulation = !soundFont && modulation?.version === 3;
  if (soundFont && (!stream || !['sf2-2.00', 'sf2-2.01', 'sf2-2.04', 'sf3-3.00', 'sf3-3.01', 'sf3-3.04'].includes(sourceProfile) || !Array.isArray(presets))) {
    throw sfzError('prepare', 'The SoundFont collection could not be prepared.');
  }
  const storagePlan = !soundFont && stream?.storagePlan;
  const headerWords = storagePlan ? SFZ_STORAGE_TABLE_HEADER_WORDS : soundFont ? SF2_TABLE_HEADER_WORDS : stream ? SFZ_STREAM_TABLE_HEADER_WORDS : HEADER_WORDS;
  const scriptBytes = script?.bytes ?? new Uint8Array();
  if (!(scriptBytes instanceof Uint8Array) || scriptBytes.byteLength % 4 ||
      (script && (script.version !== SFZ_SCRIPT_PROGRAM_VERSION || scriptBytes.byteLength < 64 || scriptBytes.byteLength > 64 + 128 * 16 + 512 * 144 + 8192 * 16))) {
    throw sfzError('prepare', 'The instrument script could not be prepared.');
  }
  if (!regions.length) throw sfzError('no-regions', 'The SFZ has no playable regions.');
  const impulsePaths = effectSamplePaths(effects);
  let samplePaths = [...new Set([...regions.map(region => region.sample), ...impulsePaths])].sort();
  const sampleInfo = new Map();
  let poolLength = 0;
  for (const path of samplePaths) {
    const pcm = samples.get(path);
    if (stream) {
      if (!Number.isSafeInteger(pcm?.frames) || pcm.frames < 1 || (pcm.channels !== 1 && pcm.channels !== 2) ||
          !Number.isInteger(pcm.sampleRate) || pcm.sampleRate < 1 || pcm.sampleRate > 768000 || !/^[a-f0-9]{64}$/.test(pcm.revision)) {
        throw sfzError('prepare', 'The SFZ sample metadata could not be prepared.');
      }
      sampleInfo.set(path, { sampleFrames: pcm.frames, channels: pcm.channels, sampleRate: pcm.sampleRate });
      continue;
    }
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
  const playableIndices = [];
  const invalidRegions = [];
  let firstInvalid;
  let ignoredLoopPoints = 0;
  for (const [regionIndex, region] of regions.entries()) {
    const info = sampleInfo.get(region.sample);
    const end = region.end ?? info.sampleFrames - 1;
    const normalized = { ...SFZ_EXTRA_DEFAULTS, ...region, ...info, end, loop_end: region.loop_end ?? end, controlOffset: 0, controlCount: 0 };
    if (!soundFont) normalized.offset = resolveSfzRegionOffset(region, info.sampleFrames);
    if (!soundFont && normalized.loop_count > 16777216) normalized.loop_count = -1;
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
      playableIndices.push(regionIndex);
    } catch (error) {
      if (error?.code !== 'prepare') throw error;
      firstInvalid ??= error;
      invalidRegions.push(`${region.sample}: ${error.message}`);
    }
  }
  if (invalidRegions.length) onDiagnostic?.({ invalidRegions });
  if (soundFont && invalidRegions.length) throw firstInvalid;
  if (!playable.length) throw firstInvalid;
  regions = playable;
  if (!soundFont) {
    // Exclusive groups are identities, not numerical magnitudes. Compact tokens
    // preserve all signed 32-bit authored IDs in the existing exact float lane.
    const ids = [...new Set(regions.flatMap(region => [region.group, region.off_by]).filter(id => id !== 0))].sort((a, b) => a - b);
    if (ids.length > 16777216) throw sfzError('too-large', 'The instrument has too many exclusive groups.');
    const tokens = new Map(ids.map((id, index) => [id, index + 1]));
    regions = regions.map(region => ({ ...region, group: tokens.get(region.group) ?? 0, off_by: tokens.get(region.off_by) ?? 0 }));
  }
  // Streaming sample IDs match the captured provider's complete sorted list,
  // including samples whose regions fail sample-aware validation.
  if (!stream) samplePaths = [...new Set([...regions.map(region => region.sample), ...impulsePaths])].sort();
  for (const [sampleIndex, path] of samplePaths.entries()) {
    const info = sampleInfo.get(path);
    info.sampleOffset = stream ? sampleIndex : poolLength;
    if (!stream) poolLength += info.sampleFrames * info.channels;
  }
  const groupIds = [...new Set(regions.map(region => region.seqGroup))].sort((a, b) => a - b);
  const groupCount = groupIds.length;
  const groups = new Map(groupIds.map((id, index) => [id, index]));
  const controls = regions.map(region => {
    const entries = [];
    for (const [key, value] of Object.entries(region)) {
      const route = sfzControllerOpcode(key);
      if (!route || value === SFZ_CONTROLLER_FAMILIES[route.family]) continue;
      if (genericModulation && !['locc', 'hicc', 'set_cc', 'on_locc', 'on_hicc'].includes(route.family)) continue;
      if (!Number.isFinite(value)) throw sfzError('prepare', 'SFZ controller has an invalid value.');
      entries.push([CONTROLLER_IDS.get(route.family) * 512 + route.controller, value]);
    }
    return entries.sort((a, b) => a[0] - b[0]);
  });
  const controlWords = controls.reduce((sum, entries) => sum + 2 * entries.length, 0);
  const controlOffset = headerWords + SFZ_REGION_FIELDS.length * regions.length;
  const scriptOffset = controlOffset + controlWords;
  let modulationBytes = soundFont ? packSf2Modulation(modulation) : modulation ? packSfzModulation({ ...modulation,
    regions: playableIndices.map(index => modulation.regions[index]) }) : new Uint8Array();
  if (effects) {
    if (soundFont || !genericModulation) throw sfzError('prepare', 'The instrument effects could not be prepared.');
    modulationBytes = packSfzEffectModulation(modulationBytes, { ...effects,
      regions: playableIndices.map(index => effects.regions[index]) }, path => {
      const info = sampleInfo.get(path);
      return info && { sampleOffsetOrId: info.sampleOffset, frames: info.sampleFrames,
        channels: info.channels, rate: info.sampleRate };
    });
  }
  const modulationOffset = scriptOffset + scriptBytes.byteLength / 4;
  const sampleTableOffset = modulationOffset + modulationBytes.byteLength / 4;
  const sampleWords = storagePlan ? 16 : 12;
  const residentRows = storagePlan ? samplePaths.flatMap(path => storagePlan.residentRanges.get(path)) : [];
  const residentOffset = sampleTableOffset + (stream ? samplePaths.length * sampleWords : 0);
  const presetOffset = residentOffset + residentRows.length * 4;
  if (storagePlan && (!Number.isInteger(storagePlan.slots16) || storagePlan.slots16 < 0 || storagePlan.slots16 > stream.cacheSlots))
    throw sfzError('prepare', 'Invalid instrument sample storage capacity.');
  const poolOffset = presetOffset + (soundFont ? presets.length * 4 : 0);
  const floatCount = poolOffset + poolLength;
  const byteLength = 32 + floatCount * 4;
  const sampleCacheBytes = stream ? sfzSampleCacheFootprint(samplePaths.length, stream.cacheSlots,
    samplePaths.some(path => sampleInfo.get(path).channels === 2) ? 2 : 1, storagePlan) : 0;
  // This is only the compiled image extent. Target-native preparation owns all
  // index, modulation, cache, forecast and effect allocation accounting.
  const footprintBytes = byteLength;
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
  integers.set([0x53465a, storagePlan ? SFZ_STORAGE_TABLE_VERSION : soundFont ? SF2_TABLE_VERSION : stream ? SFZ_STREAM_TABLE_VERSION : genericModulation ?
    SFZ_MODULATION_TABLE_VERSION : SFZ_TABLE_VERSION, regions.length, SFZ_REGION_FIELDS.length,
    poolOffset, floatCount, groupCount, controlWords, scriptOffset, scriptBytes.byteLength,
    modulationBytes.length ? modulationOffset : 0, modulationBytes.length / 4]);
  if (stream) integers.set([sampleTableOffset, samplePaths.length, stream.cacheSlots, soundFont ? 0x10001 : storagePlan ? 2 : 1], 12);
  if (storagePlan) integers.set([storagePlan.slots16, residentOffset, residentRows.length, 0], 16);
  if (soundFont) {
    integers.set([presetOffset, presets.length], 16);
    for (const [index, preset] of presets.entries()) {
      const row = [preset.bank, preset.program, preset.firstRegion, preset.regionCount];
      if (row.some(value => !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) ||
          preset.firstRegion + preset.regionCount > regions.length) throw sfzError('prepare', 'Invalid SoundFont preset directory.');
      integers.set(row, presetOffset + index * 4);
    }
  }
  new Uint8Array(payload, 32 + scriptOffset * 4, scriptBytes.byteLength).set(scriptBytes);
  new Uint8Array(payload, 32 + modulationOffset * 4, modulationBytes.byteLength).set(modulationBytes);
  let nextControl = controlOffset;
  for (const [index, region] of regions.entries()) {
    const info = sampleInfo.get(region.sample);
    const normalized = { ...region, ...info, seqGroup: groups.get(region.seqGroup),
      controlOffset: nextControl, controlCount: controls[index].length };
    for (const [id, value] of controls[index]) {
      integers[nextControl++] = id;
      packed[nextControl++] = value;
    }
    for (const [field, key] of SFZ_REGION_FIELDS.entries()) {
      const offset = headerWords + index * SFZ_REGION_FIELDS.length + field;
      if (INDEX_FIELDS.has(key)) integers[offset] = normalized[key];
      else packed[offset] = normalized[key];
    }
  }
  let residentCursor = 0;
  for (const path of samplePaths) {
    const pcm = samples.get(path);
    const info = sampleInfo.get(path);
    if (stream) {
      const offset = sampleTableOffset + info.sampleOffset * sampleWords;
      integers.set([pcm.frames >>> 0, Math.floor(pcm.frames / 0x100000000), pcm.channels, pcm.sampleRate], offset);
      new Uint8Array(payload, 32 + (offset + 4) * 4, 32).set(pcm.revision.match(/../g).map(byte => parseInt(byte, 16)));
      if (storagePlan) {
        const mode = pcm.storageMode ?? 0, intervals = storagePlan.residentRanges.get(path);
        if (![0, 1].includes(mode) || (mode ? !storagePlan.slots16 : storagePlan.slots16 === stream.cacheSlots))
          throw sfzError('prepare', 'Invalid instrument sample storage format.');
        integers.set([mode, residentCursor, intervals.length, 0], offset + 12);
        let previous = -1;
        for (const [first, end] of intervals) {
          if (!Number.isSafeInteger(first) || !Number.isSafeInteger(end) || first < 0 || first <= previous || first >= end || end > pcm.frames)
            throw sfzError('prepare', 'Invalid instrument sample residency range.');
          integers.set([first >>> 0, Math.floor(first / 0x100000000), end >>> 0, Math.floor(end / 0x100000000)], residentOffset + residentCursor++ * 4);
          previous = end;
        }
      }
      continue;
    }
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
  return { ...(stream && { sampleCacheBytes }), payload, warmupSamples: sfzAssetWarmupSamples(payload), tailSeconds: sfzAssetTailSeconds(payload),
    unsupportedRuntime: soundFont ? [] : sfzRuntimeLimitations(modulation, effects),
    channels: 1, samples: floatCount, sampleRate: 1, layout: 0, formatTag: 1,
    rateDivider: 1, headBlock: 128, processingChannels: preparationContext?.processingChannels ?? 1, footprintBytes,
    ...(preparationContext && { preparationContext }) };
}
