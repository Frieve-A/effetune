export const LIVE_SAMPLE_RATE = 44100;
export const LIVE_RING_FRAMES = 88200;
export const LIVE_PREROLL_FRAMES = 5292;
const TAPS = 64;
const PHASES = 1024;
const HALF = TAPS / 2;
const FADE_SECONDS = 0.005;

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
    this.fadeRemaining = this.lastLeft || this.lastRight ? Math.ceil(this.outputSampleRate * FADE_SECONDS) : 0;
    this.fadeLeft = this.lastLeft || 0;
    this.fadeRight = this.lastRight || 0;
    this.readPosition = startFrame;
    this.writeFrame = startFrame;
    this.oldestFrame = startFrame;
    this.started = false;
    this.drift = 0;
    this.driftIntegral = 0;
    this.filteredError = 0;
    this.playbackGain = 0;
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
    const fadeFrames = Math.ceil(this.outputSampleRate * FADE_SECONDS);
    let firstFrame = 0;
    while (this.fadeRemaining > 0 && firstFrame < left.length) {
      this.fadeRemaining -= 1;
      const gain = this.fadeRemaining / fadeFrames;
      left[firstFrame] = this.fadeLeft * gain;
      right[firstFrame] = this.fadeRight * gain;
      firstFrame += 1;
    }
    if (firstFrame > 0) {
      this.lastLeft = left[firstFrame - 1];
      this.lastRight = right[firstFrame - 1];
    }
    if (!this.started) {
      if (this.fadeRemaining > 0 || !this.buffered) return;
      this.started = true;
    }
    const seconds = (left.length - firstFrame) / this.outputSampleRate;
    // Estimate the average occupancy during this quantum, not just its initial peak.
    const averageBuffered = this.bufferedFrames - seconds * LIVE_SAMPLE_RATE * (1 + this.drift) / 2;
    const error = (averageBuffered - LIVE_PREROLL_FRAMES) / LIVE_PREROLL_FRAMES;
    this.filteredError += (error - this.filteredError) * (1 - Math.exp(-seconds / 2));
    this.driftIntegral += this.filteredError * 0.00002 * seconds;
    this.driftIntegral = this.driftIntegral < -0.002 ? -0.002 : this.driftIntegral > 0.002 ? 0.002 : this.driftIntegral;
    const target = this.filteredError * 0.002 + this.driftIntegral;
    const bounded = target < -0.002 ? -0.002 : target > 0.002 ? 0.002 : target;
    this.drift += (bounded - this.drift) * (1 - Math.exp(-seconds / 0.5));
    const step = LIVE_SAMPLE_RATE / this.outputSampleRate * (1 + this.drift);
    for (let frame = firstFrame; frame < left.length; frame += 1) {
      const center = Math.floor(this.readPosition);
      if (center + HALF >= this.writeFrame) {
        this.started = false;
        this.underruns += 1;
        this.drift = 0;
        this.driftIntegral = 0;
        this.filteredError = 0;
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
      const available = (this.writeFrame - HALF - this.readPosition) / step;
      let gain = available < fadeFrames ? available / fadeFrames : 1;
      const recovery = this.playbackGain + 1 / fadeFrames;
      if (recovery < gain) gain = recovery;
      this.playbackGain = gain;
      left[frame] = l * gain; right[frame] = r * gain;
      this.lastLeft = left[frame]; this.lastRight = right[frame];
      this.readPosition += step;
      const oldest = Math.floor(this.readPosition) - HALF;
      if (oldest > this.oldestFrame) this.oldestFrame = oldest;
    }
    if (!this.started) { this.lastLeft = 0; this.lastRight = 0; this.playbackGain = 0; }
  }
}
