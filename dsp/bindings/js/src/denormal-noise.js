export const DENORMAL_NOISE_AMPLITUDE = 1e-19;

export function addDenormalNoise(audio, channelCount, frameCount, frameOrigin) {
  const first = (frameOrigin & 1) === 0
    ? DENORMAL_NOISE_AMPLITUDE
    : -DENORMAL_NOISE_AMPLITUDE;
  for (let channel = 0; channel < channelCount; channel++) {
    const offset = channel * frameCount;
    let noise = first;
    for (let frame = 0; frame < frameCount; frame++) {
      audio[offset + frame] += noise;
      noise = -noise;
    }
  }
}
