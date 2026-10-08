/**
 * Smoothing functions for frequency response processing.
 */

/**
 * Smooth frequency response using logarithmic windowing.
 * @param {number[]} freq - Array of frequency values.
 * @param {number[]} magDb - Array of magnitude values in dB.
 * @param {number} binsPerOct - Number of bins per octave for smoothing.
 * @returns {number[]} Smoothed magnitude values.
 */
export function smoothLog(freq, magDb, binsPerOct) {
  // Basic input validation
  if (!freq || !magDb || freq.length < 3 || magDb.length < 3 || freq.length !== magDb.length) {
    console.warn("smoothLog: Invalid input data, returning original");
    return magDb;
  }

  // Ensure frequency values are valid (ascending and positive)
  for (let i = 0; i < freq.length; i++) {
      if (typeof freq[i] !== 'number' || !isFinite(freq[i]) || freq[i] <= 0) {
          console.warn("smoothLog: Invalid frequency value, returning original");
          return magDb;
      }
      if (i > 0 && freq[i] <= freq[i - 1]) {
          console.warn("smoothLog: Frequencies not ascending, returning original");
          return magDb;
      }
  }
  // Ensure magnitude values are valid
  if (magDb.some(m => typeof m !== 'number' || !isFinite(m))) {
      console.warn("smoothLog: Invalid magnitude value, returning original");
      return magDb;
  }


  const minFreq = Math.max(1, freq[0]); // Avoid log(0)
  const maxFreq = freq[freq.length - 1];
  if (maxFreq <= minFreq * 1.01) { // Ensure a minimal range
      console.warn("smoothLog: Frequency range too narrow, returning original");
      return magDb;
  }

  const minLogFreq = Math.log10(minFreq);
  const maxLogFreq = Math.log10(maxFreq);
  const octaveRange = (maxLogFreq - minLogFreq) / Math.log10(2);

  if (octaveRange <= 0 || !isFinite(octaveRange)) {
      console.warn("smoothLog: Invalid octave range, returning original");
      return magDb;
  }

  // Determine the number of points for the log-spaced grid
  // Aim for roughly binsPerOct points per octave, but ensure enough points for smoothing
  const numBins = Math.max(5, Math.min(1000, Math.ceil(octaveRange * binsPerOct) + 1));
  const logSpacedFreq = new Array(numBins);
  const logStep = (maxLogFreq - minLogFreq) / Math.max(1, numBins - 1);

  try {
      // Generate log-spaced frequency points
      for (let i = 0; i < numBins; i++) {
          logSpacedFreq[i] = 10**(minLogFreq + i * logStep);
      }

      // Interpolate magnitude values onto the log-spaced grid
      const logSpacedMag = new Array(numBins);
      let currentInputIdx = 0;
      for (let i = 0; i < numBins; i++) {
          const targetFreq = logSpacedFreq[i];

          // Find the segment in the original data that contains targetFreq
          while (currentInputIdx < freq.length - 2 && freq[currentInputIdx + 1] < targetFreq) {
              currentInputIdx++;
          }

          // Linear interpolation
          const f1 = freq[currentInputIdx];
          const f2 = freq[currentInputIdx + 1];
          const m1 = magDb[currentInputIdx];
          const m2 = magDb[currentInputIdx + 1];

          if (targetFreq <= f1) {
              logSpacedMag[i] = m1;
          } else if (targetFreq >= f2) {
               logSpacedMag[i] = m2;
               // Optimization: If the next target freq is also beyond f2, keep currentInputIdx
               if (i + 1 < numBins && logSpacedFreq[i+1] >= f2) {
                   // no change needed
               } else {
                   // move index forward if we are not at the end
                   if (currentInputIdx < freq.length - 2) currentInputIdx++;
               }
          } else {
              // Interpolate: m = m1 + (targetFreq - f1) * (m2 - m1) / (f2 - f1)
              // Use log-frequency interpolation for potentially better results in audio
              const logTarget = Math.log10(targetFreq);
              const logF1 = Math.log10(f1);
              const logF2 = Math.log10(f2);
              const ratio = (logTarget - logF1) / (logF2 - logF1);
              logSpacedMag[i] = m1 + ratio * (m2 - m1);
              // If the next target freq is also in this segment, keep currentInputIdx
              if (i + 1 < numBins && logSpacedFreq[i+1] < f2) {
                   // no change needed
              } else {
                  // move index forward if we are not at the end
                   if (currentInputIdx < freq.length - 2) currentInputIdx++;
              }
          }
           if (typeof logSpacedMag[i] !== 'number' || !isFinite(logSpacedMag[i])) {
              console.warn(`smoothLog: Interpolation yielded invalid value at bin ${i}, using previous.`);
              logSpacedMag[i] = (i > 0) ? logSpacedMag[i-1] : 0; // Use previous or 0
           }
      }

      // Apply smoothing using a Hanning window on the log-spaced data
      // Window size related to binsPerOct, ensuring it's odd and within bounds
      let windowSize = Math.min(numBins, 2 * Math.floor(binsPerOct / 2) + 1); // Ensure odd
      windowSize = Math.max(3, windowSize); // Minimum size of 3

      const win = new Array(windowSize);
      for (let i = 0; i < windowSize; i++) {
          win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (windowSize - 1)));
      }
      const windowSum = win.reduce((a, b) => a + b, 0);
      if (Math.abs(windowSum) < 1e-10) {
           console.warn("smoothLog: Window sum too small, returning original");
           return magDb; // Avoid division by zero
      }
      const normalizedWin = win.map(w => w / windowSum);

      const smoothedLogMag = new Array(numBins);
      const halfWin = Math.floor(windowSize / 2);

      for (let i = 0; i < numBins; i++) {
          let sum = 0;
          for (let j = 0; j < windowSize; j++) {
              let sampleIdx = i - halfWin + j;
              // Boundary handling (reflection)
              if (sampleIdx < 0) sampleIdx = -sampleIdx;
              if (sampleIdx >= numBins) sampleIdx = 2 * numBins - sampleIdx - 2;
              sampleIdx = Math.max(0, Math.min(numBins - 1, sampleIdx)); // Clamp index
              sum += logSpacedMag[sampleIdx] * normalizedWin[j];
          }
           if (typeof sum !== 'number' || !isFinite(sum)) {
               console.warn(`smoothLog: Smoothing yielded invalid value at bin ${i}, using original interpolated.`);
               smoothedLogMag[i] = logSpacedMag[i]; // Use original interpolated value as fallback
           } else {
              smoothedLogMag[i] = sum;
           }
      }

      // Interpolate back to the original frequency points
      const smoothed = new Array(freq.length);
      currentInputIdx = 0; // Reset index for log-spaced data
      for (let i = 0; i < freq.length; i++) {
          const targetFreq = freq[i];

          // Find the segment in the log-spaced data
          while (currentInputIdx < numBins - 2 && logSpacedFreq[currentInputIdx + 1] < targetFreq) {
              currentInputIdx++;
          }

          const f1 = logSpacedFreq[currentInputIdx];
          const f2 = logSpacedFreq[currentInputIdx + 1];
          const m1 = smoothedLogMag[currentInputIdx];
          const m2 = smoothedLogMag[currentInputIdx + 1];

          if (targetFreq <= f1) {
              smoothed[i] = m1;
          } else if (targetFreq >= f2) {
              smoothed[i] = m2;
          } else {
               const logTarget = Math.log10(targetFreq);
               const logF1 = Math.log10(f1);
               const logF2 = Math.log10(f2);
               const ratio = (logTarget - logF1) / (logF2 - logF1);
               smoothed[i] = m1 + ratio * (m2 - m1);
          }
           if (typeof smoothed[i] !== 'number' || !isFinite(smoothed[i])) {
               console.warn(`smoothLog: Final interpolation yielded invalid value at index ${i}, using original.`);
               smoothed[i] = magDb[i]; // Fallback to original unsmoothed data
           }
      }

      return smoothed;

  } catch (error) {
      console.error("Error during smoothLog execution:", error);
      return magDb; // Return original data on error
  }
}
