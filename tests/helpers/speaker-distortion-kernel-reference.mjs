// Float64 whole-signal reference of the Distortion Correction kernel
// (dsp/plugins/others/speaker_distortion_correction). It mirrors the reference in the
// kernel's native_test.cpp: direct-form peak sections, held low-rate products, and the
// 90-degree path as plain convolutions with decimation and zero stuffing, plus the odd block
// held over 2D samples (plan-odd section 3.2-3.4).

export const SPEAKER_DISTORTION_ASSET_MAGIC = 0x31415445;
export const SPEAKER_DISTORTION_ASSET_CHANNELS = 16;
export const SPEAKER_DISTORTION_ASSET_FRAMES = 1247;
export const SPEAKER_DISTORTION_ASSET_TOPOLOGY = 2;
export const SPEAKER_DISTORTION_HEADER_BYTES = 32;
export const SPEAKER_DISTORTION_ASSET_BYTES =
  SPEAKER_DISTORTION_HEADER_BYTES + SPEAKER_DISTORTION_ASSET_CHANNELS * SPEAKER_DISTORTION_ASSET_FRAMES * 4;
export const SPEAKER_DISTORTION_WEIGHT_COUNT = 1182;
export const SPEAKER_DISTORTION_WEIGHT_OFFSETS = Object.freeze({ ll: 0, lh: 528, lq: 720, hh: 912, l2: 990 });
export const SPEAKER_DISTORTION_STEP_FRAME = 1182;
export const SPEAKER_DISTORTION_ODD_WEIGHT_FRAME = 1183;
export const SPEAKER_DISTORTION_ODD_BOUND_FRAME = 1215;
export const SPEAKER_DISTORTION_ODD_COUNT = 32;
export const SPEAKER_DISTORTION_STEP = Object.freeze({ SHORT: 0, LONG: 1 });
export const SPEAKER_DISTORTION_MAX_WEIGHT = 1000;
export const SPEAKER_DISTORTION_MIN_RATE = 44100;
export const SPEAKER_DISTORTION_TELEMETRY = Object.freeze({ type: 1, version: 1, payloadBytes: 4 });

const FOLD_RMS = 0.1;
const LOW_Q = 2.15;
const HIGH_Q = 1.4;
const HIGH_FREQUENCIES = [580, 1050, 1900, 3450, 6200, 7800];

function besselI0(x) {
  let sum = 1;
  let term = 1;
  for (let k = 1; ; k += 1) {
    term *= (x * x * 0.25) / (k * k);
    if (term < 1e-17 * sum) return sum;
    sum += term;
  }
}

function designPeak(f, q, fs) {
  const w0 = (2 * Math.PI * f) / fs;
  const g = 1 / (1 + Math.tan(w0 / (2 * q)));
  const a1 = -2 * g * Math.cos(w0);
  const a2 = 2 * g - 1;
  const re = 1 + a1 * Math.cos(w0) + a2 * Math.cos(2 * w0);
  const im = a1 * Math.sin(w0) + a2 * Math.sin(2 * w0);
  return { a1, a2, peakScale: 1 - g, quadratureScale: Math.hypot(re, im) };
}

function design(fs, step) {
  let decimation = 2;
  while (fs / (2 * decimation) >= 22050) decimation *= 2;
  const longStages = Math.round(Math.log2(decimation / 2));
  const shortSpread = step === SPEAKER_DISTORTION_STEP.SHORT && decimation > 2;
  const stages = shortSpread ? longStages - 1 : longStages;
  const spread = shortSpread ? 2 : 1;
  const halfBands = [];
  for (let level = 0, rate = fs; level < stages; level += 1, rate *= 0.5) {
    const required = Math.ceil(42.05 / ((2.285 * 2 * Math.PI * (rate / 2 - 40000)) / rate)) + 1;
    let k = 1;
    while (4 * k - 1 < required) k += 1;
    const span = 2 * k - 1;
    const taps = [];
    for (let n = -span; n <= span; n += 1) {
      const ratio = n / span;
      const kaiser = besselI0(4.5335 * Math.sqrt(1 - ratio * ratio)) / besselI0(4.5335);
      taps.push(n === 0 ? 0.5 : (Math.sin((Math.PI * n) / 2) / (Math.PI * n)) * kaiser);
    }
    halfBands.push(taps);
  }
  const half = Math.round((step === SPEAKER_DISTORTION_STEP.SHORT ? 0.000625 : 0.0025) * ((2 * fs) / decimation));
  const filter = [];
  for (let m = -half; m <= half; m += 1) {
    const ratio = m / half;
    const kaiser = besselI0(4.3 * Math.sqrt(1 - ratio * ratio)) / besselI0(4.3);
    filter.push((m & 1) !== 0 ? (-2 * kaiser) / (Math.PI * m) : 0);
  }
  let latency = half * spread;
  for (let level = stages; level > 0; level -= 1) latency = 2 * latency + halfBands[level - 1].length - 1;
  return {
    low: Array.from({ length: 16 }, (_, i) => designPeak(20 * 2 ** (i / 3), LOW_Q, fs)),
    high: HIGH_FREQUENCIES.map((f) => designPeak(f, HIGH_Q, fs)),
    decimation,
    advance: (((decimation - 1) / (2 * fs) - 0.5 / 48000) * fs) / decimation,
    halfBands,
    filter,
    half,
    spread,
    latency,
  };
}

/**
 * Timing of the corrector at `sampleRate` for the asset step (0 Short, 1 Long).
 * Rates below 44.1 kHz bypass the corrector and report zero latency.
 */
export function speakerDistortionTiming(sampleRate, step) {
  if (!(sampleRate >= SPEAKER_DISTORTION_MIN_RATE)) return { decimation: 0, half: 0, spread: 0, latency: 0 };
  const { decimation, half, spread, latency } = design(sampleRate, step);
  return { decimation, half, spread, latency };
}

function quadraturePath(dz, signal, level) {
  const count = signal.length;
  const output = new Float64Array(count);
  if (level === dz.halfBands.length) {
    const { half, spread, filter } = dz;
    for (let n = 0; n < count; n += 1) {
      let sum = 0;
      for (let m = -half; m <= half; m += 1) {
        const index = n - (half + m) * spread;
        if (index >= 0) sum += filter[m + half] * signal[index];
      }
      output[n] = sum;
    }
    return output;
  }
  const taps = dz.halfBands[level];
  const decimated = new Float64Array(count >> 1);
  for (let m = 0; m < decimated.length; m += 1) {
    let sum = 0;
    for (let t = 0; t < taps.length; t += 1) {
      const index = 2 * m + 1 - t;
      if (index >= 0) sum += taps[t] * signal[index];
    }
    decimated[m] = sum;
  }
  const filtered = quadraturePath(dz, decimated, level + 1);
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    for (let t = 0; t < taps.length; t += 1) {
      const index = i - t;
      if (index >= 0 && (index & 1) !== 0) sum += 2 * taps[t] * filtered[(index - 1) / 2];
    }
    output[i] = sum;
  }
  return output;
}

function correctChannel(input, weights, odd, dz, scale) {
  const lowScale = new Float64Array(32);
  const highScale = new Float64Array(12);
  for (let i = 0; i < 16; i += 1) {
    lowScale[2 * i] = dz.low[i].peakScale;
    lowScale[2 * i + 1] = dz.low[i].quadratureScale;
  }
  for (let j = 0; j < 6; j += 1) {
    highScale[2 * j] = dz.high[j].peakScale;
    highScale[2 * j + 1] = dz.high[j].quadratureScale;
  }
  // Odd block folded for |scale| = a: e = RMS * w * (k * a)^3 / scale, T = 1 / (k * a).
  const oddActive = odd.weights.some((w) => w !== 0);
  const oddE = new Float64Array(32);
  const oddT = new Float64Array(32);
  if (oddActive) {
    const magnitude = Math.abs(scale);
    for (let a = 0; a < 32; a += 1) {
      const ka = (lowScale[a] / (FOLD_RMS * odd.bounds[a])) * magnitude;
      oddE[a] = (FOLD_RMS * odd.weights[a] * ka * ka * ka) / scale;
      oddT[a] = 1 / ka;
    }
  }
  const { lh, lq, hh, l2 } = SPEAKER_DISTORTION_WEIGHT_OFFSETS;
  const W = new Float64Array(32 * 32);
  const V = new Float64Array(32 * 6);
  const VQ = new Float64Array(32 * 6);
  const V2 = new Float64Array(32 * 6);
  const HH = new Float64Array(12 * 12);
  let index = 0;
  for (let a = 0; a < 32; a += 1) {
    for (let b = a; b < 32; b += 1, index += 1) W[a * 32 + b] = (weights[index] * lowScale[a] * lowScale[b]) / FOLD_RMS;
  }
  for (let a = 0; a < 32; a += 1) {
    for (let j = 0; j < 6; j += 1) {
      V[a * 6 + j] = (weights[lh + a * 6 + j] * lowScale[a] * highScale[2 * j]) / FOLD_RMS;
      VQ[a * 6 + j] = (weights[lq + a * 6 + j] * lowScale[a] * highScale[2 * j + 1]) / FOLD_RMS;
      V2[a * 6 + j] = (weights[l2 + a * 6 + j] * lowScale[a] * highScale[2 * j]) / FOLD_RMS;
    }
  }
  index = hh;
  for (let c = 0; c < 12; c += 1) {
    for (let e = c; e < 12; e += 1, index += 1) HH[c * 12 + e] = (weights[index] * highScale[c] * highScale[e]) / FOLD_RMS;
  }

  const count = input.length;
  const s0 = new Float64Array(count);
  const s1 = new Float64Array(count);
  const ql = new Float64Array(count);
  let qlHeld = 0;
  let v1 = new Float64Array(16);
  let v2 = new Float64Array(16);
  let g1 = new Float64Array(6);
  let g2 = new Float64Array(6);
  const r = new Float64Array(32);
  const t = new Float64Array(12);
  const u = new Float64Array(6);
  const uq = new Float64Array(6);
  const u2 = new Float64Array(6);
  let qPrev = 0;
  let qHeld = 0;
  for (let n = 0; n < count; n += 1) {
    const x = input[n];
    const v = new Float64Array(16);
    const g = new Float64Array(6);
    for (let i = 0; i < 16; i += 1) v[i] = x - dz.low[i].a1 * v1[i] - dz.low[i].a2 * v2[i];
    for (let j = 0; j < 6; j += 1) {
      g[j] = x - dz.high[j].a1 * g1[j] - dz.high[j].a2 * g2[j];
      t[2 * j] = g[j] - g2[j];
      t[2 * j + 1] = g1[j];
    }
    if (n % dz.decimation === 0) {
      for (let i = 0; i < 16; i += 1) {
        r[2 * i] = v[i] - v2[i];
        r[2 * i + 1] = v1[i];
      }
      let q = 0;
      for (let a = 0; a < 32; a += 1) for (let b = a; b < 32; b += 1) q += W[a * 32 + b] * r[a] * r[b];
      qHeld = q + dz.advance * (q - qPrev);
      qPrev = q;
      for (let j = 0; j < 6; j += 1) {
        u[j] = 0;
        uq[j] = 0;
        u2[j] = 0;
        for (let a = 0; a < 32; a += 1) {
          u[j] += V[a * 6 + j] * r[a];
          uq[j] += VQ[a * 6 + j] * r[a];
          u2[j] += V2[a * 6 + j] * r[a];
        }
      }
      if (oddActive && n % (2 * dz.decimation) === 0) {
        qlHeld = 0;
        for (let a = 0; a < 32; a += 1) {
          const c = Math.min(oddT[a], Math.max(-oddT[a], r[a]));
          qlHeld += oddE[a] * c * c * c;
        }
      }
    }
    ql[n] = qlHeld;
    let sum0 = qHeld;
    let sum1 = 0;
    for (let j = 0; j < 6; j += 1) {
      sum0 += t[2 * j] * u[j] + t[2 * j + 1] * uq[j];
      sum1 += t[2 * j] * u2[j];
    }
    for (let c = 0; c < 12; c += 1) for (let e = c; e < 12; e += 1) sum0 += HH[c * 12 + e] * t[c] * t[e];
    s0[n] = sum0;
    s1[n] = sum1;
    v2 = v1;
    v1 = v;
    g2 = g1;
    g1 = g;
  }
  const p = quadraturePath(dz, s1, 0);
  const output = new Float64Array(count);
  for (let n = 0; n < count; n += 1) {
    const k = n - dz.latency;
    const delayed = k >= 0 ? input[k] - (scale * s0[k] + ql[k]) : 0;
    output[n] = delayed - scale * p[n];
  }
  return output;
}

/**
 * Renders `input` (array of per-channel sample arrays, up to 16) through the corrector
 * with a valid asset `bytes` (ArrayBuffer view of SPEAKER_DISTORTION_ASSET_BYTES), from a
 * freshly activated state. `mode` is 'Reduce' or 'Add'; `dv` is Amplifier Volume Change in dB.
 * Returns one Float64Array per channel.
 */
export function speakerDistortionReference({ bytes, sampleRate, dv = 0, mode = 'Reduce', input }) {
  if (!(sampleRate >= SPEAKER_DISTORTION_MIN_RATE)) return input.map((channel) => Float64Array.from(channel));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frame = (channel, index) =>
    view.getFloat32(SPEAKER_DISTORTION_HEADER_BYTES + (channel * SPEAKER_DISTORTION_ASSET_FRAMES + index) * 4, true);
  const dz = design(sampleRate, frame(0, SPEAKER_DISTORTION_STEP_FRAME));
  const magnitude = 10 ** (dv / 20);
  const scale = mode === 'Add' ? -magnitude : magnitude;
  return input.map((channel, c) => {
    const weights = Float64Array.from({ length: SPEAKER_DISTORTION_WEIGHT_COUNT }, (_, i) => frame(c, i));
    const odd = {
      weights: Float64Array.from({ length: SPEAKER_DISTORTION_ODD_COUNT }, (_, a) => frame(c, SPEAKER_DISTORTION_ODD_WEIGHT_FRAME + a)),
      bounds: Float64Array.from({ length: SPEAKER_DISTORTION_ODD_COUNT }, (_, a) => frame(c, SPEAKER_DISTORTION_ODD_BOUND_FRAME + a)),
    };
    return correctChannel(channel, weights, odd, dz, scale);
  });
}
