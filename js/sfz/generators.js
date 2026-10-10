const GENERATORS = new Set(['*sine', '*saw', '*square', '*triangle', '*tri', '*noise', '*silence']);
const PERIOD_FRAMES = 2048;
const PERIOD_RATE = Math.round(440 * Math.pow(2, (60 - 69) / 12) * PERIOD_FRAMES);

export function isSfzGenerator(sample) { return GENERATORS.has(sample); }

export function sfzGeneratorMetadata(sample) {
  return { size: 0, frames: sample === '*noise' ? 8192 : PERIOD_FRAMES,
    channels: 1, sampleRate: sample === '*noise' ? 48000 : PERIOD_RATE };
}

export function createSfzGeneratorSample(sample) {
  const { frames, sampleRate } = sfzGeneratorMetadata(sample);
  const pcm = new Float32Array(frames);
  let noise = 0x53465a;
  for (let frame = 0; frame < frames; frame++) {
    const phase = frame / frames;
    if (sample === '*sine') pcm[frame] = Math.sin(2 * Math.PI * phase);
    else if (sample === '*saw') pcm[frame] = 2 * phase - 1;
    else if (sample === '*square') pcm[frame] = phase < 0.5 ? 1 : -1;
    else if (sample === '*triangle' || sample === '*tri') pcm[frame] = 1 - 4 * (phase < 0.5 ? 0.5 - phase : phase - 0.5);
    else if (sample === '*noise') {
      // Repeatable white noise keeps stored banks and offline rendering deterministic.
      noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
      pcm[frame] = (noise >>> 0) / 2147483648 - 1;
    }
  }
  return { sampleRate, channels: [pcm] };
}
