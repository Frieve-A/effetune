class BrickwallLimiterPlugin extends PluginBase {
    constructor() {
        super('Brickwall Limiter', 'Prevents audio from exceeding 0 dBFS');

        // Plugin parameters
        this.th = 0;       // Threshold in dB (-24 to 0 dB)
        this.rl = 100;     // Release Time in ms (10 to 500 ms)
        this.la = 3;       // Lookahead Time in ms (0 to 10 ms)
        this.os = 1;       // Oversampling Factor (1, 2, 4, or 8)
        this.ig = 0;       // Input Gain in dB (-18 to 18 dB), default 0 dB
        this.sm = -1.000;  // Margin in dB (-1.000 to 0.000 dB, default -1.000 dB)

        this._hasMessageHandler = false;
        this.lastProcessTime = performance.now() / 1000;

        this._setupMessageHandler();

        // Register the audio processing function with Audio Worklet.
        // Processing chain:
        //  1. Apply input gain sample-by-sample.
        //  2. If oversampling > 1, perform upsampling via polyphase interpolation.
        //  3. Write the unprocessed input into a delay buffer for lookahead and process each sample.
        //  4. For each delayed sample, compute the target gain so that (sample * gain) <= effective threshold.
        //     The effective threshold is computed as: parameters.th + Margin.
        //     If the sample exceeds the effective threshold, the gain is dropped immediately;
        //     otherwise, it recovers gradually (using the release coefficient).
        //  5. Apply the computed gain to the delayed sample.
        //  6. If oversampling > 1, perform downsampling via polyphase decimation.
        this.registerProcessor(`
            // Optimization: Pre-calculate frequently used math constants
            const LN10_OVER_20 = Math.LN10 / 20.0;
            const PI = Math.PI;

            if (!parameters.enabled) {
                return data; // Early exit if disabled
            }
            const numChannels = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate;
            // Optimization: Cache parameter access
            const osFactor = parameters.os;
            const inputGainDb = parameters.ig !== undefined ? parameters.ig : 0;
            const releaseTimeMs = parameters.rl !== undefined ? parameters.rl : 100; // Assuming default 100ms if undefined based on original context
            const thresholdDb = parameters.th;
            const marginDb = parameters.sm !== undefined ? parameters.sm : -1.00;
            const lookaheadTimeMs = parameters.la !== undefined ? parameters.la : 0; // Assuming default 0ms if undefined
            const currentTime = parameters.time !== undefined ? parameters.time : 0;

            // --- Global state reinitialization ---
            // Reset state if sampleRate or oversampling factor changes or channel count changes
            if (context.sampleRate !== sampleRate || context.lastOsFactor !== osFactor || context.numChannels !== numChannels) {
                context.sampleRate = sampleRate;
                context.lastOsFactor = osFactor;
                context.numChannels = numChannels; // Store channel count for future comparisons
                context.initialized = false;

                // Clear state variables explicitly using undefined for clarity and potential predictability
                context.delaySamples = undefined;
                context.lookaheadTimeMs = undefined;
                context.delayLength = undefined;
                context.delayWritePos = undefined;
                context.delayBuffers = undefined;
                context.gainStates = undefined;
                context.filterCoeffs = undefined; // Prototype filter
                context.filterLength = undefined;
                context.polyphase = undefined; // Polyphase filters
                context.osFactorCached = undefined;
                context.upsampleState = undefined;
                context.downsampleState = undefined;
                context.delayBufferOS = undefined; // Oversampled domain delay
                context.delayWritePosOS = undefined;
                context.inputBuffer = undefined; // Reusable input buffer
                context.outputBuffer = undefined; // Reusable output buffer (non-OS path)
                context.oversampled = undefined; // Reusable buffer for upsampled signal
                context.processedOversampled = undefined; // Reusable buffer for gain-processed OS signal
                context.downsampledOutput = undefined; // Reusable final output buffer (OS path)
                context.X = undefined; // Intermediate buffer for upsampling
                context.Z = undefined; // Intermediate buffer for downsampling
                context.thresholdDivLookup = undefined; // Gain lookup table
                context.lastThresholdLin = undefined; // Threshold used for LUT generation
                context.thresholdLookupScale = undefined;
                context.phaseIndices = undefined; // Precalculated indices for downsampling
                context.phaseRemainders = undefined; // Precalculated phases for downsampling
                context.prevTime = undefined; // Reset time tracking
            }

            // --- Input Gain Application ---
            // Optimization: Use pre-calculated constant for dB to linear conversion
            const inputGainLinear = Math.exp(inputGainDb * LN10_OVER_20); // Equivalent to Math.pow(10, inputGainDb / 20)

            // Reuse or create input buffer
            const dataLength = data.length; // Cache length
            if (!context.inputBuffer || context.inputBuffer.length !== dataLength) {
                context.inputBuffer = new Float32Array(dataLength);
            }
            const inputBuffer = context.inputBuffer; // Use local variable

            // Apply input gain with loop unrolling (original optimization maintained)
            const dataLengthMod4 = dataLength - (dataLength % 4); // More explicit way than bitwise trick
            let i = 0;
            // Unrolled loop for multiples of 4
            for (; i < dataLengthMod4; i += 4) {
                inputBuffer[i]   = data[i]   * inputGainLinear;
                inputBuffer[i+1] = data[i+1] * inputGainLinear;
                inputBuffer[i+2] = data[i+2] * inputGainLinear;
                inputBuffer[i+3] = data[i+3] * inputGainLinear;
            }
            // Process remaining samples
            for (; i < dataLength; i++) {
                inputBuffer[i] = data[i] * inputGainLinear;
            }

            // --- Time Delta Calculation (informational, kept as is) ---
            const prevTime = context.prevTime !== undefined ? context.prevTime : currentTime; // Initialize prevTime if undefined
            const deltaTime = Math.max(0.001, currentTime - prevTime); // Not directly used in core processing but kept
            context.prevTime = currentTime;

            // --- Gain Smoothing Parameters ---
            // Ensure release time is at least 10ms, convert ms to s
            const releaseTimeSec = Math.max(10, releaseTimeMs) * 0.001;
            // Optimization: Calculate inverse sampleRate once
            const invSampleRate = 1.0 / sampleRate;
            const releaseCoeffSample = Math.exp(-invSampleRate / releaseTimeSec);
            // Optimization: Pre-calculate 1 - release coefficient
            const oneMinusReleaseCoeffSample = 1.0 - releaseCoeffSample;

            // --- Threshold Calculation ---
            const effectiveThresholdDb = thresholdDb + marginDb;
            // Optimization: Use pre-calculated constant and cache linear threshold
            const effectiveThresholdLin = Math.exp(effectiveThresholdDb * LN10_OVER_20);

            // --- Threshold Division Lookup Table (LUT) ---
            // Rebuild LUT only if it doesn't exist or the threshold changed
            // Optimization: Hoist constants and use multiplication by inverse where possible
            const LOOKUP_SIZE = 1024;
            const MAX_ABS_VALUE_LUT = 10.0; // Max expected value for LUT range
            if (!context.thresholdDivLookup || context.lastThresholdLin !== effectiveThresholdLin) {
                const INV_LOOKUP_SIZE = 1.0 / LOOKUP_SIZE; // Use multiplication
                const SCALE_FACTOR = LOOKUP_SIZE / MAX_ABS_VALUE_LUT;

                if (!context.thresholdDivLookup) {
                    context.thresholdDivLookup = new Float32Array(LOOKUP_SIZE);
                }
                const lookupTable = context.thresholdDivLookup; // Local ref for loop

                for (let lut_i = 0; lut_i < LOOKUP_SIZE; lut_i++) {
                    const absSample = (lut_i * INV_LOOKUP_SIZE) * MAX_ABS_VALUE_LUT;
                    if (absSample <= 1e-6) {
                        lookupTable[lut_i] = 1.0; // Avoid division by zero/small numbers
                    } else if (absSample > effectiveThresholdLin) {
                        // Optimization: Calculate inverse outside the condition? No, threshold varies.
                        lookupTable[lut_i] = effectiveThresholdLin / absSample;
                    } else {
                        lookupTable[lut_i] = 1.0; // Below threshold, gain is 1
                    }
                }
                context.lastThresholdLin = effectiveThresholdLin; // Store threshold used for LUT
                context.thresholdLookupScale = SCALE_FACTOR; // Store scale factor
            }
            // Cache LUT reference and scale locally for the function closure
            const thresholdDivLookup_cache = context.thresholdDivLookup;
            const thresholdLookupScale_cache = context.thresholdLookupScale;

            // Fast lookup function for threshold division (Optimized version from original, slightly adjusted)
            // Defined once outside loops, captures necessary context variables
            function fastThresholdDiv(absSample) {
                if (absSample <= 1e-6) return 1.0;
                if (absSample > effectiveThresholdLin) { // Use the cached linear threshold
                    // Check if value is outside the optimized LUT range
                    if (absSample > MAX_ABS_VALUE_LUT) {
                        // Calculate directly for large values beyond LUT
                        return effectiveThresholdLin / absSample;
                    }
                    // Use lookup table for values within range
                    // Optimization: Use bitwise OR for floor on positive numbers. Clamp index.
                    const idx = Math.min(
                        LOOKUP_SIZE - 1, // Clamp to max index
                        (absSample * thresholdLookupScale_cache) | 0 // Fast floor equivalent for positive numbers
                    );
                    return thresholdDivLookup_cache[idx]; // Use cached LUT reference
                }
                // Below threshold, return gain 1.0
                return 1.0;
            }

            // ==============================================================
            // === PROCESSING BRANCH 1: NO OVERSAMPLING (osFactor === 1) ===
            // ==============================================================
            if (osFactor === 1) {
                const delaySamplesRaw = Math.ceil(lookaheadTimeMs * sampleRate * 0.001);
                const delaySamples = delaySamplesRaw > 0 ? delaySamplesRaw : 1;
                const requiredDelayLength = delaySamples;

                // --- Initialize State (if first run or parameters changed) ---
                if (!context.initialized ||
                    context.delaySamples !== delaySamples ||
                    context.delayLength !== requiredDelayLength ||
                    context.lookaheadTimeMs !== lookaheadTimeMs) {
                    context.delaySamples = delaySamples;
                    context.lookaheadTimeMs = lookaheadTimeMs;
                    context.delayLength = requiredDelayLength;

                    context.delayWritePos = 0; // Start writing at the beginning
                    context.delayBuffers = [];
                    for (let ch = 0; ch < numChannels; ch++) {
                        // Allocate delay buffer per channel, initialized to zero
                        context.delayBuffers[ch] = new Float32Array(context.delayLength).fill(0.0);
                    }
                    // Initialize gain state per channel to 1.0 (no gain reduction)
                    context.gainStates = new Float32Array(numChannels).fill(1.0);
                    context.initialized = true; // Mark as initialized
                }

                // --- Output Buffer Management ---
                // Reuse or create output buffer
                if (!context.outputBuffer || context.outputBuffer.length !== dataLength) {
                    context.outputBuffer = new Float32Array(dataLength);
                }
                const output = context.outputBuffer; // Local ref

                // --- Per-Channel Processing ---
                // Optimization: Cache context variables locally before channel loop
                const delayLength = context.delayLength;
                const gainStates = context.gainStates;
                const delayBuffers = context.delayBuffers;
                let delayWritePos = context.delayWritePos; // Get current write position

                for (let ch = 0; ch < numChannels; ch++) {
                    const chOffset = ch * blockSize; // Offset for interleaved input/output
                    let currentGain = gainStates[ch]; // Current gain for this channel (read from context)
                    const delayBuffer = delayBuffers[ch]; // Delay buffer for this channel

                    // Process samples with loop unrolling (original optimization maintained)
                    const blockSizeMod4 = blockSize - (blockSize % 4);
                    let k = 0; // Sample index within the block ('i' used for outer loops)

                    // Unrolled loop for multiples of 4
                    for (; k < blockSizeMod4; k += 4) {
                        // --- Sample 1 ---
                        let readWritePos1 = (delayWritePos + k) % delayLength; // Use local delayWritePos
                        let delayedSample1 = delayBuffer[readWritePos1];
                        delayBuffer[readWritePos1] = inputBuffer[chOffset + k];
                        let absSample1 = delayedSample1 >= 0 ? delayedSample1 : -delayedSample1;
                        let targetGain1 = fastThresholdDiv(absSample1);
                        let gain1 = (targetGain1 < currentGain)
                                   ? targetGain1
                                   : (releaseCoeffSample * currentGain + oneMinusReleaseCoeffSample * targetGain1);
                        output[chOffset + k] = delayedSample1 * gain1;

                        // --- Sample 2 ---
                        let readWritePos2 = (delayWritePos + k + 1) % delayLength;
                        let delayedSample2 = delayBuffer[readWritePos2];
                        delayBuffer[readWritePos2] = inputBuffer[chOffset + k + 1];
                        let absSample2 = delayedSample2 >= 0 ? delayedSample2 : -delayedSample2;
                        let targetGain2 = fastThresholdDiv(absSample2);
                        currentGain = gain1; // Update currentGain *before* calculating next gain
                        let gain2 = (targetGain2 < currentGain)
                                   ? targetGain2
                                   : (releaseCoeffSample * currentGain + oneMinusReleaseCoeffSample * targetGain2);
                        output[chOffset + k + 1] = delayedSample2 * gain2;

                        // --- Sample 3 ---
                        let readWritePos3 = (delayWritePos + k + 2) % delayLength;
                        let delayedSample3 = delayBuffer[readWritePos3];
                        delayBuffer[readWritePos3] = inputBuffer[chOffset + k + 2];
                        let absSample3 = delayedSample3 >= 0 ? delayedSample3 : -delayedSample3;
                        let targetGain3 = fastThresholdDiv(absSample3);
                        currentGain = gain2;
                        let gain3 = (targetGain3 < currentGain)
                                   ? targetGain3
                                   : (releaseCoeffSample * currentGain + oneMinusReleaseCoeffSample * targetGain3);
                        output[chOffset + k + 2] = delayedSample3 * gain3;

                        // --- Sample 4 ---
                        let readWritePos4 = (delayWritePos + k + 3) % delayLength;
                        let delayedSample4 = delayBuffer[readWritePos4];
                        delayBuffer[readWritePos4] = inputBuffer[chOffset + k + 3];
                        let absSample4 = delayedSample4 >= 0 ? delayedSample4 : -delayedSample4;
                        let targetGain4 = fastThresholdDiv(absSample4);
                        currentGain = gain3;
                        let gain4 = (targetGain4 < currentGain)
                                   ? targetGain4
                                   : (releaseCoeffSample * currentGain + oneMinusReleaseCoeffSample * targetGain4);
                        output[chOffset + k + 3] = delayedSample4 * gain4;

                        // Update gain state for the next iteration (or remainder loop)
                        currentGain = gain4;
                    }

                    // Process remaining samples (if blockSize is not a multiple of 4)
                    for (; k < blockSize; k++) {
                        const readWritePos = (delayWritePos + k) % delayLength;
                        const delayedSample = delayBuffer[readWritePos];
                        delayBuffer[readWritePos] = inputBuffer[chOffset + k];
                        const absSample = delayedSample >= 0 ? delayedSample : -delayedSample;
                        const targetGain = fastThresholdDiv(absSample);
                        const newGain = (targetGain < currentGain)
                                       ? targetGain
                                       : (releaseCoeffSample * currentGain + oneMinusReleaseCoeffSample * targetGain);
                        currentGain = newGain; // Update gain state for next sample
                        output[chOffset + k] = delayedSample * newGain; // Apply gain
                    }

                    // Store the final gain state for this channel back into the context
                    gainStates[ch] = currentGain;
                }

                // Update the global delay buffer write position for the next block
                context.delayWritePos = (delayWritePos + blockSize) % delayLength;

                // Attach measurements
                // Find minimum gain manually
                let minGain = 1.0; // Initialize with maximum possible gain
                for (let i = 0; i < gainStates.length; i++) {
                    if (gainStates[i] < minGain) {
                        minGain = gainStates[i];
                    }
                }
                output.measurements = { time: currentTime, gainReduction: 1.0 - minGain };

                return output; // Return the processed output buffer
            }


            // =============================================================
            // === PROCESSING BRANCH 2: OVERSAMPLING (osFactor > 1)      ===
            // =============================================================
            // Optimization: Cache L locally
            const L = osFactor;

            // --- Polyphase Filter Coefficient Calculation (Optimized) ---
            // Recompute only if osFactor changed since last computation
            if (!context.filterCoeffs || context.osFactorCached !== L) {
                context.upsampleState = undefined; // Reset dependent states
                context.downsampleState = undefined;

                const N = 63; // Filter order (must be odd for Type 1 Linear Phase FIR)
                const halfN = (N - 1) * 0.5; // Center index (float)
                const beta = 5.0; // Kaiser window beta parameter

                // --- Optimized Kaiser window I0 function (Bessel function of the first kind, order 0) ---
                // This is a direct implementation based on standard approximations, potentially more stable/predictable than the lookup version
                // We need I0(beta) and I0(arg) within the kaiser function. Calculate I0(beta) once.
                function calculateI0(x) {
                    const ax = x >= 0 ? x : -x;
                    let y, ans;
                    if (ax < 3.75) {
                        y = x / 3.75;
                        y = y * y;
                        ans = 1.0 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.0360768 + y * 0.0045813)))));
                    } else {
                        y = 3.75 / ax;
                        ans = (Math.exp(ax) / Math.sqrt(ax)) * (0.39894228 + y * (0.01328592 + y * (0.00225319 + y * (-0.00157565 + y * (0.00916281 + y * (-0.02057706 + y * (0.02635537 + y * (-0.01647633 + y * 0.00392377))))))));
                    }
                    return ans;
                }
                const I0_beta = calculateI0(beta);
                // Optimization: Calculate inverse denominator once
                const inv_I0_beta = 1.0 / I0_beta;

                // --- Optimized Sinc function (using cached PI) ---
                 function sinc(x) {
                    if ((x >= 0 ? x : -x) < 1e-6) return 1.0; // Handle singularity
                    const pix = PI * x;
                    return Math.sin(pix) / pix;
                }

                // --- Kaiser window function using precalculated I0(beta) ---
                 function kaiser(n, N, beta) {
                     const center = (N - 1) * 0.5;
                     const arg_scaled = 2.0 * (n - center) / (N - 1); // Argument scaled to [-1, 1]
                     const arg_sqrt = beta * Math.sqrt(1.0 - arg_scaled * arg_scaled);
                     // Ensure arg_sqrt is real for I0 calculation, though arg_scaled^2 should be <= 1
                     if (1.0 - arg_scaled * arg_scaled < 0) return 0.0; // Outside window support
                     return calculateI0(arg_sqrt) * inv_I0_beta; // Use precalculated inverse
                 }


                // Calculate prototype filter coefficients (h)
                const h = new Float32Array(N);
                let sumH = 0;
                // Optimization: Calculate inverse L once
                const invL = 1.0 / L;
                for (let n = 0; n < N; n++) {
                    // Design low-pass filter using Sinc * Kaiser Window
                    const sincArg = (n - halfN) * invL;
                    const hn = sinc(sincArg) * kaiser(n, N, beta);
                    h[n] = hn; // Store coefficient before scaling
                    sumH += hn; // Accumulate sum for normalization
                }

                // Normalize filter coefficients for desired gain (L for upsampling/downsampling)
                // Optimization: Calculate normalization factor once
                const normFactor = L / sumH;
                for (let n = 0; n < N; n++) {
                    h[n] *= normFactor;
                }

                // --- Polyphase Decomposition ---
                const polyphase = new Array(L); // Array to hold L phase filters
                let maxPhaseLength = 0; // Find max length for state allocation later
                for (let p = 0; p < L; p++) {
                    // Calculate the number of coefficients for this phase filter
                    const phaseLength = Math.ceil((N - p) / L);
                    if (phaseLength > maxPhaseLength) maxPhaseLength = phaseLength; // Track max length
                    const phaseCoeffs = new Float32Array(phaseLength);
                    // Extract coefficients from prototype h for this phase
                    for (let k = 0; k < phaseLength; k++) {
                        const protoIndex = p + L * k;
                        // No bounds check needed here if phaseLength is calculated correctly
                        phaseCoeffs[k] = h[protoIndex];
                    }
                    polyphase[p] = phaseCoeffs; // Store the phase filter
                }

                // Store results in context
                context.filterCoeffs = h; // Store prototype filter (optional, might not be needed)
                context.filterLength = N;
                context.polyphase = polyphase;
                context.osFactorCached = L;
                context.maxPhaseLength = maxPhaseLength; // Store max length
            }
            // --- End of Filter Calculation ---

            // Optimization: Cache filter related variables locally from context
            const N_filt = context.filterLength; // Rename to avoid conflict with loop var N
            const polyphase_cache = context.polyphase;
            const P_len_max = context.maxPhaseLength; // Max length of any polyphase filter branch


            // --- Upsampling Stage (Polyphase Interpolation) ---
            // State length required for the filter state
            const upsampleStateLength = P_len_max - 1;

            // Initialize upsample state buffers if needed
            if (!context.upsampleState) {
                context.upsampleState = [];
                for (let ch = 0; ch < numChannels; ch++) {
                    context.upsampleState[ch] = new Float32Array(upsampleStateLength).fill(0.0);
                }
            }

            // Calculate output size for the oversampled signal
            const oversampledBlockSize = blockSize * L;
            const oversampledTotalLength = numChannels * oversampledBlockSize;

            // Reuse or create oversampled buffer
            if (!context.oversampled || context.oversampled.length !== oversampledTotalLength) {
                context.oversampled = new Float32Array(oversampledTotalLength);
            }
            const oversampled = context.oversampled; // Local ref

            // Reuse or create intermediate buffer X (State + Input)
            const combinedUpsampleLength = upsampleStateLength + blockSize;
            if (!context.X || context.X.length < combinedUpsampleLength) {
                context.X = new Float32Array(combinedUpsampleLength);
            }
            const X_upsample = context.X; // Local ref, renamed to avoid confusion

            // Process each channel for upsampling
            for (let ch = 0; ch < numChannels; ch++) {
                const inOffset = ch * blockSize; // Input buffer offset
                const state = context.upsampleState[ch]; // Get state

                // Prepare intermediate buffer X: [ previous_state | current_input ]
                X_upsample.set(state, 0); // Copy state
                // Optimization: Use subarray view to copy input (may or may not be faster depending on JS engine)
                X_upsample.set(inputBuffer.subarray(inOffset, inOffset + blockSize), upsampleStateLength);

                const outOffset = ch * oversampledBlockSize; // Output buffer offset

                // Iterate through each INPUT sample index in X that contributes to the output
                const firstInputTapIndex = upsampleStateLength; // = P_len_max - 1
                const lastInputTapIndex = combinedUpsampleLength;

                for (let i_x = firstInputTapIndex; i_x < lastInputTapIndex; i_x++) {
                    const inputBlockSampleIndex = i_x - firstInputTapIndex; // Index relative to start of input block (0 to blockSize-1)
                    const baseOutIdx = outOffset + inputBlockSampleIndex * L; // Base index in oversampled buffer for this input sample

                    // Compute L output samples for each input sample using different polyphase filters
                    for (let p = 0; p < L; p++) {
                        const h_poly = polyphase_cache[p]; // Get the p-th phase filter coefficients
                        const h_len = h_poly.length; // Length of this specific phase filter

                        let acc = 0.0; // Accumulator for the convolution sum

                        // Perform convolution: sum( h_poly[k] * X[i_x - k] )
                        // Optimization: Unroll convolution loop (original factor 8)
                        const h_len_mod_8 = h_len - (h_len % 8);
                        let k = 0;
                        for (; k < h_len_mod_8; k += 8) {
                           // Indices into X_upsample are i_x - k, i_x - (k+1), ...
                           acc += h_poly[k]   * X_upsample[i_x - k];
                           acc += h_poly[k+1] * X_upsample[i_x - (k+1)];
                           acc += h_poly[k+2] * X_upsample[i_x - (k+2)];
                           acc += h_poly[k+3] * X_upsample[i_x - (k+3)];
                           acc += h_poly[k+4] * X_upsample[i_x - (k+4)];
                           acc += h_poly[k+5] * X_upsample[i_x - (k+5)];
                           acc += h_poly[k+6] * X_upsample[i_x - (k+6)];
                           acc += h_poly[k+7] * X_upsample[i_x - (k+7)];
                        }
                        // Handle remaining taps
                        for (; k < h_len; k++) {
                            acc += h_poly[k] * X_upsample[i_x - k];
                        }
                        // Store the computed oversampled value
                        oversampled[baseOutIdx + p] = acc;
                    }
                }
                // Update the state for the next block: copy the last 'upsampleStateLength' samples from X_upsample
                // Optimization: Use subarray view
                state.set(X_upsample.subarray(combinedUpsampleLength - upsampleStateLength, combinedUpsampleLength));
            }


            // --- Gain Processing in Oversampled Domain ---

            // Initialize gain state if it wasn't initialized (e.g., first time in OS branch)
            if (!context.gainStates) {
                context.gainStates = new Float32Array(numChannels).fill(1.0);
            }

            // Lookahead Delay Calculation in Oversampled Domain
            const rawDelaySamplesOrigRate = Math.ceil(lookaheadTimeMs * sampleRate * 0.001);
            // Original logic: ensure minimum delay corresponding to 1 sample at original rate, then scale by L
            const delaySamplesOS = (rawDelaySamplesOrigRate <= 0 ? 1 : rawDelaySamplesOrigRate) * L;

            // Initialize Oversampled Delay Buffers if needed
            // Check if buffer exists per channel and if its length matches required delay
            if (!context.delayBufferOS || !context.delayBufferOS[0] || context.delayBufferOS[0].length !== delaySamplesOS) {
                context.delayBufferOS = [];
                context.delayWritePosOS = []; // Write position per channel
                for (let ch = 0; ch < numChannels; ch++) {
                    context.delayBufferOS[ch] = new Float32Array(delaySamplesOS).fill(0.0);
                    context.delayWritePosOS[ch] = 0;
                }
            }

            // Calculate Release Coefficient for Oversampled Rate
            const sampleRateOS = sampleRate * L;
            const invSampleRateOS = 1.0 / sampleRateOS;
            const releaseCoeffSampleOS = Math.exp(-invSampleRateOS / releaseTimeSec);
            // Optimization: Pre-calculate 1 - release coefficient
            const oneMinusReleaseCoeffSampleOS = 1.0 - releaseCoeffSampleOS;

            // Reuse or create buffer for processed (gain applied) oversampled signal
            if (!context.processedOversampled || context.processedOversampled.length !== oversampledTotalLength) {
                context.processedOversampled = new Float32Array(oversampledTotalLength);
            }
            const processedOversampled = context.processedOversampled; // Local ref

            // Cache gain states locally before channel loop
            const gainStatesOS = context.gainStates; // Use a different name just for clarity

            // Process each channel with lookahead delay and gain application in OS domain
            for (let ch = 0; ch < numChannels; ch++) {
                const delayBufferOS = context.delayBufferOS[ch]; // OS delay buffer
                let writePosOS = context.delayWritePosOS[ch]; // Current write position (read from context)
                let currentGain = gainStatesOS[ch]; // Current gain (read from context)
                const osBufferOffset = ch * oversampledBlockSize; // Offset in oversampled/processed buffers

                // Process OS samples with loop unrolling (original factor 8)
                const oversampledBlockSizeMod8 = oversampledBlockSize - (oversampledBlockSize % 8);
                let k_os = 0; // Index within the OS block

                // Unrolled loop
                for (; k_os < oversampledBlockSizeMod8; k_os += 8) {
                    // Process 8 samples per iteration
                    for (let j = 0; j < 8; j++) {
                        const sampleIndex = k_os + j;
                        const circBufferPos = (writePosOS + sampleIndex) % delaySamplesOS; // Circular buffer index
                        const delayedSample = delayBufferOS[circBufferPos]; // Read delayed sample
                        delayBufferOS[circBufferPos] = oversampled[osBufferOffset + sampleIndex]; // Write current OS sample

                        const absSample = delayedSample >= 0 ? delayedSample : -delayedSample; // Use delayed sample for gain calc
                        const targetGain = fastThresholdDiv(absSample); // Calculate target gain

                        // Apply gain smoothing (attack/release) using OS coefficients
                        const newGain = (targetGain < currentGain)
                                       ? targetGain // Instant attack
                                       : (releaseCoeffSampleOS * currentGain + oneMinusReleaseCoeffSampleOS * targetGain);
                        currentGain = newGain; // Update gain state for next sample within the inner loop

                        // Apply gain to the delayed sample
                        processedOversampled[osBufferOffset + sampleIndex] = delayedSample * currentGain;
                    }
                 }

                // Process remaining OS samples
                for (; k_os < oversampledBlockSize; k_os++) {
                    const circBufferPos = (writePosOS + k_os) % delaySamplesOS;
                    const delayedSample = delayBufferOS[circBufferPos];
                    delayBufferOS[circBufferPos] = oversampled[osBufferOffset + k_os];
                    const absSample = delayedSample >= 0 ? delayedSample : -delayedSample;
                    const targetGain = fastThresholdDiv(absSample);
                    const newGain = (targetGain < currentGain)
                                   ? targetGain
                                   : (releaseCoeffSampleOS * currentGain + oneMinusReleaseCoeffSampleOS * targetGain);
                    currentGain = newGain;
                    processedOversampled[osBufferOffset + k_os] = delayedSample * currentGain;
                }

                // Store final gain state and updated write position back into context
                gainStatesOS[ch] = currentGain;
                context.delayWritePosOS[ch] = (writePosOS + oversampledBlockSize) % delaySamplesOS;
            }


            // --- Downsampling Stage (Polyphase Decimation) ---
            // Calculate necessary state length for downsampling filter state
            // M = filter length per phase (approximately N/L)
            // State length needed is L*(M-1) based on polyphase structure.
            // Original code used: M = ceil(N / L); d = L * (M - 1); stateLength = d;
            const M_down = Math.ceil(N_filt / L); // Use cached filter length N_filt
            const downsampleStateLength = L * (M_down - 1);

            // Initialize downsample state buffers if needed
            if (!context.downsampleState) {
                context.downsampleState = [];
                for (let ch = 0; ch < numChannels; ch++) {
                    context.downsampleState[ch] = new Float32Array(downsampleStateLength).fill(0.0);
                }
            }

            // Reuse or create final downsampled output buffer (original sample rate)
            const finalOutputTotalLength = numChannels * blockSize;
            if (!context.downsampledOutput || context.downsampledOutput.length !== finalOutputTotalLength) {
                context.downsampledOutput = new Float32Array(finalOutputTotalLength);
            }
            const downsampledOutput = context.downsampledOutput; // Local ref

            // --- Pre-calculate Indices for Downsampling --- (Original Optimization Maintained)
            // Avoids repeated calculations inside the sample loop
            if (!context.phaseIndices || context.phaseIndices.length !== blockSize) {
                context.phaseIndices = new Uint32Array(blockSize); // Index into the combined Z buffer
                context.phaseRemainders = new Uint32Array(blockSize); // Which polyphase filter to use (0 to L-1)
                const d_state = downsampleStateLength; // Use calculated state length

                for (let out_idx = 0; out_idx < blockSize; out_idx++) {
                    // n_index: Input sample index (in Z) corresponding to the i-th output sample
                    // This index depends on the filter delay (d_state) and the output sample index (out_idx * L)
                    const n_index = out_idx * L + d_state;
                    context.phaseIndices[out_idx] = n_index;
                    // r: Polyphase filter index for the i-th output sample, determined by the input index modulo L
                    context.phaseRemainders[out_idx] = n_index % L;
                }
            }
            // Cache pre-calculated indices locally
            const phaseIndices_cache = context.phaseIndices;
            const phaseRemainders_cache = context.phaseRemainders;


            // Reuse or create intermediate buffer Z (State + Processed Oversampled Input)
            const combinedDownsampleLength = downsampleStateLength + oversampledBlockSize;
            if (!context.Z || context.Z.length < combinedDownsampleLength) {
                context.Z = new Float32Array(combinedDownsampleLength);
            }
            const Z_downsample = context.Z; // Local ref, renamed


            // Process each channel for downsampling
            for (let ch = 0; ch < numChannels; ch++) {
                const osBufferOffset = ch * oversampledBlockSize; // Offset in processedOversampled buffer
                const state = context.downsampleState[ch]; // Get state

                // Prepare intermediate buffer Z: [ previous_state | current_processed_oversampled ]
                Z_downsample.set(state, 0); // Copy state
                // Optimization: Use subarray view to copy processed oversampled input
                Z_downsample.set(processedOversampled.subarray(osBufferOffset, osBufferOffset + oversampledBlockSize), downsampleStateLength);

                const outOffset = ch * blockSize; // Final output buffer offset

                // Iterate through each OUTPUT sample index (0 to blockSize-1)
                for (let i_out = 0; i_out < blockSize; i_out++) {
                    // Get pre-calculated index into Z and polyphase filter index
                    const n_index_z = phaseIndices_cache[i_out]; // Input index in Z for this output sample
                    const r_phase = phaseRemainders_cache[i_out]; // Polyphase filter index

                    const h_poly = polyphase_cache[r_phase]; // Get the r-th phase filter coefficients
                    const h_len = h_poly.length; // Length of this specific phase filter

                    let acc = 0.0; // Accumulator for the convolution sum

                    // Perform convolution for decimation: y[i_out] = sum( h_poly[k] * Z[ n_index_z - k*L ] )
                    // Optimization: Unroll convolution loop (original factor 8)
                    const h_len_mod_8 = h_len - (h_len % 8);
                    let k = 0;
                    for (; k < h_len_mod_8; k += 8) {
                        // Calculate all 8 indices into Z first
                        const idx1 = n_index_z - L * k;
                        const idx2 = n_index_z - L * (k+1);
                        const idx3 = n_index_z - L * (k+2);
                        const idx4 = n_index_z - L * (k+3);
                        const idx5 = n_index_z - L * (k+4);
                        const idx6 = n_index_z - L * (k+5);
                        const idx7 = n_index_z - L * (k+6);
                        const idx8 = n_index_z - L * (k+7);

                        // Optimization: Check the last index first. If it's invalid (< 0), break unrolled loop.
                        if (idx8 < 0) { break; }

                        // Indices seem valid, perform accumulation
                        acc += h_poly[k]   * Z_downsample[idx1];
                        acc += h_poly[k+1] * Z_downsample[idx2];
                        acc += h_poly[k+2] * Z_downsample[idx3];
                        acc += h_poly[k+3] * Z_downsample[idx4];
                        acc += h_poly[k+4] * Z_downsample[idx5];
                        acc += h_poly[k+5] * Z_downsample[idx6];
                        acc += h_poly[k+6] * Z_downsample[idx7];
                        acc += h_poly[k+7] * Z_downsample[idx8];
                    }

                    // Handle remaining taps (or taps skipped by the early break in unrolled loop)
                    for (; k < h_len; k++) {
                        const idx = n_index_z - L * k;
                        // Check index validity for each remaining tap
                        if (idx < 0) { break; } // Stop processing taps once index is out of bounds
                        acc += h_poly[k] * Z_downsample[idx];
                    }

                    // Store the computed downsampled value
                    downsampledOutput[outOffset + i_out] = acc;
                }

                // Update the state for the next block: copy the last 'downsampleStateLength' samples from Z_downsample
                // Optimization: Use subarray view
                state.set(Z_downsample.subarray(combinedDownsampleLength - downsampleStateLength, combinedDownsampleLength));
            }

            // Attach measurements (using the final gain states from the OS processing)
            // Find minimum gain manually
            let minGainOS = 1.0; // Initialize with maximum possible gain
            for (let i = 0; i < gainStatesOS.length; i++) {
                if (gainStatesOS[i] < minGainOS) {
                    minGainOS = gainStatesOS[i];
                }
            }
            downsampledOutput.measurements = {
                time: currentTime,
                gainReduction: 1.0 - minGainOS
            };

            // Mark as initialized now that OS processing path is complete (or if already initialized)
            context.initialized = true;

            return downsampledOutput; // Return the final processed, downsampled output buffer
        `);
    }
    
    _setupMessageHandler() {
        // No additional message handling required.
    }
    
    _validateParameters(params) {
        super._validateParameters(params);
        const validateRange = (value, min, max, name) => {
            if (typeof value !== "number" || isNaN(value) || value < min || value > max) {
                throw new Error(name + " must be between " + min + " and " + max);
            }
        };
        if (params.th !== undefined) { validateRange(params.th, -24, 0, "Threshold"); }
        if (params.rl !== undefined) { validateRange(params.rl, 10, 500, "Release Time"); }
        if (params.la !== undefined) { validateRange(params.la, 0, 10, "Lookahead Time"); }
        if (params.os !== undefined) {
            if (![1, 2, 4, 8].includes(params.os)) {
                throw new Error("Oversampling Factor must be 1, 2, 4, or 8");
            }
        }
        if (params.ig !== undefined) { validateRange(params.ig, -18, 18, "Input Gain"); }
        if (params.sm !== undefined) { validateRange(params.sm, -3.00, 0.00, "Margin"); }
    }
    
    _setValidatedParameters(params) {
        if (params.th !== undefined) this.th = params.th;
        if (params.rl !== undefined) this.rl = params.rl;
        if (params.la !== undefined) this.la = params.la;
        if (params.os !== undefined) this.os = params.os;
        if (params.ig !== undefined) this.ig = params.ig;
        if (params.sm !== undefined) this.sm = params.sm;
        this.updateParameters();
    }
    
    getParameters() {
        const baseParams = super.getParameters();
        return {
            ...baseParams,
            pluginType: this.constructor.name,
            enabled: this.enabled,
            th: this.th,
            rl: this.rl,
            la: this.la,
            os: this.os,
            ig: this.ig,
            sm: this.sm
        };
    }
    
    setTh(value) { this.setParameters({ th: value }); }
    setRl(value) { this.setParameters({ rl: value }); }
    setLa(value) { this.setParameters({ la: value }); }
    setOs(value) { this.setParameters({ os: value }); }
    setIg(value) { this.setParameters({ ig: value }); }
    setSm(value) { this.setParameters({ sm: value }); }
    
    createUI() {
        const container = document.createElement('div');
        container.className = 'brickwall-limiter-plugin-ui plugin-parameter-ui';

        // Input Gain
        container.appendChild(this.createParameterControl(
            'Input Gain', -18, 18, 0.1, this.ig,
            (value) => this.setIg(value), 'dB'
        ));

        // Threshold
        container.appendChild(this.createParameterControl(
            'Threshold', -24, 0, 0.1, this.th,
            (value) => this.setTh(value), 'dB'
        ));
        
        // Margin
        container.appendChild(this.createParameterControl(
            'Margin', -1.0, 0.0, 0.01, this.sm,
            (value) => this.setSm(value), 'dB'
        ));

        // Release Time
        container.appendChild(this.createParameterControl(
            'Release', 10, 500, 1, this.rl,
            (value) => this.setRl(value), 'ms'
        ));

        // Lookahead Time
        container.appendChild(this.createParameterControl(
            'Lookahead', 0, 10, 0.1, this.la,
            (value) => this.setLa(value), 'ms'
        ));
        
        // Oversampling (Keep existing control for now)
        const osRow = document.createElement('div');
        osRow.className = 'parameter-row';
        const osLabel = document.createElement('label');
        osLabel.textContent = 'Oversampling:';
        osLabel.htmlFor = `${this.id}-${this.name}-os-select`;
        const osSelect = document.createElement('select');
        osSelect.id = `${this.id}-${this.name}-os-select`;
        osSelect.name = `${this.id}-${this.name}-os-select`;
        [1, 2, 4, 8].forEach(factor => {
            const option = document.createElement('option');
            option.value = factor;
            option.textContent = factor + 'x';
            option.selected = this.os === factor;
            osSelect.appendChild(option);
        });
        osSelect.addEventListener('change', (e) => {
            this.setOs(parseInt(e.target.value, 10));
        });
        osRow.appendChild(osLabel);
        osRow.appendChild(osSelect);
        container.appendChild(osRow);

        return container;
    }
}
  
window.BrickwallLimiterPlugin = BrickwallLimiterPlugin;
