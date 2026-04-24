/**
 * Filter response calculation functions.
 */

/**
 * Calculate the frequency response of a single parametric EQ (peaking filter).
 * Uses the standard Audio EQ Cookbook biquad implementation.
 * @param {number[]} freq - Array of frequency values to calculate the response at.
 * @param {number} fc - Center frequency of the PEQ band.
 * @param {number} gainDb - Gain of the PEQ band in dB.
 * @param {number} Q - Q factor of the PEQ band.
 * @param {number} [fs=96000] - Sampling frequency in Hz.
 * @returns {number[]} Array of filter responses in dB at each frequency in `freq`.
 */
export function peqResponse(freq, fc, gainDb, Q, fs = 96000) {
  const nFreq = freq.length;
  const nyquist = fs * 0.5;

  // Basic validation for fc and Q (kept outside hot path)
  if (typeof fc !== 'number' || !isFinite(fc) || fc <= 0 || fc >= nyquist) {
      console.warn(`Invalid fc (${fc}) for fs=${fs}. Returning flat response.`);
      return new Array(nFreq).fill(0);
  }
   if (typeof Q !== 'number' || !isFinite(Q) || Q <= 0) {
       console.warn(`Invalid Q (${Q}). Returning flat response.`);
       return new Array(nFreq).fill(0);
   }
   if (typeof gainDb !== 'number' || !isFinite(gainDb)) {
        console.warn(`Invalid gainDb (${gainDb}). Returning flat response.`);
        return new Array(nFreq).fill(0);
   }

  const twoPiOverFs = 2 * Math.PI / fs;
  const A = 10**(gainDb / 40); // Amplitude ratio (sqrt gain)
  const w0 = twoPiOverFs * fc;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  // Ensure alpha avoids division by zero in Q (Q is already validated > 0 above;
  // keep a guard for extremely small values — ternary is faster than Math.max here)
  const Qsafe = Q < 1e-6 ? 1e-6 : Q;
  const alpha = sinW0 / (2 * Qsafe);

  // Biquad coefficients for peaking EQ
  const alphaA = alpha * A;
  const alphaOverA = alpha / A;
  const b0 = 1 + alphaA;
  const b1 = -2 * cosW0;
  const b2 = 1 - alphaA;
  const a0 = 1 + alphaOverA;
  // a1 === b1, reuse
  const a2 = 1 - alphaOverA;

  // a0 is 1 + alpha/A where alpha>0 and A>0, so a0 > 1 in practice; keep a cheap guard.
  if (a0 < 1e-18 && a0 > -1e-18) {
      console.warn(`Near-zero a0 coefficient (fc=${fc}, Q=${Q}, gain=${gainDb}). Returning flat response.`);
      return new Array(nFreq).fill(0);
  }

  // Normalize coefficients by a0
  const invA0 = 1 / a0;
  const bz0 = b0 * invA0;
  const bz1 = b1 * invA0;
  const bz2 = b2 * invA0;
  const az1 = b1 * invA0; // a1 === b1
  const az2 = a2 * invA0;

  // Calculate magnitude response H(f) for each frequency — preallocate instead of .map
  const out = new Array(nFreq);
  for (let i = 0; i < nFreq; i++) {
    const f = freq[i];
    if (f <= 0 || f >= nyquist) { out[i] = 0; continue; }

    const omega = twoPiOverFs * f;
    const cosOmega = Math.cos(omega);
    const sinOmega = Math.sin(omega);
    // Double-angle identities save two trig calls per frequency point:
    //   cos(2ω) = 2·cos²(ω) − 1 ,  sin(2ω) = 2·sin(ω)·cos(ω)
    const cos2 = 2 * cosOmega * cosOmega - 1;
    const sin2 = 2 * sinOmega * cosOmega;

    // H(z) with z = e^(jω)
    const numRe = bz0 + bz1 * cosOmega + bz2 * cos2;
    const numIm = -bz1 * sinOmega - bz2 * sin2;
    const denRe = 1 + az1 * cosOmega + az2 * cos2;
    const denIm = -az1 * sinOmega - az2 * sin2;

    const numMagSq = numRe * numRe + numIm * numIm;
    const denMagSq = denRe * denRe + denIm * denIm;

    if (denMagSq < 1e-36) { out[i] = 0; continue; }

    // 20·log10(sqrt(numMagSq/denMagSq)) === 10·log10(numMagSq/denMagSq)
    // Epsilon 1e-36 keeps log stable when numMagSq hits 0 (notch center).
    out[i] = 10 * Math.log10(numMagSq / denMagSq + 1e-36);
  }
  return out;
} 