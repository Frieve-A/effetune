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
  const combinedRespDb = new Array(nFreq).fill(0);
  const numFilters = Math.floor(logParams.length / 3);

  // Calculate the combined response of all PEQ filters
  for (let i = 0; i < numFilters; i++) {
    const baseIdx = i * 3;
    const gain = logParams[baseIdx];
    const Q = 10**logParams[baseIdx + 1]; // Convert logQ to Q
    const fc = 10**logParams[baseIdx + 2]; // Convert logFc to fc

    // Skip if parameters are invalid (e.g., during numerical differentiation)
    if (fc <= 0 || Q <= 0 || !isFinite(gain) || !isFinite(Q) || !isFinite(fc)) {
         console.warn(`Skipping filter ${i} due to invalid parameters: gain=${gain}, Q=${Q}, fc=${fc}`);
         continue;
    }

    const singleRespDb = peqResponse(freq, fc, gain, Q, fs);
    for (let k = 0; k < nFreq; k++) {
      combinedRespDb[k] += singleRespDb[k];
    }
  }

  // Calculate the error in the linear amplitude domain
  // Error aims to make target * response = 1 (0 dB flat)
  const errors = new Array(nFreq);
  const lo = lowFreq, hi = highFreq;

  for (let k = 0; k < nFreq; k++) {
      // Apply weighting: 0 outside the [lowFreq, highFreq] range
      const weight = (freq[k] < lo || freq[k] > hi) ? 0 : 1;

      const targetLin = 10**(targetDb[k] / 20);
      const respLin = 10**(combinedRespDb[k] / 20);

      // Error = Target_Linear * Response_Linear - 1.0 (deviation from flat 0dB)
      // Weighted error
      errors[k] = weight * (targetLin * respLin - 1.0);

       if (typeof errors[k] !== 'number' || !isFinite(errors[k])) {
           console.warn(`errorFunctionLogSpace: Invalid error calculated at freq ${freq[k]}, setting to 0.`);
           errors[k] = 0; // Set to 0 to avoid disrupting optimization
       }
  }

  // Add regularization errors if regularization is enabled
  if (regularization && (regularization.gainWeight > 0 || regularization.qWeight > 0)) {
    // Calculate regularization scale factor based on response errors
    // This helps balance regularization terms with frequency response errors
    const responseErrorMagnitude = Math.sqrt(
      errors.reduce((sum, err) => sum + err * err, 0) / errors.length
    );
    
    // Add gain regularization errors (for each filter)
    if (regularization.gainWeight > 0) {
      for (let i = 0; i < numFilters; i++) {
        const gain = logParams[i * 3];
        // Use absolute value of gain to penalize large gains in either direction
        const gainRegError = regularization.gainWeight * Math.abs(gain);
        errors.push(gainRegError);
      }
    }
    
    // Add Q regularization errors (for each filter)
    if (regularization.qWeight > 0) {
      for (let i = 0; i < numFilters; i++) {
        const gain = logParams[i * 3];
        const logQ = logParams[i * 3 + 1];
        const Q = 10**logQ; // Convert to actual Q
        // Sign-dependent cap: peaks allow up to Q_MAX_PEAK, dips up to Q_MAX_DIP.
        const qCap = qMaxForGain(gain);
        // Soft penalty above Q=1 (existing behavior, keeps filters wide by default)
        const qSoft = Math.max(0, Q - 1.0);
        // Hard barrier above the sign-dependent cap (strong disincentive to exceed it)
        const qBarrier = Q_CAP_BARRIER_WEIGHT * Math.max(0, Q - qCap);
        const qRegError = regularization.qWeight * (qSoft + qBarrier);
        errors.push(qRegError);
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
  const numFilters = Math.floor(params.length / 3);
  
  // Initialize Jacobian matrix with the correct size
  const jacobian = Array(numParams).fill(null).map(() => new Array(numErrorTerms).fill(0));

  // Optimal step size 'h' for numerical differentiation
  const eps = 2.22e-16; // Machine epsilon
  const baseStep = Math.sqrt(eps);

  for (let i = 0; i < numParams; i++) {
    const currentParam = params[i];
    // Calculate step size 'h', scaled by parameter magnitude
    let h = baseStep * Math.max(1.0, Math.abs(currentParam));
    // Ensure h is not excessively small compared to parameter
    h = Math.max(h, eps * 100);

    const paramsPlus = [...params];
    const paramsMinus = [...params];

    // Check bounds and decide differentiation method
    let errorsPlus, errorsMinus;
    const canStepUp = currentParam + h <= boundsHigh[i];
    const canStepDown = currentParam - h >= boundsLow[i];

    if (canStepUp && canStepDown) {
      // Central difference
      paramsPlus[i] = currentParam + h;
      paramsMinus[i] = currentParam - h;
      errorsPlus = errorFunctionLogSpace(paramsPlus, freq, targetDb, lowFreq, highFreq, fs, regularization);
      errorsMinus = errorFunctionLogSpace(paramsMinus, freq, targetDb, lowFreq, highFreq, fs, regularization);
      
      // Ensure we're using the full error vector (including regularization terms)
      for (let j = 0; j < numErrorTerms; j++) {
        const derivative = (errorsPlus[j] - errorsMinus[j]) / (2 * h);
        jacobian[i][j] = isFinite(derivative) ? derivative : 0;
      }
    } else if (canStepUp) {
      // Forward difference (at lower bound)
      // Try a smaller step first if central diff failed due to bound
      h = Math.min(h, (boundsHigh[i] - currentParam) * 0.5);
      if (h < eps * 100) { // If step becomes too small, assume zero derivative
        for(let j = 0; j < numErrorTerms; j++) {
          jacobian[i][j] = 0;
        }
      } else {
        paramsPlus[i] = currentParam + h;
        errorsPlus = errorFunctionLogSpace(paramsPlus, freq, targetDb, lowFreq, highFreq, fs, regularization);
        for (let j = 0; j < numErrorTerms; j++) {
          const derivative = (errorsPlus[j] - baseErrors[j]) / h;
          jacobian[i][j] = isFinite(derivative) ? derivative : 0;
        }
      }
    } else if (canStepDown) {
      // Backward difference (at upper bound)
      h = Math.min(h, (currentParam - boundsLow[i]) * 0.5);
      if (h < eps * 100) {
        for(let j = 0; j < numErrorTerms; j++) {
          jacobian[i][j] = 0;
        }
      } else {
        paramsMinus[i] = currentParam - h;
        errorsMinus = errorFunctionLogSpace(paramsMinus, freq, targetDb, lowFreq, highFreq, fs, regularization);
        for (let j = 0; j < numErrorTerms; j++) {
          const derivative = (baseErrors[j] - errorsMinus[j]) / h;
          jacobian[i][j] = isFinite(derivative) ? derivative : 0;
        }
      }
    } else {
      // Cannot step in either direction (parameter likely fixed at bound)
      for (let j = 0; j < numErrorTerms; j++) {
        jacobian[i][j] = 0;
      }
    }
    
    // Special handling for direct regularization derivatives where we know the analytical form
    // This avoids numerical differentiation imprecision for regularization terms
    if (regularization && (regularization.gainWeight > 0 || regularization.qWeight > 0)) {
      const freqLength = freq.length; // Number of frequency response error terms
      let regTermIdx = freqLength; // Index where regularization terms start in error vector
      
      // Calculate which parameter type this is (gain, Q, or fc)
      const paramType = i % 3; // 0=gain, 1=logQ, 2=logFc
      const filterIdx = Math.floor(i / 3); // Which filter this parameter belongs to
      
      // Handle gain regularization term (|gain|)
      if (regularization.gainWeight > 0) {
        // For each filter, add the gain regularization derivative
        for (let k = 0; k < numFilters; k++) {
          // Initialize derivative for the regularization of each filter
          jacobian[i][regTermIdx + k] = 0;
          
          if (paramType === 0 && k === filterIdx) { // Only affects the specific gain parameter
            const gain = params[k * 3]; 
            // d(gainWeight * |gain|)/d(gain) = gainWeight * sign(gain)
            const derivative = regularization.gainWeight * (gain >= 0 ? 1.0 : -1.0);
            jacobian[i][regTermIdx + k] = derivative;
          }
        }
        regTermIdx += numFilters; // Move to next block of regularization terms
      }
      
      // Handle Q regularization term: qWeight * ( max(0, Q-1) + barrier*max(0, Q-qCap) )
      // The cap qCap depends on the sign of the corresponding filter's gain, but as a
      // piecewise-constant function of gain its derivative w.r.t. gain is 0 almost
      // everywhere — so only the logQ derivative is non-zero.
      if (regularization.qWeight > 0) {
        for (let k = 0; k < numFilters; k++) {
          jacobian[i][regTermIdx + k] = 0;

          if (paramType === 1 && k === filterIdx) { // Only affects this specific Q parameter
            const gainK = params[k * 3];
            const logQ = params[k * 3 + 1];
            const Q = 10**logQ;
            const qCap = qMaxForGain(gainK);
            let factor = 0;
            if (Q > 1.0) factor += 1;
            if (Q > qCap) factor += Q_CAP_BARRIER_WEIGHT;
            if (factor > 0) {
              // d(Q)/d(logQ) = Q * ln(10)
              const derivative = regularization.qWeight * factor * Q * Math.log(10);
              jacobian[i][regTermIdx + k] = derivative;
            }
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
  const JtJ = Array(numParams).fill(null).map(() => Array(numParams).fill(0));
  const Jte = Array(numParams).fill(0);

  // Calculate JᵀJ = Jacobianᵀ * Jacobian
  for (let i = 0; i < numParams; i++) {
    for (let j = i; j < numParams; j++) { // Calculate only upper triangle + diagonal
      let sum = 0;
      for (let k = 0; k < numErrorTerms; k++) {
        // Ensure values are finite before multiplication
        const val_i = isFinite(jacobian[i][k]) ? jacobian[i][k] : 0;
        const val_j = isFinite(jacobian[j][k]) ? jacobian[j][k] : 0;
        sum += val_i * val_j;
      }
      JtJ[i][j] = isFinite(sum) ? sum : 0;
      if (i !== j) {
        JtJ[j][i] = JtJ[i][j]; // Symmetric matrix
      }
    }
  }

  // Calculate Jᵀe = Jacobianᵀ * errors
  for (let i = 0; i < numParams; i++) {
    let sum = 0;
    for (let k = 0; k < numErrorTerms; k++) {
      const val_jac = isFinite(jacobian[i][k]) ? jacobian[i][k] : 0;
      const val_err = isFinite(errors[k]) ? errors[k] : 0;
      sum += val_jac * val_err;
    }
    Jte[i] = isFinite(sum) ? sum : 0;
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
  // Create copies to avoid modifying original arrays passed to fitPEQ
  const a = A.map(row => [...row]);
  const x = [...b]; // Will store results here temporarily

  // Forward Elimination with Partial Pivoting
  for (let i = 0; i < n; i++) {
    // Find pivot row (row with largest absolute value in column i, at or below row i)
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(a[k][i]) > Math.abs(a[maxRow][i])) {
        maxRow = k;
      }
    }

     // Swap rows i and maxRow in matrix A and vector x (representing b)
     [a[i], a[maxRow]] = [a[maxRow], a[i]];
     [x[i], x[maxRow]] = [x[maxRow], x[i]];

     // Check for singularity or near-singularity
     const pivot = a[i][i];
     if (Math.abs(pivot) < 1e-12) {
         // If pivot is near zero, the matrix is likely singular or ill-conditioned.
          // Check if other elements in the column below are also near zero
          let nonZeroBelow = false;
          for(let k=i+1; k<n; ++k) {
              if(Math.abs(a[k][i]) >= 1e-12) {
                  nonZeroBelow = true;
                  break;
              }
          }
          if (!nonZeroBelow) {
              // All elements below (and the pivot) are near zero.
              // Treat column as linearly dependent. This step might fail if not handled.
               console.warn(`solveEquation: Matrix appears singular at column ${i}. Pivot ~0.`);
               // Option 1: Throw error (safer, forces LM to increase lambda)
               throw new Error(`Matrix is singular or near-singular at column ${i}. Pivot: ${pivot}`);
               // Option 2: Return zero vector (can sometimes allow LM to proceed)
               // return new Array(n).fill(0);
          }
          // If there's a non-zero element below, pivoting should have swapped it.
          // Getting here might indicate a numerical issue.
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
      if (Math.abs(diagElement) < 1e-12) {
           // If diagonal element is zero during back substitution, matrix is singular
           console.error(`solveEquation: Zero or near-zero diagonal element ${diagElement} at row ${i} during back substitution.`);
           throw new Error(`Zero diagonal element during back substitution at row ${i}. Matrix is singular.`);
      }

      let sum = 0;
      for (let j = i + 1; j < n; j++) {
          sum += a[i][j] * solution[j];
      }
      solution[i] = (x[i] - sum) / diagElement;

      // Check for NaN/Infinity in solution (shouldn't happen if pivots are checked)
       if (!isFinite(solution[i])) {
           console.error(`solveEquation: Non-finite value (${solution[i]}) computed for solution element ${i}.`);
           throw new Error(`Non-finite solution element ${i} computed.`);
       }
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
  let params = [];
  const logQMin = Math.log10(0.5); // Q lower bound
  // Upper bound uses the looser (peak) cap; per-iteration sign-dependent clamping
  // tightens it to the dip cap when the band's gain is non-positive.
  const logQMax = LOG_Q_MAX_PEAK;
  const logFcMin = Math.log10(lowFreq * 0.9); // Fc lower bound (slightly below lowFreq)
  const logFcMax = Math.log10(highFreq * 1.1); // Fc upper bound (slightly above highFreq)
  const gainMin = -18;
  const gainMax = 18;

  for (let i = 0; i < numFilters; i++) {
      const baseIdx = i * 3;
      const gain = Math.max(gainMin, Math.min(gainMax, initParams[baseIdx]));
      const qCap = qMaxForGain(gain);
      const Q = Math.max(0.5, Math.min(qCap, initParams[baseIdx + 1]));
      const fc = Math.max(lowFreq * 0.9, Math.min(highFreq * 1.1, initParams[baseIdx + 2]));

      params.push(
          gain,
          Math.max(logQMin, Math.min(logQMaxForGain(gain), Math.log10(Q))), // Clamp logQ
          Math.max(logFcMin, Math.min(logFcMax, Math.log10(fc))) // Clamp logFc
      );
  }

  // Parameter bounds for optimization
  const boundsLow = [];
  const boundsHigh = [];
  for (let i = 0; i < numFilters; i++) {
    boundsLow.push(gainMin, logQMin, logFcMin);
    boundsHigh.push(gainMax, logQMax, logFcMax);
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
  let currentCost = errors.reduce((sum, err) => sum + err * err, 0) / errors.length; // Mean squared error
  let lastCost = currentCost;

  // Optimization loop
  for (let iter = 0; iter < maxIterations; iter++) {
    lastCost = currentCost;
    const oldParams = [...params];

    // Calculate Jacobian matrix J = ∂error / ∂param
    const jacobian = calculateJacobian(params, freq, targetDb, boundsLow, boundsHigh, lowFreq, highFreq, fs, regularization);

    // Calculate JᵀJ (approx Hessian) and Jᵀe (gradient direction)
    const [JtJ, Jte] = calculateJtJandJte(jacobian, errors);

    // Check for gradient convergence
    const gradNorm = Math.sqrt(Jte.reduce((sum, val) => sum + val * val, 0));
     if (gradNorm < gradEpsilon && iter > 0) { // Avoid stopping at iter 0 if gradient is already small
         break;
     }

    // Levenberg-Marquardt step: Solve (JᵀJ + λ * diag(JᵀJ)) * deltaParams = -Jᵀe
     let deltaParams;
     let solved = false;
     let currentLambda = lambda;

     // Try solving the system, increasing lambda if it fails (matrix is singular)
     for(let attempt = 0; attempt < 5; attempt++) {
          const augmentedJtJ = JtJ.map((row, i) => {
              const newRow = [...row];
              // Add damping factor: use max(diag(JtJ), 1e-6) to prevent issues with zero diagonal
              const diagElement = Math.max(Math.abs(JtJ[i][i]), 1e-6);
              newRow[i] += currentLambda * diagElement;
              return newRow;
          });

          const negJte = Jte.map(val => -val);
          try {
              deltaParams = solveEquation(augmentedJtJ, negJte);
              // Check if the solution is valid (not all zeros, not NaN/Infinity)
               if (deltaParams.some(val => !isFinite(val))) {
                   throw new Error("Solution contains non-finite values");
               }
               if (deltaParams.every(val => Math.abs(val) < 1e-15)) {
                  // If delta is essentially zero, it might indicate convergence or a problem
                  // Check if gradient norm is also very small
                  if (gradNorm < gradEpsilon * 10) {
                      solved = true; // Treat as solved/converged
                      break;
                  } else {
                      // Gradient still large, but delta is zero - matrix likely singular
                       throw new Error("Solution is zero vector despite non-zero gradient");
                  }
               }
              solved = true;
              break; // Success
          } catch (error) {
              currentLambda *= lambdaIncrease * 2; // Increase lambda more aggressively if solve fails
               if (currentLambda > 1e10) {
                   iter = maxIterations; // Force exit
                   break;
               }
          }
     }

     if (!solved) {
          break;
     }

     // Update lambda based on the final lambda used for solving
     lambda = currentLambda;

    // Calculate candidate new parameters
    let newParams = params.map((p, i) => p + deltaParams[i]);

    // Apply bounds constraints
    newParams = newParams.map((p, i) => Math.max(boundsLow[i], Math.min(boundsHigh[i], p)));

    // Sign-dependent Q cap: dips (gain <= hysteresis threshold) use the stricter
    // dip cap (1/3 oct). Peaks above the hysteresis band keep the peak cap (1/6 oct).
    for (let f = 0; f < numFilters; f++) {
      const gainIdx = f * 3;
      const logQIdx = f * 3 + 1;
      const logQUpper = logQMaxForGain(newParams[gainIdx]);
      if (newParams[logQIdx] > logQUpper) {
        newParams[logQIdx] = logQUpper;
      }
    }

    // Calculate cost with the new parameters
    const newErrors = errorFunctionLogSpace(newParams, freq, targetDb, lowFreq, highFreq, fs, regularization);
    const newCost = newErrors.reduce((sum, err) => sum + err * err, 0) / newErrors.length;

    // Check if the cost improved
    if (newCost < currentCost) {
      const costChange = currentCost - newCost;
      const paramChangeNorm = Math.sqrt(deltaParams.reduce((sum, dp, i) => sum + dp*dp, 0));

      params = newParams;
      errors = newErrors;
      currentCost = newCost;
      lambda = Math.max(1e-9, lambda * lambdaDecrease); // Decrease lambda

      if (iter > 0 && (costChange < costEpsilon || paramChangeNorm < paramEpsilon)) {
           break;
       }

    } else {
      // Cost did not decrease. Increase lambda and keep old parameters.
      lambda *= lambdaIncrease;
       if (lambda > 1e10) {
         break;
       }
    }
     if (iter === maxIterations - 1) {
         break;
     }
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