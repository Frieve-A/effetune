export const LIVE_SAMPLE_RATE = 44100;
export const LIVE_RING_FRAMES = 88200;
export const LIVE_PREROLL_FRAMES = 5292;
const TAPS = 64;
const PHASES = 1024;
const HALF = TAPS / 2;

export class LivePcmCore {
  constructor(outputSampleRate) {
    if (!Number.isFinite(outputSampleRate) || outputSampleRate < 8000 || outputSampleRate > 384000) throw new RangeError('Invalid output sample rate');
    this.outputSampleRate = outputSampleRate;
    this.ring = [new Float32Array(LIVE_RING_FRAMES), new Float32Array(LIVE_RING_FRAMES)];
    this.coefficients = new Float32Array(TAPS * PHASES);
    const cutoff = 0.94 * (outputSampleRate < LIVE_SAMPLE_RATE ? outputSampleRate / LIVE_SAMPLE_RATE : 1);
    for (let phase = 0; phase < PHASES; phase += 1) {
      let sum = 0;
      for (let tap = 0; tap < TAPS; tap += 1) {
        const distance = tap - HALF + 1 - phase / PHASES;
        const angle = Math.PI * cutoff * distance;
        const sinc = angle === 0 ? 1 : Math.sin(angle) / angle;
        const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * tap / (TAPS - 1)) + 0.08 * Math.cos(4 * Math.PI * tap / (TAPS - 1));
        const value = cutoff * sinc * window;
        this.coefficients[phase * TAPS + tap] = value;
        sum += value;
      }
      for (let tap = 0; tap < TAPS; tap += 1) this.coefficients[phase * TAPS + tap] /= sum;
    }
    this.underruns = 0;
    this.rebuffers = 0;
    this.reset();
  }

  reset(startFrame = 0) {
    this.readPosition = startFrame;
    this.writeFrame = startFrame;
    this.oldestFrame = startFrame;
    this.started = false;
    this.drift = 0;
  }

  push({ startFrame, frameCount, planes }) {
    if (!Number.isSafeInteger(startFrame) || startFrame < 0 || !Number.isInteger(frameCount) || frameCount < 1 || frameCount > 4096 ||
        !Array.isArray(planes) || planes.length !== 2 || !planes.every(plane => plane instanceof ArrayBuffer && plane.byteLength === frameCount * 4)) return false;
    const samples = planes.map(plane => new Float32Array(plane));
    for (const channel of samples) for (const value of channel) if (!Number.isFinite(value)) return false;
    if (startFrame !== this.writeFrame || this.writeFrame + frameCount - this.readPosition > LIVE_RING_FRAMES - TAPS) {
      this.reset(startFrame);
      this.rebuffers += 1;
    }
    for (let frame = 0; frame < frameCount; frame += 1) {
      const index = (startFrame + frame) % LIVE_RING_FRAMES;
      this.ring[0][index] = samples[0][frame];
      this.ring[1][index] = samples[1][frame];
    }
    this.writeFrame += frameCount;
    return true;
  }

  get bufferedFrames() { return this.writeFrame - this.readPosition; }
  get buffered() { return this.bufferedFrames >= LIVE_PREROLL_FRAMES; }

  render(outputs) {
    const left = outputs[0], right = outputs[1];
    left.fill(0); right.fill(0);
    if (!this.started) {
      if (!this.buffered) return;
      this.started = true;
    }
    const error = (this.bufferedFrames - LIVE_PREROLL_FRAMES) / LIVE_PREROLL_FRAMES;
    const target = error * 0.002;
    const bounded = target < -0.002 ? -0.002 : target > 0.002 ? 0.002 : target;
    this.drift += (bounded - this.drift) * 0.002;
    const step = LIVE_SAMPLE_RATE / this.outputSampleRate * (1 + this.drift);
    for (let frame = 0; frame < left.length; frame += 1) {
      const center = Math.floor(this.readPosition);
      if (center + HALF >= this.writeFrame) {
        this.started = false;
        this.underruns += 1;
        break;
      }
      const phase = Math.floor((this.readPosition - center) * PHASES);
      let l = 0, r = 0;
      for (let tap = 0; tap < TAPS; tap += 1) {
        const sourceFrame = center + tap - HALF + 1;
        if (sourceFrame < this.oldestFrame) continue;
        const index = sourceFrame % LIVE_RING_FRAMES;
        const coefficient = this.coefficients[phase * TAPS + tap];
        l += this.ring[0][index] * coefficient;
        r += this.ring[1][index] * coefficient;
      }
      left[frame] = l; right[frame] = r;
      this.readPosition += step;
      const oldest = Math.floor(this.readPosition) - HALF;
      if (oldest > this.oldestFrame) this.oldestFrame = oldest;
    }
  }
}
