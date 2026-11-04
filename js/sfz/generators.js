export const SFZ_GENERATOR_WAVES = Object.freeze({ '*sine': 1, '*saw': 2, '*square': 3,
  '*triangle': 4, '*tri': 4, '*noise': 5, '*silence': 6 });
const PERIOD_FRAMES = 2048;
const PERIOD_RATE = Math.round(440 * Math.pow(2, (60 - 69) / 12) * PERIOD_FRAMES);

export function isSfzGenerator(sample) { return Object.hasOwn(SFZ_GENERATOR_WAVES, sample); }

export function sfzGeneratorMetadata(sample) {
  return { size: 0, frames: sample === '*noise' || sample === '*silence' ? 2 : PERIOD_FRAMES,
    channels: 1, sampleRate: PERIOD_RATE };
}

export function createSfzGeneratorSample(sample) {
  const { frames, sampleRate } = sfzGeneratorMetadata(sample);
  const pcm = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    const phase = frame / frames;
    if (sample === '*sine') pcm[frame] = Math.sin(2 * Math.PI * phase);
    else if (sample === '*saw') pcm[frame] = 2 * phase - 1;
    else if (sample === '*square') pcm[frame] = phase < 0.5 ? 1 : -1;
    else if (sample === '*triangle' || sample === '*tri') pcm[frame] = 1 - 4 * (phase < 0.5 ? 0.5 - phase : phase - 0.5);
    // Noise is generated continuously by native per-voice RNG; its two silent
    // storage frames only keep the common sample descriptor well formed.
  }
  return { sampleRate, channels: [pcm] };
}
