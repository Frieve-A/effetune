/**
 * Optimization functions for PEQ parameter fitting.
 */
import { peqResponse } from './filter-response.js';

/**
 * Default regularization parameters for all optimization functions.
 * These control how strongly to penalize large gain values and high Q factors.
 */
export const DEFAULT_REGULARIZATION = {
  /**
   * Default weight for gain regularization (0-1 recommended).
   * Higher values promote smaller gain adjustments.
   */
  gainWeight: 0.0,

  /**
   * Default weight for Q regularization (0-1 recommended).
   * Higher values promote wider bandwidth filters.
   */
  qWeight: 1.0
};

// Q upper bounds derived from minimum bandwidth (octaves):
//   BW(oct) -> Q = sqrt(2^BW) / (2^BW - 1)
// Peak: min 1/6 oct -> Q_MAX_PEAK ≈ 8.6511
// Dip : min 1/3 oct -> Q_MAX_DIP  ≈ 4.3187
export const Q_MAX_PEAK = Math.sqrt(Math.pow(2, 1 / 6)) / (Math.pow(2, 1 / 6) - 1);
export const Q_MAX_DIP = Math.sqrt(Math.pow(2, 1 / 3)) / (Math.pow(2, 1 / 3) - 1);
export const LOG_Q_MAX_PEAK = Math.log10(Q_MAX_PEAK);
export const LOG_Q_MAX_DIP = Math.log10(Q_MAX_DIP);

// Weight multiplier applied to Q regularization when Q exceeds the per-type cap.
// Acts as a soft barrier so the optimizer is strongly discouraged from crossing it.
const Q_CAP_BARRIER_WEIGHT = 10;

// Frequently-used mathematical constants hoisted to module scope
const LN10 = Math.log(10);

// Hysteresis threshold (dB). Gains with |g| below this are treated as dips
// (stricter cap) so the cap does not flip rapidly around g = 0.
const PEAK_DIP_HYSTERESIS_DB = 0.3;

/**
 * Return Q upper bound for a given gain, using a hysteresis band around 0 dB.
 * Only clearly positive gains (> hysteresis) are treated as peaks.
 * @param {number} gainDb
 * @returns {number}
 */
export function qMaxForGain(gainDb) {
  return gainDb > PEAK_DIP_HYSTERESIS_DB ? Q_MAX_PEAK : Q_MAX_DIP;
}

/**
 * Return log10(Q) upper bound for a given gain.
 * @param {number} gainDb
 * @returns {number}
 */
export function logQMaxForGain(gainDb) {
  return gainDb > PEAK_DIP_HYSTERESIS_DB ? LOG_Q_MAX_PEAK : LOG_Q_MAX_DIP;
}

/**
 * Compute the error vector for least squares optimization (log-space parameters).
 * Error = target_linear * combined_response_linear - 1.0
 * @param {number[]} logParams - Filter parameters [g1, logQ1, logFc1, ...].
 * @param {number[]} freq - Array of frequency values.
 * @param {number[]} targetDb - Target response in dB (deviation to be corrected).
 * @param {number} lowFreq - Low frequency limit.
 * @param {number} highFreq - High frequency limit.
 * @param {number} fs - Sampling frequency.
 * @param {Object} [regularization] - Regularization parameters. 
 * @param {number} [regularization.gainWeight=0.05] - Weight for gain regularization.
 * @param {number} [regularization.qWeight=0.1] - Weight for Q regularization.
 * @returns {number[]} Array of error values at each frequency.
 */
export function errorFunctionLogSpace(logParams, freq, targetDb, lowFreq, highFreq, fs, regularization = DEFAULT_REGULARIZATION) {
  const nFreq = freq.length;
  const numFilters = (logParams.length / 3) | 0;

  const hasReg = !!regularization && (regularization.gainWeight > 0 || regularization.qWeight > 0);
  const gainTerms = hasReg && regularization.gainWeight > 0 ? numFilters : 0;
  const qTerms = hasReg && regularization.qWeight > 0 ? numFilters : 0;
  const totalErrors = nFreq + gainTerms + qTerms;

  // Preallocate combined response and final errors array (avoids push() resizing).
  const combinedRespDb = new Array(nFreq);
  for (let k = 0; k < nFreq; k++) combinedRespDb[k] = 0;

  // Calculate the combined response of all PEQ filters
  for (let i = 0; i < numFilters; i++) {
    const baseIdx = i * 3;
    const gain = logParams[baseIdx];
    const Q = 10**logParams[baseIdx + 1]; // Convert logQ to Q
    const fc = 10**logParams[baseIdx + 2]; // Convert logFc to fc

    // Skip if parameters are invalid (e.g., during numerical differentiation).
    // Equivalent to the previous !isFinite + <=0 guard; NaN compares false so the
    // (fc > 0 && Q > 0) test also rejects NaN. Inf is caught by peqResponse's own guards.
    if (!(fc > 0) || !(Q > 0) || gain !== gain) {
         console.warn(`Skipping filter ${i} due to invalid parameters: gain=${gain}, Q=${Q}, fc=${fc}`);
         continue;
    }

    const singleRespDb = peqResponse(freq, fc, gain, Q, fs);
    for (let k = 0; k < nFreq; k++) {
      combinedRespDb[k] += singleRespDb[k];
    }
  }

  // Calculate the error in the linear amplitude domain.
  // Error aims to make target * response = 1 (0 dB flat).
  const errors = new Array(totalErrors);
  const lo = lowFreq, hi = highFreq;
  const INV_20 = 1 / 20;

  for (let k = 0; k < nFreq; k++) {
      const fk = freq[k];
      if (fk < lo || fk > hi) {
          errors[k] = 0; // outside weighted range
          continue;
      }
      const targetLin = 10**(targetDb[k] * INV_20);
      const respLin = 10**(combinedRespDb[k] * INV_20);
      const e = targetLin * respLin - 1.0;
      // NaN/Inf guard (e !== e catches NaN; finite range catches Infinity cheaply)
      errors[k] = (e === e && e < 1e308 && e > -1e308) ? e : 0;
  }

  // Add regularization errors at their preallocated slots
  if (hasReg) {
    let idx = nFreq;

    if (gainTerms > 0) {
      const gw = regularization.gainWeight;
      for (let i = 0; i < numFilters; i++) {
        const gain = logParams[i * 3];
        // |gain| via ternary (faster than Math.abs in this harness)
        const absGain = gain < 0 ? -gain : gain;
        errors[idx++] = gw * absGain;
      }
    }

    if (qTerms > 0) {
      const qw = regularization.qWeight;
      for (let i = 0; i < numFilters; i++) {
        const gain = logParams[i * 3];
        const Q = 10**logParams[i * 3 + 1];
        const qCap = gain > PEAK_DIP_HYSTERESIS_DB ? Q_MAX_PEAK : Q_MAX_DIP;
        // max(0, Q-1) via ternary
        const qSoft = Q > 1.0 ? Q - 1.0 : 0;
        const qBarrier = Q > qCap ? Q_CAP_BARRIER_WEIGHT * (Q - qCap) : 0;
        errors[idx++] = qw * (qSoft + qBarrier);
      }
    }
  }

  return errors;
}

/**
 * Calculate the Jacobian matrix using numerical differentiation (central differences).
 * J[i][j] = ∂error[j] / ∂param[i]
 * @param {number[]} params - Current parameter vector (log-space).
 * @param {number[]} freq - Array of frequency values.
 * @param {number[]} targetDb - Target response in dB.
 * @param {number[]} boundsLow - Lower bounds for parameters.
 * @param {number[]} boundsHigh - Upper bounds for parameters.
 * @param {number} lowFreq - Low frequency limit.
 * @param {number} highFreq - High frequency limit.
 * @param {number} fs - Sampling frequency.
 * @param {Object} [regularization] - Regularization parameters.
 * @returns {Array<Array<number>>} Jacobian matrix (numParams x numErrorTerms).
 */
function calculateJacobian(params, freq, targetDb, boundsLow, boundsHigh, lowFreq, highFreq, fs, regularization = DEFAULT_REGULARIZATION) {
  const baseErrors = errorFunctionLogSpace(params, freq, targetDb, lowFreq, highFreq, fs, regularization);
  const numParams = params.length;
  const numErrorTerms = baseErrors.length; // Include regularization terms
  const numFilters = (params.length / 3) | 0;
  const nFreq = freq.length;

  // Initialize Jacobian matrix with the correct size
  const jacobian = new Array(numParams);
  for (let i = 0; i < numParams; i++) {
    const row = new Array(numErrorTerms);
    for (let j = 0; j < numErrorTerms; j++) row[j] = 0;
    jacobian[i] = row;
  }

  // Optimal step size 'h' for numerical differentiation
  const eps = 2.22e-16; // Machine epsilon
  const baseStep = Math.sqrt(eps);
  const hMin = eps * 100;

  for (let i = 0; i < numParams; i++) {
    const currentParam = params[i];
    // |currentParam| — ternary is faster than Math.abs in this harness
    const absP = currentParam < 0 ? -currentParam : currentParam;
    // h = baseStep * max(1, |p|), then ensured >= hMin
    const scale = absP > 1.0 ? absP : 1.0;
    let h = baseStep * scale;
    if (h < hMin) h = hMin;

    // .slice() is typically faster than spread for large numeric arrays
    const paramsPlus = params.slice();
    const paramsMinus = params.slice();

    // Check bounds and decide differentiation method
    let errorsPlus, errorsMinus;
    const canStepUp = currentParam + h <= boundsHigh[i];
    const canStepDown = currentParam - h >= boundsLow[i];
    const jacRow = jacobian[i];

    if (canStepUp && canStepDown) {
      // Central difference
      paramsPlus[i] = currentParam + h;
      paramsMinus[i] = currentParam - h;
      errorsPlus = errorFunctionLogSpace(paramsPlus, freq, targetDb, lowFreq, highFreq, fs, regularization);
      errorsMinus = errorFunctionLogSpace(paramsMinus, freq, targetDb, lowFreq, highFreq, fs, regularization);

      const inv2h = 1 / (2 * h);
      for (let j = 0; j < numErrorTerms; j++) {
        const d = (errorsPlus[j] - errorsMinus[j]) * inv2h;
        // Finite check via NaN self-compare + Infinity range — cheaper than isFinite()
        jacRow[j] = (d === d && d < 1e308 && d > -1e308) ? d : 0;
      }
    } else if (canStepUp) {
      // Forward difference (at lower bound)
      const stepRoom = (boundsHigh[i] - currentParam) * 0.5;
      if (stepRoom < h) h = stepRoom;
      if (h < hMin) {
        // already zero-initialized — nothing to do
      } else {
        paramsPlus[i] = currentParam + h;
        errorsPlus = errorFunctionLogSpace(paramsPlus, freq, targetDb, lowFreq, highFreq, fs, regularization);
        const invH = 1 / h;
        for (let j = 0; j < numErrorTerms; j++) {
          const d = (errorsPlus[j] - baseErrors[j]) * invH;
          jacRow[j] = (d === d && d < 1e308 && d > -1e308) ? d : 0;
        }
      }
    } else if (canStepDown) {
      // Backward difference (at upper bound)
      const stepRoom = (currentParam - boundsLow[i]) * 0.5;
      if (stepRoom < h) h = stepRoom;
      if (h < hMin) {
        // already zero-initialized
      } else {
        paramsMinus[i] = currentParam - h;
        errorsMinus = errorFunctionLogSpace(paramsMinus, freq, targetDb, lowFreq, highFreq, fs, regularization);
        const invH = 1 / h;
        for (let j = 0; j < numErrorTerms; j++) {
          const d = (baseErrors[j] - errorsMinus[j]) * invH;
          jacRow[j] = (d === d && d < 1e308 && d > -1e308) ? d : 0;
        }
      }
    }
    // else: stuck at bound — row stays zero (already initialized)

    // Analytical regularization derivatives (sparse: only the diagonal entry of
    // the matching filter's block is non-zero). We first zero the regularization
    // columns populated by numerical differentiation (they contain only noise since
    // regularization depends on each filter's own gain/Q), then write the analytical
    // value into the single relevant slot.
    if (regularization && (regularization.gainWeight > 0 || regularization.qWeight > 0)) {
      for (let j = nFreq; j < numErrorTerms; j++) jacRow[j] = 0;

      const paramType = i % 3;               // 0=gain, 1=logQ, 2=logFc
      const filterIdx = (i / 3) | 0;         // bit-shift floor (cheaper than Math.floor)
      let regTermIdx = nFreq;

      if (regularization.gainWeight > 0) {
        if (paramType === 0) {
          const gain = params[filterIdx * 3];
          // d(w * |gain|)/d(gain) = w * sign(gain)
          jacRow[regTermIdx + filterIdx] = regularization.gainWeight * (gain >= 0 ? 1.0 : -1.0);
        }
        regTermIdx += numFilters;
      }

      if (regularization.qWeight > 0) {
        if (paramType === 1) {
          const gainK = params[filterIdx * 3];
          const Q = 10**params[filterIdx * 3 + 1];
          const qCap = gainK > PEAK_DIP_HYSTERESIS_DB ? Q_MAX_PEAK : Q_MAX_DIP;
          let factor = 0;
          if (Q > 1.0) factor += 1;
          if (Q > qCap) factor += Q_CAP_BARRIER_WEIGHT;
          if (factor > 0) {
            jacRow[regTermIdx + filterIdx] = regularization.qWeight * factor * Q * LN10;
          }
        }
      }
    }
  }

  return jacobian;
}

/**
 * Calculate the JᵀJ matrix and Jᵀe vector.
 * @param {Array<Array<number>>} jacobian - Jacobian matrix (numParams x numErrorTerms).
 * @param {number[]} errors - Error vector (numErrorTerms).
 * @returns {[Array<Array<number>>, Array<number>]} [JᵀJ matrix (numParams x numParams), Jᵀe vector (numParams)].
 */
function calculateJtJandJte(jacobian, errors) {
  const numParams = jacobian.length;
  if (numParams === 0) return [[], []]; // Handle empty jacobian
  
  // Use actual error vector length (including regularization terms)
  const numErrorTerms = errors.length;
  
  // Check if jacobian has correct dimensions
  if (jacobian[0].length !== numErrorTerms) {
    console.error(`Jacobian columns (${jacobian[0].length}) don't match error vector length (${numErrorTerms})`);
    // Attempt to resolve dimension mismatch safely
    const usableSize = Math.min(jacobian[0].length, numErrorTerms);
    console.warn(`Using only first ${usableSize} error terms for optimization`);
    
    // Create properly sized arrays for calculations
    const JtJ = Array(numParams).fill(0).map(() => Array(numParams).fill(0));
    const Jte = Array(numParams).fill(0);
    
    // Calculate JᵀJ and Jᵀe with truncated dimensions
    for (let i = 0; i < numParams; i++) {
      for (let j = i; j < numParams; j++) {
        let sum = 0;
        for (let k = 0; k < usableSize; k++) {
          const val_i = isFinite(jacobian[i][k]) ? jacobian[i][k] : 0;
          const val_j = isFinite(jacobian[j][k]) ? jacobian[j][k] : 0;
          sum += val_i * val_j;
        }
        JtJ[i][j] = isFinite(sum) ? sum : 0;
        if (i !== j) {
          JtJ[j][i] = JtJ[i][j]; // Symmetric matrix
        }
      }
      
      let sum = 0;
      for (let k = 0; k < usableSize; k++) {
        const val_jac = isFinite(jacobian[i][k]) ? jacobian[i][k] : 0;
        const val_err = isFinite(errors[k]) ? errors[k] : 0;
        sum += val_jac * val_err;
      }
      Jte[i] = isFinite(sum) ? sum : 0;
    }
    
    return [JtJ, Jte];
  }

  // Initialize JᵀJ and Jᵀe arrays
  const JtJ = new Array(numParams);
  for (let i = 0; i < numParams; i++) {
    const row = new Array(numParams);
    for (let j = 0; j < numParams; j++) row[j] = 0;
    JtJ[i] = row;
  }
  const Jte = new Array(numParams);
  for (let i = 0; i < numParams; i++) Jte[i] = 0;

  // Calculate JᵀJ = Jacobianᵀ * Jacobian
  // jacobian entries and errors are guaranteed finite (guarded at write time),
  // so the per-element isFinite checks from the previous implementation are dropped.
  // Only the accumulated sum is sanity-checked (defensive, cheap).
  for (let i = 0; i < numParams; i++) {
    const rowI = jacobian[i];
    for (let j = i; j < numParams; j++) {
      const rowJ = jacobian[j];
      let sum = 0;
      for (let k = 0; k < numErrorTerms; k++) {
        sum += rowI[k] * rowJ[k];
      }
      // finite check via self-compare + range (no function call)
      if (!(sum === sum && sum < 1e308 && sum > -1e308)) sum = 0;
      JtJ[i][j] = sum;
      if (i !== j) JtJ[j][i] = sum;
    }
  }

  // Calculate Jᵀe = Jacobianᵀ * errors
  for (let i = 0; i < numParams; i++) {
    const rowI = jacobian[i];
    let sum = 0;
    for (let k = 0; k < numErrorTerms; k++) {
      sum += rowI[k] * errors[k];
    }
    if (!(sum === sum && sum < 1e308 && sum > -1e308)) sum = 0;
    Jte[i] = sum;
  }

  return [JtJ, Jte];
}

/**
 * Solve the linear system Ax = b using Gaussian elimination with partial pivoting.
 * @param {Array<Array<number>>} A - The coefficient matrix (n x n). Modified in place.
 * @param {number[]} b - The right-hand side vector (n). Modified in place.
 * @returns {number[]} The solution vector x (n).
 * @throws {Error} If the matrix is singular or numerically unstable.
 */
function solveEquation(A, b) {
  const n = b.length;
  // Create copies to avoid modifying original arrays passed to fitPEQ (explicit
  // loops avoid the double allocation of .map + spread).
  const a = new Array(n);
  for (let i = 0; i < n; i++) {
    const src = A[i];
    const row = new Array(n);
    for (let j = 0; j < n; j++) row[j] = src[j];
    a[i] = row;
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = b[i];

  // Forward Elimination with Partial Pivoting
  for (let i = 0; i < n; i++) {
    // Find pivot row (row with largest |a[k][i]| at or below row i)
    let maxRow = i;
    const pivVal = a[i][i];
    let maxAbs = pivVal < 0 ? -pivVal : pivVal;
    for (let k = i + 1; k < n; k++) {
      const v = a[k][i];
      const av = v < 0 ? -v : v;
      if (av > maxAbs) {
        maxAbs = av;
        maxRow = k;
      }
    }

     // Swap rows i and maxRow in matrix A and vector x (representing b)
     if (maxRow !== i) {
       const tmpR = a[i]; a[i] = a[maxRow]; a[maxRow] = tmpR;
       const tmpX = x[i]; x[i] = x[maxRow]; x[maxRow] = tmpX;
     }

     // Check for singularity or near-singularity
     const pivot = a[i][i];
     if (pivot < 1e-12 && pivot > -1e-12) {
         // If pivot is near zero, the matrix is likely singular or ill-conditioned.
          let nonZeroBelow = false;
          for (let k = i + 1; k < n; ++k) {
              const v = a[k][i];
              const av = v < 0 ? -v : v;
              if (av >= 1e-12) { nonZeroBelow = true; break; }
          }
          if (!nonZeroBelow) {
              console.warn(`solveEquation: Matrix appears singular at column ${i}. Pivot ~0.`);
              throw new Error(`Matrix is singular or near-singular at column ${i}. Pivot: ${pivot}`);
          }
          console.warn(`solveEquation: Small pivot ${pivot} at column ${i} despite non-zero elements below.`);
          throw new Error(`Potential numerical instability with small pivot at column ${i}`);
     }

    // Eliminate column i for rows below row i
    for (let k = i + 1; k < n; k++) {
      const factor = a[k][i] / pivot;
      x[k] -= factor * x[i]; // Apply same operation to vector x
      // Apply to matrix row k
      // Start from column i because columns before i should already be zero
      // a[k][i] will become zero (or very close due to floating point)
      for (let j = i; j < n; j++) {
        a[k][j] -= factor * a[i][j];
      }
        // Explicitly set the element to 0 to avoid potential small non-zero values
         a[k][i] = 0.0;
    }
  }

  // Back Substitution
  const solution = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
      const diagElement = a[i][i];
      if (diagElement < 1e-12 && diagElement > -1e-12) {
           console.error(`solveEquation: Zero or near-zero diagonal element ${diagElement} at row ${i} during back substitution.`);
           throw new Error(`Zero diagonal element during back substitution at row ${i}. Matrix is singular.`);
      }

      const rowI = a[i];
      let sum = 0;
      for (let j = i + 1; j < n; j++) {
          sum += rowI[j] * solution[j];
      }
      const s = (x[i] - sum) / diagElement;
      if (!(s === s && s < 1e308 && s > -1e308)) {
          console.error(`solveEquation: Non-finite value (${s}) computed for solution element ${i}.`);
          throw new Error(`Non-finite solution element ${i} computed.`);
      }
      solution[i] = s;
  }

  return solution;
}

/**
 * Fit parametric EQ parameters using Levenberg-Marquardt optimization.
 * @param {number[]} freq - Array of frequency values.
 * @param {number[]} targetDb - Target response in dB (deviation from flat).
 * @param {number[]} initParams - Initial guess [g1, Q1, fc1, ...].
 * @param {number} lowFreq - Low frequency limit.
 * @param {number} highFreq - High frequency limit.
 * @param {number} fs - Sampling frequency.
 * @param {Object} [options] - Additional options.
 * @param {Object} [options.regularization] - Regularization parameters.
 * @returns {number[]} Optimized parameters [g1, Q1, fc1, ...].
 */
export function fitPEQ(freq, targetDb, initParams, lowFreq, highFreq, fs, options = {}) {
  const numFilters = Math.floor(initParams.length / 3);
  if (numFilters === 0) return [];

  // Setup regularization parameters with recommended defaults
  const regularization = {
    gainWeight: options.regularization?.gainWeight ?? DEFAULT_REGULARIZATION.gainWeight,
    qWeight: options.regularization?.qWeight ?? DEFAULT_REGULARIZATION.qWeight
  };

  // Convert initial parameters to log-space for optimization
  // [gain, log10(Q), log10(fc)]
  const numParams = numFilters * 3;
  let params = new Array(numParams);
  const logQMin = Math.log10(0.5); // Q lower bound
  // Upper bound uses the looser (peak) cap; per-iteration sign-dependent clamping
  // tightens it to the dip cap when the band's gain is non-positive.
  const logQMax = LOG_Q_MAX_PEAK;
  const fcLo = lowFreq * 0.9;
  const fcHi = highFreq * 1.1;
  const logFcMin = Math.log10(fcLo);
  const logFcMax = Math.log10(fcHi);
  const gainMin = -18;
  const gainMax = 18;

  for (let i = 0; i < numFilters; i++) {
      const baseIdx = i * 3;
      let gain = initParams[baseIdx];
      if (gain < gainMin) gain = gainMin; else if (gain > gainMax) gain = gainMax;

      const qCap = gain > PEAK_DIP_HYSTERESIS_DB ? Q_MAX_PEAK : Q_MAX_DIP;
      let Q = initParams[baseIdx + 1];
      if (Q < 0.5) Q = 0.5; else if (Q > qCap) Q = qCap;

      let fc = initParams[baseIdx + 2];
      if (fc < fcLo) fc = fcLo; else if (fc > fcHi) fc = fcHi;

      const logQUpper = gain > PEAK_DIP_HYSTERESIS_DB ? LOG_Q_MAX_PEAK : LOG_Q_MAX_DIP;
      let logQ = Math.log10(Q);
      if (logQ < logQMin) logQ = logQMin; else if (logQ > logQUpper) logQ = logQUpper;

      let logFc = Math.log10(fc);
      if (logFc < logFcMin) logFc = logFcMin; else if (logFc > logFcMax) logFc = logFcMax;

      params[baseIdx] = gain;
      params[baseIdx + 1] = logQ;
      params[baseIdx + 2] = logFc;
  }

  // Parameter bounds for optimization
  const boundsLow = new Array(numParams);
  const boundsHigh = new Array(numParams);
  for (let i = 0; i < numFilters; i++) {
    const b = i * 3;
    boundsLow[b] = gainMin;     boundsHigh[b] = gainMax;
    boundsLow[b + 1] = logQMin; boundsHigh[b + 1] = logQMax;
    boundsLow[b + 2] = logFcMin; boundsHigh[b + 2] = logFcMax;
  }

  // Levenberg-Marquardt parameters
  let lambda = 0.001; // Initial damping factor
  const lambdaDecrease = 0.25;
  const lambdaIncrease = 4.0;
  const maxIterations = 100;
  const costEpsilon = 1e-7; // Stricter tolerance for cost change
  const gradEpsilon = 1e-9; // Stricter tolerance for gradient
  const paramEpsilon = 1e-7; // Tolerance for parameter change

  let errors = errorFunctionLogSpace(params, freq, targetDb, lowFreq, highFreq, fs, regularization);
  // Mean squared error (manual reduction avoids closure overhead)
  let currentCost = 0;
  for (let i = 0; i < errors.length; i++) currentCost += errors[i] * errors[i];
  currentCost /= errors.length;

  // Preallocate reusable buffers (recycled each iteration via reference swap)
  let newParams = new Array(numParams);
  const negJte = new Array(numParams);

  // Optimization loop
  for (let iter = 0; iter < maxIterations; iter++) {

    // Calculate Jacobian matrix J = ∂error / ∂param
    const jacobian = calculateJacobian(params, freq, targetDb, boundsLow, boundsHigh, lowFreq, highFreq, fs, regularization);

    // Calculate JᵀJ (approx Hessian) and Jᵀe (gradient direction)
    const [JtJ, Jte] = calculateJtJandJte(jacobian, errors);

    // Check for gradient convergence
    let gradNormSq = 0;
    for (let i = 0; i < numParams; i++) gradNormSq += Jte[i] * Jte[i];
    const gradNorm = Math.sqrt(gradNormSq);
    if (gradNorm < gradEpsilon && iter > 0) break;

    // Negated Jᵀe (reused across attempts; solveEquation copies its input)
    for (let i = 0; i < numParams; i++) negJte[i] = -Jte[i];

    // Levenberg-Marquardt step: Solve (JᵀJ + λ · diag(|JᵀJ|+1e-6)) · Δ = −Jᵀe
     let deltaParams;
     let solved = false;
     let currentLambda = lambda;

     for (let attempt = 0; attempt < 5; attempt++) {
          // Build the damped matrix in-place into a fresh copy (avoids mutating JtJ)
          const augmentedJtJ = new Array(numParams);
          for (let r = 0; r < numParams; r++) {
              const src = JtJ[r];
              const row = new Array(numParams);
              for (let c = 0; c < numParams; c++) row[c] = src[c];
              const d = src[r];
              const absD = d < 0 ? -d : d;
              const dampDiag = absD > 1e-6 ? absD : 1e-6;
              row[r] += currentLambda * dampDiag;
              augmentedJtJ[r] = row;
          }

          try {
              deltaParams = solveEquation(augmentedJtJ, negJte);

              // Validate solution: check for NaN/Infinity and near-zero
              let allSmall = true;
              let anyBad = false;
              for (let i = 0; i < numParams; i++) {
                  const v = deltaParams[i];
                  if (!(v === v && v < 1e308 && v > -1e308)) { anyBad = true; break; }
                  const av = v < 0 ? -v : v;
                  if (av >= 1e-15) allSmall = false;
              }
              if (anyBad) throw new Error("Solution contains non-finite values");
              if (allSmall) {
                  if (gradNorm < gradEpsilon * 10) { solved = true; break; }
                  throw new Error("Solution is zero vector despite non-zero gradient");
              }
              solved = true;
              break;
          } catch (error) {
              currentLambda *= lambdaIncrease * 2;
              if (currentLambda > 1e10) { iter = maxIterations; break; }
          }
     }

     if (!solved) break;
     lambda = currentLambda;

    // Candidate new parameters with bounds + sign-dependent Q clamp fused into one pass
    let paramChangeNormSq = 0;
    for (let i = 0; i < numParams; i++) {
      const dp = deltaParams[i];
      paramChangeNormSq += dp * dp;
      let p = params[i] + dp;
      const lo = boundsLow[i], hi = boundsHigh[i];
      if (p < lo) p = lo; else if (p > hi) p = hi;
      newParams[i] = p;
    }
    // Sign-dependent Q cap (dips use the stricter 1/3-oct cap)
    for (let f = 0; f < numFilters; f++) {
      const gainIdx = f * 3;
      const logQIdx = gainIdx + 1;
      const logQUpper = newParams[gainIdx] > PEAK_DIP_HYSTERESIS_DB ? LOG_Q_MAX_PEAK : LOG_Q_MAX_DIP;
      if (newParams[logQIdx] > logQUpper) newParams[logQIdx] = logQUpper;
    }

    // Calculate cost with the new parameters
    const newErrors = errorFunctionLogSpace(newParams, freq, targetDb, lowFreq, highFreq, fs, regularization);
    let newCost = 0;
    for (let i = 0; i < newErrors.length; i++) newCost += newErrors[i] * newErrors[i];
    newCost /= newErrors.length;

    if (newCost < currentCost) {
      const costChange = currentCost - newCost;
      const paramChangeNorm = Math.sqrt(paramChangeNormSq);

      // Swap references so `newParams` (old `params`) becomes the next iteration's
      // scratch buffer — avoids reallocation each iteration.
      const tmp = params;
      params = newParams;
      newParams = tmp;
      errors = newErrors;
      currentCost = newCost;
      const decayed = lambda * lambdaDecrease;
      lambda = decayed > 1e-9 ? decayed : 1e-9;

      if (iter > 0 && (costChange < costEpsilon || paramChangeNorm < paramEpsilon)) break;
    } else {
      lambda *= lambdaIncrease;
      if (lambda > 1e10) break;
    }
    if (iter === maxIterations - 1) break;
  } // End of optimization loop

  // Convert back to linear-space parameters [g, Q, fc]
  const linearParams = [];
  for (let i = 0; i < numFilters; i++) {
    const baseIdx = i * 3;
    // Ensure parameters are finite before conversion
    const gain = isFinite(params[baseIdx]) ? params[baseIdx] : 0;
    const logQ = isFinite(params[baseIdx + 1]) ? params[baseIdx + 1] : Math.log10(1); // Default Q=1 if invalid
    const logFc = isFinite(params[baseIdx + 2]) ? params[baseIdx + 2] : Math.log10(1000); // Default Fc=1k if invalid

    linearParams.push(
      gain,
      10**logQ, // Q = 10^logQ
      10**logFc  // fc = 10^logFc
    );
  }
  return linearParams;
} 