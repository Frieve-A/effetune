import { sfzError } from './parser.js';
import { effectSamplePaths } from './effects-asset.js';

const PAGE = 4096;
const pcm16Key = path => `\0sfz-pcm16-v1:${path}`;

// Source coordinates never change. Only the cache identity/format changes.
export function sfzStorageVariants(parsed, cycles = new Set()) {
  const sources = new Map(), modes = new Map();
  const add = (path, mode) => {
    const key = mode === 1 ? pcm16Key(path) : path;
    sources.set(key, path); modes.set(key, mode);
    return key;
  };
  const regions = parsed.regions.map(region => ({ ...region,
    sample: add(region.sample, region.load_mode ?? 0) }));
  for (const path of effectSamplePaths(parsed.effects)) add(path, 0);
  const paths = [...sources.keys()].sort();
  const mandatory = new Set(paths.filter(path => cycles.has(sources.get(path)) ||
    effectSamplePaths(parsed.effects).includes(path)));
  return { parsed: { ...parsed, regions }, paths, sources, modes, mandatory };
}

// Clamp in f64 before writing u64. Authored end is inclusive; omission streams.
export function sfzResidentRanges(regions, samples, mandatory = new Set()) {
  const ranges = new Map([...samples.keys()].map(path => [path, []]));
  for (const path of mandatory) ranges.get(path).push([0, samples.get(path).frames]);
  for (const region of regions) {
    if (region.load_start === undefined && region.load_end === undefined) continue;
    const frames = samples.get(region.sample).frames;
    const rawFirst = region.load_start ?? 0, rawEnd = region.load_end === undefined ? frames : region.load_end + 1;
    if (rawFirst > rawEnd) throw sfzError('prepare', 'The instrument sample loading range is invalid.');
    const first = Math.min(frames, rawFirst), end = Math.min(frames, rawEnd);
    if (first < end) ranges.get(region.sample).push([
      Math.floor(first / PAGE) * PAGE, Math.min(frames, Math.ceil(end / PAGE) * PAGE)]);
  }
  for (const [path, intervals] of ranges) {
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [first, end] of intervals) {
      const last = merged.at(-1);
      if (last && first <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([first, end]);
    }
    ranges.set(path, merged);
  }
  return ranges;
}

export function sfzStorageSlots(total, samples, ranges) {
  let required16 = 0, required32 = 0, count16 = 0, count32 = 0;
  for (const [path, sample] of samples) {
    const pages = ranges.get(path).reduce((sum, [first, end]) => sum + Math.ceil(end / PAGE) - Math.floor(first / PAGE), 0);
    if (sample.storageMode === 1) { count16++; required16 += pages; }
    else { count32++; required32 += pages; }
  }
  // Keep one transient slot per present format in addition to pinned windows.
  const minimum16 = required16 + (count16 ? 1 : 0), minimum32 = required32 + (count32 ? 1 : 0);
  if (total < minimum16 + minimum32) return null;
  const slots16 = !count16 ? 0 : !count32 ? total
    : Math.max(minimum16, Math.min(total - minimum32, Math.round(total * count16 / (count16 + count32))));
  return { cacheSlots: total, slots16, residentRanges: ranges, minimumSlots: minimum16 + minimum32 };
}
