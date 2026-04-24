/**
 * PEQ Parameter Calculator
 * Calculates parametric EQ correction parameters based on frequency response measurements.
 */
import { smoothLog } from './smoothing.js';
import { findPeaksDips } from './peak-detection.js';
import { peqResponse } from './filter-response.js';
import { fitPEQ, errorFunctionLogSpace, DEFAULT_REGULARIZATION, qMaxForGain } from './optimization.js';
import { processCollisions, designPEQ, createDefaultBands } from './design-utils.js';

class PEQCalculator {
  /**
   * Calculate PEQ parameters from a measured frequency response.
   * This is the main entry point function.
   * @param {Array<Array<number>>} fr - Array of [frequency, magnitude] pairs.
   * @param {number} [lowFreq=20] - Low frequency limit for correction.
   * @param {number} [highFreq=20000] - High frequency limit for correction.
   * @param {number} [bandCount=5] - Desired number of PEQ bands (1-15 supported).
   * @param {number} [fs=96000] - Sampling frequency in Hz for digital filter calculations.
   * @param {number} [binsPerOct=6] - Bins per octave for smoothing (1-24, higher values = less smoothing).
   * @param {Object} [options={}] - Additional calculation options.
   * @param {Object} [options.regularization] - Regularization parameters to control optimization.
   * @param {number} [options.regularization.gainWeight] - Weight for gain regularization (uses DEFAULT_REGULARIZATION if not specified).
   * @param {number} [options.regularization.qWeight] - Weight for Q regularization (uses DEFAULT_REGULARIZATION if not specified).
   * @returns {Array<{frequency: number, gain: number, Q: number, type: string}>} Array of calculated PEQ parameters.
   */
  calculatePEQParameters(fr, lowFreq = 20, highFreq = 20000, bandCount = 5, fs = 96000, binsPerOct = 6, options = {}) {
    this.fs = fs;
    // Clamp frequency limits to sensible values
    this.lowFreq = Math.max(10, Math.min(lowFreq, 1000));
    this.highFreq = Math.max(this.lowFreq * 2, Math.min(highFreq, fs / 2 * 0.95)); // Ensure highFreq > lowFreq and below Nyquist
    // Clamp band count
    bandCount = Math.max(1, Math.min(15, bandCount));
    // Clamp binsPerOct
    binsPerOct = Math.max(1, Math.min(24, binsPerOct));

    // Setup regularization parameters with recommended defaults
    const regularization = {
      gainWeight: options.regularization?.gainWeight ?? DEFAULT_REGULARIZATION.gainWeight,
      qWeight: options.regularization?.qWeight ?? DEFAULT_REGULARIZATION.qWeight
    };

    // --- 1. Pre-filter and de-mean the input data ---
    // Filter data to be within slightly wider bounds than the target range
    const data = fr.filter(([f]) => f >= this.lowFreq * 0.8 && f <= this.highFreq * 1.2);
    if (data.length < 5) {
        console.error("calculatePEQParameters: Not enough valid data points in the specified frequency range.");
        return createDefaultBands(bandCount, this.lowFreq, this.highFreq);
    }

    const freq = data.map(([f]) => f);
    const magRaw = data.map(([,m]) => m);

    // Calculate the mean magnitude within the specified frequency range [lowFreq, highFreq]
    const relevantMags = data.filter(([f]) => f >= this.lowFreq && f <= this.highFreq).map(([,m]) => m);
    let mean = 0;
    if (relevantMags.length > 0) {
        mean = relevantMags.reduce((s, d) => s + d, 0) / relevantMags.length;
    } else {
        // Fallback if no data in the exact range
        mean = magRaw.reduce((s, d) => s + d, 0) / magRaw.length;
    }

    // Normalize magnitude by subtracting the mean
    const magN = magRaw.map(d => d - mean);

    // --- 2. Design PEQ parameters using the core algorithm ---
    try {
      // Call the main design function with regularization options
      const peqParams = designPEQ(freq, magN, bandCount, binsPerOct, this.lowFreq, this.highFreq, this.fs, { regularization });

      // --- 3. Format and clamp the final parameters ---
      return peqParams.map(b => {
        const clampedGain = Math.max(-18, Math.min(18, +b.gain.toFixed(1)));
        // Sign-dependent Q upper bound: peaks <= 1/6 oct (Q ≈ 8.65), dips <= 1/3 oct (Q ≈ 4.32)
        const qUpper = qMaxForGain(clampedGain);
        return {
          frequency: Math.max(20, Math.min(20000, Math.round(b.frequency))),
          gain: clampedGain,
          Q: Math.max(0.1, Math.min(qUpper, +b.Q.toFixed(2))),
          type: 'peaking'
        };
      });
    } catch (error) {
      console.error("Error in calculatePEQParameters during PEQ design:", error);
      // Fallback to default bands in case of any error during design
      return createDefaultBands(bandCount, this.lowFreq, this.highFreq);
    }
  }
}

// Export module interfaces
export { PEQCalculator, smoothLog, findPeaksDips, peqResponse, errorFunctionLogSpace, fitPEQ, processCollisions, designPEQ, createDefaultBands };

// Register the calculator class globally for backward compatibility
if (typeof window !== 'undefined') {
  window.PEQCalculator = PEQCalculator;
} 