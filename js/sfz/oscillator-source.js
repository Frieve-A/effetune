import { SFZ_MOD_KINDS as K, SFZ_MOD_PROPERTY_IDS as P } from './modulation-schema.js';
import { resolveSfzRegionOffset } from './parser.js';

const failure = code => Object.assign(new Error('The instrument wavetable could not be prepared. Increase the sample memory limit or use a smaller waveform.'), { code });

// CONTROL-only periodic resampling. The window wraps around the complete cycle,
// unlike an audio-file resampler which pads the beginning and end with silence.
export function resizeSfzCycle(input, frames, output = new Float32Array(frames)) {
  if (input.length === frames) { output.set(input); return output; }
  const ratio = input.length / frames;
  const scale = Math.min(1, 1 / ratio), radius = 16 / scale;
  for (let frame = 0; frame < frames; frame++) {
    const position = frame * ratio;
    let sum = 0, weights = 0;
    for (let source = Math.ceil(position - radius); source <= Math.floor(position + radius); source++) {
      const distance = (source - position) * scale;
      const window = .42 + .5 * Math.cos(Math.PI * distance / 16) + .08 * Math.cos(2 * Math.PI * distance / 16);
      const weight = (distance === 0 ? 1 : Math.sin(Math.PI * distance) / (Math.PI * distance)) * window;
      sum += input[(source % input.length + input.length) % input.length] * weight;
      weights += weight;
    }
    output[frame] = sum / weights;
  }
  return output;
}

export function sfzCyclePyramidFrames(frames) {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > 0xffffffff) throw failure('prepare');
  let total = frames;
  for (let level = frames; level > 1;) {
    level = Math.ceil(level / 2);
    total += level;
  }
  if (total > 0xffffffff) throw failure('too-large');
  return total;
}

// All levels wrap the same logical cycle. Their packed lengths are derivable
// from N, so existing sample geometry carries the pyramid without a new wire.
export function prepareSfzCyclePyramid(input, frames) {
  const output = new Float32Array(sfzCyclePyramidFrames(frames));
  resizeSfzCycle(input, frames, output.subarray(0, frames));
  let mean = 0;
  for (const value of input) mean += value / input.length;
  let first = 0, length = frames;
  while (length > 1) {
    const next = Math.ceil(length / 2), at = first + length;
    if (next === 1) output[at] = mean;
    else resizeSfzCycle(output.subarray(first, at), next, output.subarray(at, at + next));
    first = at; length = next;
  }
  if (frames === 1) output[0] = mean;
  return output;
}

// One prepared cycle per distinct source/size, shared by all its voices. This
// also supports streamed banks: loadSample supplies bounded decoded pages.
export async function prepareSfzOscillatorSources(parsed, loadSample, maxBytes, { residentBytes = 0 } = {}) {
  if (parsed.sourceProfile) return { parsed, samples: new Map() };
  const samples = new Map(), identities = new Map(), regions = [...parsed.regions];
  let bytes = 0;
  for (let index = 0; index < regions.length; index++) {
    const compiled = parsed.modulation?.regions[index];
    const oscillator = compiled?.instances.findIndex(instance => instance.kind === K.Oscillator) ?? -1;
    if (oscillator < 0) continue;
    const get = property => compiled.parameters.find(parameter => parameter.instance === oscillator && parameter.property === property)?.value;
    if (!get(P.Enabled)) continue;
    const region = regions[index], requested = get(P.OscillatorTableSize);
    const identity = JSON.stringify([region.sample, requested, region.offset, region.opcodes?.offset_mode, region.end]);
    let path = identities.get(identity);
    if (!path) {
      const pcm = await loadSample(region.sample, maxBytes - bytes);
      const sourceFrames = pcm?.channels?.[0]?.length;
      const start = resolveSfzRegionOffset(region, sourceFrames), end = region.end ?? sourceFrames - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= sourceFrames) throw failure('prepare');
      const inputFrames = end - start + 1, frames = requested || inputFrames;
      if (!Number.isSafeInteger(frames) || frames < 1 || !Array.isArray(pcm.channels) || pcm.channels.length < 1 || pcm.channels.length > 2 ||
          pcm.channels.some(channel => !(channel instanceof Float32Array) || channel.length !== sourceFrames)) throw failure('prepare');
      const added = sfzCyclePyramidFrames(frames) * pcm.channels.length * 4;
      if (bytes + added + Math.max(residentBytes, sourceFrames * pcm.channels.length * 4) > maxBytes) throw failure('too-large');
      path = `*prepared-cycle:${samples.size}`;
      samples.set(path, { sampleRate: 48000, logicalFrames: frames,
        channels: pcm.channels.map(channel => prepareSfzCyclePyramid(channel.subarray(start, end + 1), frames)) });
      identities.set(identity, path);
      bytes += added;
    }
    const frames = samples.get(path).logicalFrames;
    regions[index] = { ...region, sample: path, offset: 0, end: frames - 1,
      loop_mode: 2, loop_start: 0, loop_end: frames - 1, pitch_keycenter: 60 };
  }
  return { parsed: { ...parsed, regions }, samples };
}
