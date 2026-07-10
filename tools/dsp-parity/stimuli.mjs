const MASK_64 = (1n << 64n) - 1n;
const FLOAT53_DENOMINATOR = 2 ** 53;

export const DEFAULT_NOISE_SEED = 0xEFFE7A5En;
export const STIMULUS_IDS = Object.freeze([
  'imp',
  'sin1k',
  'sweep',
  'noise',
  'sq50',
  'silence',
  'fs',
  'step'
]);

export class XorShift64 {
  constructor(seed = DEFAULT_NOISE_SEED) {
    const normalized = BigInt(seed) & MASK_64;
    this.state = normalized === 0n ? DEFAULT_NOISE_SEED : normalized;
  }

  nextUint64() {
    let value = this.state;
    value ^= (value << 13n) & MASK_64;
    value ^= value >> 7n;
    value ^= (value << 17n) & MASK_64;
    this.state = value & MASK_64;
    return this.state;
  }

  nextFloat() {
    return Number(this.nextUint64() >> 11n) / FLOAT53_DENOMINATOR;
  }

  nextBipolar() {
    return this.nextFloat() * 2 - 1;
  }
}

export function noiseSeedForCase(caseIndex = 0) {
  if (!Number.isSafeInteger(caseIndex) || caseIndex < 0) {
    throw new TypeError(`caseIndex must be a non-negative safe integer, received ${caseIndex}`);
  }
  return DEFAULT_NOISE_SEED ^ BigInt(caseIndex);
}

function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer, received ${value}`);
  }
}

function fillChannel(output, channel, frames, valueAt) {
  const offset = channel * frames;
  for (let frame = 0; frame < frames; frame++) {
    output[offset + frame] = valueAt(frame, channel);
  }
}

export function generateStimulus({
  id,
  sampleRate = 48000,
  frames = sampleRate,
  channels = 2,
  caseIndex = 0,
  seed = noiseSeedForCase(caseIndex)
}) {
  if (!STIMULUS_IDS.includes(id)) {
    throw new Error(`Unknown DSP parity stimulus "${id}". Expected one of: ${STIMULUS_IDS.join(', ')}`);
  }
  assertPositiveInteger('sampleRate', sampleRate);
  assertPositiveInteger('frames', frames);
  assertPositiveInteger('channels', channels);

  const output = new Float32Array(frames * channels);
  const minusSixDb = 10 ** (-6 / 20);
  const minusTwelveDb = 10 ** (-12 / 20);
  const minusThreeDb = 10 ** (-3 / 20);

  if (id === 'silence') return output;

  if (id === 'imp') {
    for (let channel = 0; channel < channels; channel++) {
      output[channel * frames] = 1;
      const staggered = 1000 + channel;
      if (staggered < frames) output[channel * frames + staggered] = 1;
    }
    return output;
  }

  if (id === 'noise') {
    const rng = new XorShift64(seed);
    for (let index = 0; index < output.length; index++) {
      output[index] = rng.nextBipolar();
    }
    return output;
  }

  for (let channel = 0; channel < channels; channel++) {
    if (id === 'sin1k') {
      fillChannel(output, channel, frames, frame =>
        Math.sin(2 * Math.PI * 1000 * frame / sampleRate) * minusSixDb
      );
    } else if (id === 'sweep') {
      const duration = frames / sampleRate;
      const startHz = 20;
      const endHz = Math.min(20000, sampleRate * 0.45);
      const rate = Math.log(endHz / startHz) / duration;
      fillChannel(output, channel, frames, frame => {
        const seconds = frame / sampleRate;
        const phase = 2 * Math.PI * startHz * Math.expm1(rate * seconds) / rate;
        return Math.sin(phase) * minusTwelveDb;
      });
    } else if (id === 'sq50') {
      fillChannel(output, channel, frames, frame =>
        Math.sin(2 * Math.PI * 50 * frame / sampleRate) >= 0 ? minusThreeDb : -minusThreeDb
      );
    } else if (id === 'fs') {
      fillChannel(output, channel, frames, frame => ((frame + channel) & 1) === 0 ? 1 : -1);
    } else if (id === 'step') {
      fillChannel(output, channel, frames, frame => frame < Math.floor(frames / 2) ? 0 : 0.5);
    }
  }

  return output;
}

