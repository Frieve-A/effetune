/**
 * PEQ design utility functions for creating and processing EQ bands.
 */
import { smoothLog } from './smoothing.js';
import { findPeaksDips } from './peak-detection.js';
import { fitPEQ, DEFAULT_REGULARIZATION, qMaxForGain } from './optimization.js';

/**
 * Post-process optimized PEQ parameters: merge close bands and limit count.
 * @param {Array<{frequency: number, gain: number, Q: number, type: string}>} bands - Array of PEQ band objects.
 * @param {number} maxBands - Maximum number of bands allowed.
 * @returns {Array<{frequency: number, gain: number, Q: number, type: string}>} Processed array of PEQ bands.
 */
export function processCollisions(bands, maxBands) {
  if (!bands || !Array.isArray(bands) || bands.length === 0) {
    return [];
  }

  // Filter out invalid or insignificant bands first
  const validBands = bands.filter(b =>
      b && typeof b.frequency === 'number' && isFinite(b.frequency) && b.frequency > 0 &&
      typeof b.gain === 'number' && isFinite(b.gain) && Math.abs(b.gain) >= 0.1 && // Keep only gains >= 0.1 dB
      typeof b.Q === 'number' && isFinite(b.Q) && b.Q > 0
  );

  if (validBands.length <= maxBands) {
      // If already within limit, just sort and return
      return validBands.sort((a, b) => a.frequency - b.frequency);
  }

  // Sort bands by frequency for collision detection/merging
  const sortedBands = [...validBands].sort((a, b) => a.frequency - b.frequency);

  // Merge bands that are too close (e.g., within 1/6 octave)
  const mergedBands = [];
  if (sortedBands.length > 0) {
      let currentBand = { ...sortedBands[0] }; // Work with a copy

      for (let i = 1; i < sortedBands.length; i++) {
          const nextBand = sortedBands[i];
          const freqRatio = nextBand.frequency / currentBand.frequency;
          const octaveDist = Math.abs(Math.log2(freqRatio));

          // Merge condition: close in frequency (e.g., < 1/6 octave) AND same gain sign (or one is near zero)
          const minOctaveDist = 1 / 6;
          if (octaveDist < minOctaveDist && (currentBand.gain * nextBand.gain >= 0 || Math.abs(currentBand.gain) < 0.5 || Math.abs(nextBand.gain) < 0.5)) {
              // Merge 'nextBand' into 'currentBand'
              // Use weighted average for frequency (based on absolute gains)
              const weight1 = Math.abs(currentBand.gain);
              const weight2 = Math.abs(nextBand.gain);
              const totalWeight = weight1 + weight2;
              
              if (totalWeight > 0) {
                  const w1 = weight1 / totalWeight;
                  const w2 = weight2 / totalWeight;
                  currentBand.frequency = Math.exp(w1 * Math.log(currentBand.frequency) + w2 * Math.log(nextBand.frequency));
              } else {
                  // If both gains are 0, use geometric mean
                  currentBand.frequency = Math.sqrt(currentBand.frequency * nextBand.frequency);
              }

               // Simple sum for gain (approximation, doesn't perfectly capture interaction)
               currentBand.gain += nextBand.gain;

               // Use lower Q (wider band)
               currentBand.Q = Math.min(currentBand.Q, nextBand.Q);

               // Clamp parameters after merge (Q upper bound depends on peak/dip sign)
               currentBand.gain = Math.max(-18, Math.min(18, currentBand.gain));
               currentBand.Q = Math.max(0.5, Math.min(qMaxForGain(currentBand.gain), currentBand.Q));
               currentBand.frequency = Math.max(20, Math.min(20000, currentBand.frequency));

          } else {
              // No merge, push the completed 'currentBand' and start new one
              mergedBands.push(currentBand);
              currentBand = { ...nextBand }; // Start new band
          }
      }
      mergedBands.push(currentBand); // Add the last band
  }

  // Filter again for significance after merging
   const finalBands = mergedBands.filter(b => Math.abs(b.gain) >= 0.2); // Stricter gain threshold after merge

  // If still too many bands, sort by absolute gain and take the top 'maxBands'
  if (finalBands.length > maxBands) {
    finalBands.sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain));
    return finalBands.slice(0, maxBands).sort((a,b)=>a.frequency - b.frequency); // Return top N, sorted by freq
  } else {
     return finalBands.sort((a, b) => a.frequency - b.frequency); // Return all merged bands, sorted by freq
  }
}

/**
 * Create default PEQ bands as a fallback.
 * @param {number} bandCount - Number of bands to create.
 * @param {number} [lowFreq=20] - Low frequency limit.
 * @param {number} [highFreq=20000] - High frequency limit.
 * @returns {Array<{frequency: number, gain: number, Q: number, type: string}>} Array of default PEQ bands.
 */
export function createDefaultBands(bandCount, lowFreq = 20, highFreq = 20000) {
  console.warn(`Creating ${bandCount} default PEQ bands.`);
  bandCount = Math.max(1, Math.min(15, bandCount)); // Ensure valid count

  const defaultBands = [];
  
  // Create logarithmically spaced center frequencies
  const logLow = Math.log10(lowFreq);
  const logHigh = Math.log10(highFreq);
  // Place bands within the range, avoiding exact edges
  const logStep = (logHigh - logLow) / (bandCount + 1);

  for (let i = 1; i <= bandCount; i++) {
    const logF = logLow + i * logStep;
    const freq = Math.round(10**logF);
    defaultBands.push({
      frequency: freq,
      gain: 0.0,
      Q: 1.41, // Default Q
      type: 'peaking'
    });
  }
  return defaultBands;
}

/**
 * Design a parametric EQ to correct a frequency response.
 * @param {number[]} freq - Array of frequency values.
 * @param {number[]} magDb - Array of magnitude values in dB (normalized to ~0dB average).
 * @param {number} bandCount - Desired number of PEQ bands.
 * @param {number} binsPerOct - Smoothing factor.
 * @param {number} lowFreq - Low frequency limit for correction.
 * @param {number} highFreq - High frequency limit for correction.
 * @param {number} fs - Sampling frequency in Hz.
 * @param {Object} [options] - Additional options.
 * @param {Object} [options.regularization] - Regularization parameters.
 * @returns {Array<{frequency: number, gain: number, Q: number, type: string}>} Array of PEQ parameters.
 */
export function designPEQ(freq, magDb, bandCount, binsPerOct, lowFreq, highFreq, fs, options = {}) {
  // Basic validation already done in caller, but double-check lengths
  if (!freq || !magDb || freq.length !== magDb.length || freq.length < 3) {
      console.error("designPEQ: Invalid input data.");
      return createDefaultBands(bandCount, lowFreq, highFreq);
  }

  // Setup regularization parameters with recommended defaults
  const regularization = {
    gainWeight: options.regularization?.gainWeight ?? DEFAULT_REGULARIZATION.gainWeight,
    qWeight: options.regularization?.qWeight ?? DEFAULT_REGULARIZATION.qWeight
  };

  try {
      // 1. Smooth the frequency response
      const smoothedMag = smoothLog(freq, magDb, binsPerOct);
      if (!smoothedMag || smoothedMag.length !== magDb.length) {
          console.error("designPEQ: Smoothing failed.");
          return createDefaultBands(bandCount, lowFreq, highFreq);
      }

      // 2. Detect dominant errors (peaks and dips) on the smoothed data
      const candidates = findPeaksDips(freq, smoothedMag, 1.5, 0.5); // Use thresholds passed to findPeaksDips

      // 3. Generate Initial PEQ Parameters
      const initParams = []; // Flat array: [g1, Q1, fc1, g2, Q2, fc2, ...]
      const targetBands = bandCount; // Use the requested bandCount

      if (candidates.length === 0) {
          // No significant peaks/dips: create logarithmically spaced bands
          const logLow = Math.log10(lowFreq);
          const logHigh = Math.log10(highFreq);
          const logStep = (logHigh - logLow) / (targetBands + 1);

          for (let i = 1; i <= targetBands; i++) {
              const targetFc = 10**(logLow + i * logStep);
              // Find the closest frequency point in the input data
              let closestIdx = 0;
              let minLogDist = Infinity;
              for (let j = 0; j < freq.length; j++) {
                  const dist = Math.abs(Math.log10(freq[j]) - Math.log10(targetFc));
                  if (dist < minLogDist) {
                      minLogDist = dist;
                      closestIdx = j;
                  }
              }
              const fc = freq[closestIdx];
              // Initial gain aims to flatten the smoothed response at this point
              const gain = -smoothedMag[closestIdx];
              const Q = 1.41; // Default moderate Q

              initParams.push(gain, Q, fc);
          }
      } else {
          // Instead of just using the most prominent peaks/dips, select them to ensure frequency-balanced distribution
          // Divide the frequency range into logarithmically-spaced bands and select the best peak/dip from each band
          
          // Create frequency bands (more bands than we need to ensure good coverage)
          const numFreqBands = targetBands * 2;
          const logLow = Math.log10(lowFreq);
          const logHigh = Math.log10(highFreq);
          const logStep = (logHigh - logLow) / numFreqBands;
          
          const frequencyBands = [];
          for (let i = 0; i < numFreqBands; i++) {
              const bandStartLog = logLow + i * logStep;
              const bandEndLog = logLow + (i + 1) * logStep;
              const bandStart = 10**bandStartLog;
              const bandEnd = 10**bandEndLog;
              
              frequencyBands.push({
                  startFreq: bandStart,
                  endFreq: bandEnd,
                  candidates: []
              });
          }
          
          // Assign each peak/dip to its appropriate frequency band
          for (const idx of candidates) {
              const peakFreq = freq[idx];
              const peakMag = Math.abs(smoothedMag[idx]);
              const peakProminence = Math.abs(smoothedMag[idx]); // Use magnitude as an approximation of prominence
              
              // Find which band this peak belongs to
              const bandIdx = Math.min(
                  numFreqBands - 1,
                  Math.max(0, Math.floor((Math.log10(peakFreq) - logLow) / logStep))
              );
              
              frequencyBands[bandIdx].candidates.push({
                  index: idx,
                  frequency: peakFreq,
                  magnitude: peakMag,
                  prominence: peakProminence
              });
          }
          
          // Sort candidates within each band by prominence/magnitude
          frequencyBands.forEach(band => {
              band.candidates.sort((a, b) => b.prominence - a.prominence);
          });
          
          // Select the best candidate from each band until we reach targetBands
          const selectedIndices = [];
          
          // First pass: take the most prominent peak from each band (if available)
          for (let round = 0; selectedIndices.length < targetBands && round < 3; round++) {
              for (let i = 0; i < frequencyBands.length && selectedIndices.length < targetBands; i++) {
                  const band = frequencyBands[i];
                  if (band.candidates.length > round) {
                      selectedIndices.push(band.candidates[round].index);
                  }
              }
          }
          
          // Use the selected peaks/dips to create bands
          for (let k = 0; k < selectedIndices.length; k++) {
              const i = selectedIndices[k]; // Index in freq/smoothedMag array
              const fc = freq[i];
              const gain = -smoothedMag[i]; // Correct the deviation
              const limitedGain = Math.max(-18, Math.min(18, gain));

              // Estimate Q based on bandwidth around the peak/dip in smoothed data
              let Q = 1.41; // Default Q
              const peakValue = smoothedMag[i];
              const isPeak = peakValue > 0;
              const targetRelLevel = isPeak ? -3.0 : 3.0; // Target relative level for -3dB points

              // Search left for f1 (frequency at targetRelLevel)
              let f1 = freq[0]; // Default to lowest freq
              for (let j = i - 1; j >= 0; j--) {
                  if ((isPeak && smoothedMag[j] - peakValue <= targetRelLevel) ||
                      (!isPeak && smoothedMag[j] - peakValue >= targetRelLevel)) {
                      // Basic interpolation
                      const val1 = smoothedMag[j] - peakValue;
                      const val2 = smoothedMag[j+1] - peakValue;
                      const freq1 = freq[j];
                      const freq2 = freq[j+1];
                      if (Math.abs(val2 - val1) > 1e-3) { // Avoid division by zero
                          const t = (targetRelLevel - val1) / (val2 - val1);
                          f1 = freq1 + t * (freq2 - freq1);
                      } else {
                          f1 = freq[j];
                      }
                      break;
                  }
                  f1 = freq[j]; // Keep track of furthest point reached
              }

              // Search right for f2
              let f2 = freq[freq.length - 1]; // Default to highest freq
              for (let j = i + 1; j < freq.length; j++) {
                  if ((isPeak && smoothedMag[j] - peakValue <= targetRelLevel) ||
                      (!isPeak && smoothedMag[j] - peakValue >= targetRelLevel)) {
                      const val1 = smoothedMag[j-1] - peakValue;
                      const val2 = smoothedMag[j] - peakValue;
                      const freq1 = freq[j-1];
                      const freq2 = freq[j];
                      if (Math.abs(val2 - val1) > 1e-3) {
                          const t = (targetRelLevel - val1) / (val2 - val1);
                          f2 = freq1 + t * (freq2 - freq1);
                      } else {
                          f2 = freq[j];
                      }
                      break;
                  }
                  f2 = freq[j]; // Keep track of furthest point reached
              }

              // Calculate Q = fc / (f2 - f1)
              if (f2 > f1) {
                  const bandwidth = f2 - f1;
                  if (bandwidth > 1e-3) { // Ensure bandwidth is positive
                      Q = fc / bandwidth;
                      // Sign-dependent upper bound: peak up to 1/6 oct, dip up to 1/3 oct
                      Q = Math.max(0.5, Math.min(qMaxForGain(limitedGain), Q));
                  }
              }

              initParams.push(limitedGain, Q, fc);
          }

          // If more bands are needed, fill with logarithmically spaced bands
          if (selectedIndices.length < targetBands) {
              const logLow = Math.log10(lowFreq);
              const logHigh = Math.log10(highFreq);
              // Generate more points than needed initially
              const potentialFreqs = [];
              for (let i = 1; i <= targetBands * 2; i++) {
                  const logF = logLow + (logHigh - logLow) * i / (targetBands * 2 + 1);
                  potentialFreqs.push(10**logF);
              }

              // Filter potential frequencies to be far from existing initial bands
              const existingFreqs = initParams.filter((_, idx) => idx % 3 === 2);
              const additionalFreqs = potentialFreqs.filter(pf => {
                  let minDist = Infinity;
                  existingFreqs.forEach(ef => {
                      minDist = Math.min(minDist, Math.abs(Math.log2(pf / ef)));
                  });
                  return minDist > 0.3; // Require at least ~1/3 octave separation
              });

              const needed = targetBands - selectedIndices.length;
              for (let i = 0; i < Math.min(needed, additionalFreqs.length); i++) {
                  const targetFc = additionalFreqs[i];
                  let closestIdx = 0;
                  let minLogDist = Infinity;
                  for (let j = 0; j < freq.length; j++) {
                      const dist = Math.abs(Math.log10(freq[j]) - Math.log10(targetFc));
                      if (dist < minLogDist) {
                          minLogDist = dist;
                          closestIdx = j;
                      }
                  }
                  const fc = freq[closestIdx];
                  const gain = -smoothedMag[closestIdx];
                  const Q = 1.41;
                  initParams.push(gain, Q, fc);
              }

              // If still not enough, add default bands
              while(initParams.length / 3 < targetBands) {
                  initParams.push(0.0, 1.41, 1000); // Default band at 1kHz
              }
          }
      }

      // Ensure we have exactly the target number of bands before optimization
      if (initParams.length / 3 !== targetBands) {
          // Truncate or pad if necessary (should ideally not happen with above logic)
           initParams.length = targetBands * 3;
           for(let i = 0; i < initParams.length; i++) {
              if (typeof initParams[i] === 'undefined') {
                  const type = i % 3; // 0=gain, 1=Q, 2=fc
                   initParams[i] = (type === 0) ? 0.0 : (type === 1 ? 1.41 : 1000);
              }
           }
      }

      console.log("Initial parameters prepared, starting optimization...");
      // 4. Optimize PEQ parameters using Levenberg-Marquardt
      let optimizedFlatParams = [];
      try {
          // Pass regularization options to fitPEQ
          optimizedFlatParams = fitPEQ(freq, magDb, initParams, lowFreq, highFreq, fs, { regularization }); // Pass original non-smoothed magDb for optimization
          if (!optimizedFlatParams || optimizedFlatParams.length !== targetBands * 3) {
               throw new Error("Optimization returned unexpected number of parameters or failed.");
          }
      } catch (error) {
          console.error("Error during PEQ optimization:", error);
          console.warn("Optimization failed, falling back to initial parameters.");
          optimizedFlatParams = initParams; // Use initial guess as fallback
      }

      // Convert flat optimized parameters to array of band objects
      const optimizedBands = [];
      for (let i = 0; i < targetBands; i++) {
          const idx = i * 3;
          const band = {
              frequency: optimizedFlatParams[idx + 2],
              gain: optimizedFlatParams[idx],
              Q: optimizedFlatParams[idx + 1],
              type: 'peaking'
          };
          // Basic validation of optimized parameters
           if (isFinite(band.frequency) && band.frequency > 0 &&
               isFinite(band.gain) &&
               isFinite(band.Q) && band.Q > 0) {
               optimizedBands.push(band);
           } else {
               console.warn(`Optimized band ${i+1} has invalid parameters, skipping.`);
           }
      }

      if (optimizedBands.length === 0) {
          console.error("designPEQ: No valid bands after optimization.");
          return createDefaultBands(bandCount, lowFreq, highFreq);
      }

      // 5. Post-process: Resolve collisions and limit band count
      console.log("Optimization complete. Processing collisions and limiting bands...");
      const finalParams = processCollisions(optimizedBands, bandCount); // Use original bandCount target

       // Ensure the final number of bands matches the requested count, adding defaults if needed
       if (finalParams.length < bandCount) {
           console.warn(`designPEQ: Resulted in ${finalParams.length} bands, need ${bandCount}. Adding defaults.`);
           const defaultsNeeded = bandCount - finalParams.length;
           const defaultBands = createDefaultBands(defaultsNeeded, lowFreq, highFreq);
           // Add defaults, trying to space them reasonably
           const existingFreqs = finalParams.map(b => b.frequency);
           let defaultIdx = 0;
           while (finalParams.length < bandCount && defaultIdx < defaultBands.length) {
               const defaultBand = defaultBands[defaultIdx++];
               // Check if frequency is too close to existing bands
               let tooClose = false;
               for(const ef of existingFreqs) {
                  if(Math.abs(Math.log2(defaultBand.frequency / ef)) < 0.2) { // Avoid bands closer than ~1/5 octave
                      tooClose = true;
                      break;
                  }
               }
               if (!tooClose) {
                  finalParams.push(defaultBand);
                  existingFreqs.push(defaultBand.frequency);
               }
           }
           // If still not enough, force add remaining defaults
           while (finalParams.length < bandCount && defaultIdx < defaultBands.length) {
                finalParams.push(defaultBands[defaultIdx++]);
           }
           finalParams.sort((a,b) => a.frequency - b.frequency); // Re-sort after adding defaults
       }

      console.log(`designPEQ: Returning ${finalParams.length} PEQ bands.`);
      return finalParams;

  } catch (error) {
      console.error("Exception in designPEQ:", error);
      return createDefaultBands(bandCount, lowFreq, highFreq); // Fallback on any exception
  }
} 