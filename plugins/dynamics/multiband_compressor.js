class MultibandCompressorPlugin extends PluginBase {
  constructor() {
    super('Multiband Compressor', '5-band compressor with crossover filters');

    // Crossover frequencies
    this.f1 = 100;  // Low
    this.f2 = 500;  // Low-mid
    this.f3 = 2000; // Mid
    this.f4 = 8000; // High

    // Band parameters (5 bands with optimized initial values for FM radio mastering)
    this.bands = [
      { t: -20, r: 4, a: 30, rl: 150, k: 6, g: -1, gr: 0 },
      { t: -22, r: 3, a: 20, rl: 120, k: 4, g: 0,  gr: 0 },
      { t: -25, r: 2.5, a: 15, rl: 80,  k: 4, g: 1,  gr: 0 },
      { t: -28, r: 2, a: 10, rl: 60,  k: 3, g: 1.5, gr: 0 },
      { t: -18, r: 5, a: 5,  rl: 40,  k: 2, g: -2, gr: 0 }
    ];

    this.selectedBand = 0;
    this.lastProcessTime = performance.now() / 1000;
    this.animationFrameId = null;

    // Register the processor code (returned as a string)
    this.registerProcessor(this.getProcessorCode());
  }

  // Returns the processor code string with optimized block processing
  /**
   * Returns the optimized processor code string for the Multiband Compressor.
   * This code aims for performance improvements while maintaining functionally identical
   * output to the original code (excluding potential floating-point variations).
   *
   * Optimization Strategies Used:
   * - Hoisting frequently used constants and parameters.
   * - Using const/let appropriately.
   * - Ensuring efficient TypedArray usage (pooling, .set, .fill).
   * - Leveraging existing micro-optimizations (loop unrolling).
   * - Maintaining state caching mechanisms.
   * - Preserving the use of lookup tables as implemented in the original.
   * - Minor code structure improvements for readability where possible without functional change.
   */
  getProcessorCode() {
    // NOTE: This function returns a string of code to be executed elsewhere,
    // likely in an AudioWorkletGlobalScope. `parameters`, `data`, and `context`
    // are assumed to be available in that execution scope.
    return `
      // --- Constants ---
      const SQRT2 = Math.SQRT2;
      const LOG2 = Math.log(2);
      const LOG10_20 = 8.685889638065035; // 20 / Math.log(10)
      const GAIN_FACTOR = 0.11512925464970229; // Math.log(10) / 20
      const MIN_ENV_VAL = 1e-6; // Minimum envelope value to prevent log(0)
      const DC_OFFSET = 1e-25; // Small offset for filter state initialization

      // --- Initial Setup ---
      const blockSize = parameters.blockSize;
      const sampleRate = parameters.sampleRate;
      const channelCount = parameters.channelCount;
      const result = data; // Use input buffer directly

      // Bypass if disabled
      if (!parameters.enabled) {
        // Measurements might still be expected even when bypassed
        result.measurements = {
          time: parameters.time,
          gainReductions: context.gainReductions ? context.gainReductions.slice(0, 5) : new Float32Array(5)
        };
        return result;
      }

      // --- State Initialization and Management ---
      const frequencies = [parameters.f1, parameters.f2, parameters.f3, parameters.f4];

      // Check if filter states or config need reset
      const needsReset = !context.filterStates ||
                        !context.filterConfig ||
                        context.filterConfig.sampleRate !== sampleRate ||
                        context.filterConfig.channelCount !== channelCount ||
                        !context.filterConfig.frequencies ||
                        context.filterConfig.frequencies.some((f, i) => f !== frequencies[i]);

      if (needsReset) {
        // Create filter state with DC-blocking initialization
        const createFilterState = () => {
          const state = {
            stage1: {
              x1: new Float32Array(channelCount), x2: new Float32Array(channelCount),
              y1: new Float32Array(channelCount), y2: new Float32Array(channelCount)
            },
            stage2: {
              x1: new Float32Array(channelCount), x2: new Float32Array(channelCount),
              y1: new Float32Array(channelCount), y2: new Float32Array(channelCount)
            }
          };
          // Initialize with small opposing DC offsets to prevent instability/denormals
          for (let ch = 0; ch < channelCount; ch++) {
            state.stage1.x1[ch] = DC_OFFSET;  state.stage1.x2[ch] = -DC_OFFSET;
            state.stage1.y1[ch] = DC_OFFSET;  state.stage1.y2[ch] = -DC_OFFSET;
            state.stage2.x1[ch] = DC_OFFSET;  state.stage2.x2[ch] = -DC_OFFSET;
            state.stage2.y1[ch] = DC_OFFSET;  state.stage2.y2[ch] = -DC_OFFSET;
          }
          return state;
        };

        context.filterStates = {
          lowpass: Array(4).fill(0).map(createFilterState),
          highpass: Array(4).fill(0).map(createFilterState)
        };

        context.filterConfig = {
          sampleRate: sampleRate,
          frequencies: frequencies.slice(), // Store a copy
          channelCount: channelCount
        };

        // Apply a short fade-in to prevent clicks when filter states are reset
        context.fadeIn = {
          counter: 0,
          // Fade length: 5ms or block size, whichever is smaller
          length: Math.min(blockSize, Math.ceil(sampleRate * 0.005))
        };
        // Ensure envelope states are initialized
        if (!context.envelopeStates || context.envelopeStates.length !== channelCount * 5) {
            context.envelopeStates = new Float32Array(channelCount * 5).fill(MIN_ENV_VAL);
        }
      }

      // --- Filter Coefficient Calculation & Caching ---
      // Cache filter coefficients if frequencies have changed since last calculation
      if (!context.cachedFilters || context.cachedFilters.configFrequencies !== context.filterConfig.frequencies) {
        function computeButterworthQs(N) {
          const Qs = [];
          const pairs = Math.floor(N / 2);
          for (let k = 1; k <= pairs; ++k) {
            const theta = (2 * k - 1) * Math.PI / (2 * N);
            const zeta = Math.sin(theta);
            const Q = 1 / (2 * zeta);
            Qs.push(Q);
          }
          return Qs;
        }

        function designFirstOrderButterworth(fs, fc, type) {
          if (fc <= 0 || fc >= fs * 0.5) return null;
          const K = 2 * fs;
          const warped = 2 * fs * Math.tan(Math.PI * fc / fs);
          const Om = warped;
          const a0 = K + Om;
          const a1 = Om - K;
          let b0, b1;
          if (type === "lp") {
            b0 = Om;
            b1 = Om;
          } else {
            b0 = -K;
            b1 = K;
          }
          return { b0: b0 / a0, b1: b1 / a0, b2: 0, a1: a1 / a0, a2: 0 };
        }

        function designSecondOrderButterworth(fs, fc, Q, type) {
          if (fc <= 0 || fc >= fs * 0.5) return null;
          const K = 2 * fs;
          const warped = 2 * fs * Math.tan(Math.PI * fc / fs);
          const Om = warped;
          const K2 = K * K;
          const Om2 = Om * Om;
          const K2Q = K2 * Q;
          const Om2Q = Om2 * Q;
          const a0 = K2Q + K * Om + Om2Q;
          const a1 = -2 * K2Q + 2 * Om2Q;
          const a2 = K2Q - K * Om + Om2Q;
          let b0, b1, b2;
          if (type === "lp") {
            b0 = Om2Q;
            b1 = 2 * Om2Q;
            b2 = Om2Q;
          } else {
            b0 = K2Q;
            b1 = -2 * K2Q;
            b2 = K2Q;
          }
          return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
        }

        function designButterworthSections(fs, fc, N, type) {
          if (!Number.isFinite(N) || N <= 0) return [];
          const sections = [];
          const isOdd = (N % 2) !== 0;
          if (isOdd) {
            const sec1 = designFirstOrderButterworth(fs, fc, type);
            if (sec1) sections.push(sec1);
          }
          const Qs = computeButterworthQs(N);
          for (const Q of Qs) {
            const sec2 = designSecondOrderButterworth(fs, fc, Q, type);
            if (sec2) sections.push(sec2);
          }
          return sections;
        }

        function designLinkwitzRileySections(fs, fc, slope, type) {
          if (slope === 0 || fc <= 0) return [];
          const absSlope = Math.abs(slope);
          if (absSlope % 12 !== 0) return [];
          const N = absSlope / 12;
          if (type !== "lp" && type !== "hp") return [];
          const butter = designButterworthSections(fs, fc, N, type);
          if (!butter.length) return [];
          const lr = butter.slice();
          for (let i = 0; i < butter.length; ++i) {
            const s = butter[i];
            lr.push({ b0: s.b0, b1: s.b1, b2: s.b2, a1: s.a1, a2: s.a2 });
          }
          return lr;
        }

        context.cachedFilters = new Array(4);
        const sampleRateLocal = sampleRate;
        const identityCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

        for (let i = 0; i < 4; i++) {
          const freq = Math.max(10.0, Math.min(frequencies[i], sampleRateLocal * 0.499));
          const lpSections = designLinkwitzRileySections(sampleRateLocal, freq, 24, "lp");
          const hpSections = designLinkwitzRileySections(sampleRateLocal, freq, 24, "hp");

          context.cachedFilters[i] = {
            lowpassStage1: lpSections[0] || identityCoeffs,
            lowpassStage2: lpSections[1] || identityCoeffs,
            highpassStage1: hpSections[0] || identityCoeffs,
            highpassStage2: hpSections[1] || identityCoeffs
          };
        }
        context.cachedFilters.configFrequencies = context.filterConfig.frequencies;
      }
      const cachedFilters = context.cachedFilters; // Local ref for faster access

      // --- Buffer Management ---
      // Setup band signal buffers using a pooled TypedArray if needed
      if (!context.bandSignals || context.bandSignals.length !== channelCount || context.bandSignals[0][0].length !== blockSize) {
        const totalArrays = channelCount * 5; // 5 bands per channel
        const arrayPool = new Float32Array(totalArrays * blockSize);
        context.bandSignals = Array.from({ length: channelCount }, (_, ch) =>
          Array.from({ length: 5 }, (_, band) => {
            const offset = (ch * 5 + band) * blockSize;
            return arrayPool.subarray(offset, offset + blockSize);
          })
        );
        context.arrayPool = arrayPool; // Keep pool alive
      }

      // Ensure temporary buffers exist and have the correct size
      if (!context.tempBuffers || context.tempBuffers[0].length !== blockSize) {
          context.tempBuffers = [
            new Float32Array(blockSize), // Input buffer per channel
            new Float32Array(blockSize), // Intermediate HP buffer 1
            new Float32Array(blockSize)  // Intermediate HP buffer 2
          ];
        }
      const tempBuffers = context.tempBuffers; // Local ref

      // Ensure output summing buffer exists and has the correct size
      if (!context.outputBuffer || context.outputBuffer.length !== blockSize) {
        context.outputBuffer = new Float32Array(blockSize);
      }
      const outputBuffer = context.outputBuffer; // Local ref

      // Ensure shared work buffer exists for envelope calculations
      if (!context.workBuffer || context.workBuffer.length !== blockSize) {
          context.workBuffer = new Float32Array(blockSize);
      }
      const workBuffer = context.workBuffer; // Local ref

      // Ensure gain reduction metering array exists
      if (!context.gainReductions || context.gainReductions.length !== 5) {
        context.gainReductions = new Float32Array(5);
      }
      const gainReductions = context.gainReductions; // Local ref

      // --- Helper Function: Apply Biquad Filter Block (Linkwitz-Riley = 2 stages) ---
      // Highly optimized version from the original code
      function applyFilterBlock(input, output, coeffsStage1, coeffsStage2, state, ch, blockLen) {
        const { b0: b0_1, b1: b1_1, b2: b2_1, a1: a1_1, a2: a2_1 } = coeffsStage1;
        const { b0: b0_2, b1: b1_2, b2: b2_2, a1: a1_2, a2: a2_2 } = coeffsStage2;
        const s1 = state.stage1, s2 = state.stage2;

        // Cache state variables locally for performance
        let s1_x1 = s1.x1[ch], s1_x2 = s1.x2[ch], s1_y1 = s1.y1[ch], s1_y2 = s1.y2[ch];
        let s2_x1 = s2.x1[ch], s2_x2 = s2.x2[ch], s2_y1 = s2.y1[ch], s2_y2 = s2.y2[ch];

        // Process the block, attempt 4x unrolling
        const blockLenMod4 = blockLen & ~3; // blockLen - (blockLen % 4)
        let i = 0;

        // Loop unrolled by 4
        for (; i < blockLenMod4; i += 4) {
          // Sample 0
          let sample = input[i];
          let stage1_out = b0_1 * sample + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
          s1_x2 = s1_x1; s1_x1 = sample; s1_y2 = s1_y1; s1_y1 = stage1_out;
          let stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
          s2_x2 = s2_x1; s2_x1 = stage1_out; s2_y2 = s2_y1; s2_y1 = stage2_out;
          output[i] = stage2_out;

          // Sample 1
          sample = input[i+1];
          stage1_out = b0_1 * sample + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
          s1_x2 = s1_x1; s1_x1 = sample; s1_y2 = s1_y1; s1_y1 = stage1_out;
          stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
          s2_x2 = s2_x1; s2_x1 = stage1_out; s2_y2 = s2_y1; s2_y1 = stage2_out;
          output[i+1] = stage2_out;

          // Sample 2
          sample = input[i+2];
          stage1_out = b0_1 * sample + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
          s1_x2 = s1_x1; s1_x1 = sample; s1_y2 = s1_y1; s1_y1 = stage1_out;
          stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
          s2_x2 = s2_x1; s2_x1 = stage1_out; s2_y2 = s2_y1; s2_y1 = stage2_out;
          output[i+2] = stage2_out;

          // Sample 3
          sample = input[i+3];
          stage1_out = b0_1 * sample + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
          s1_x2 = s1_x1; s1_x1 = sample; s1_y2 = s1_y1; s1_y1 = stage1_out;
          stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
          s2_x2 = s2_x1; s2_x1 = stage1_out; s2_y2 = s2_y1; s2_y1 = stage2_out;
          output[i+3] = stage2_out;
        }

        // Handle remaining samples (if blockLen wasn't multiple of 4)
        for (; i < blockLen; i++) {
          const sample = input[i];
          // Stage 1
          const stage1_out = b0_1 * sample + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
          s1_x2 = s1_x1; s1_x1 = sample; s1_y2 = s1_y1; s1_y1 = stage1_out;
          // Stage 2
          const stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
          s2_x2 = s2_x1; s2_x1 = stage1_out; s2_y2 = s2_y1; s2_y1 = stage2_out;
          output[i] = stage2_out;
        }

        // Store updated state back
        s1.x1[ch] = s1_x1; s1.x2[ch] = s1_x2; s1.y1[ch] = s1_y1; s1.y2[ch] = s1_y2;
        s2.x1[ch] = s2_x1; s2.x2[ch] = s2_x2; s2.y1[ch] = s2_y1; s2.y2[ch] = s2_y2;
      }

      // --- Filtering Stage (Channel by Channel) ---
      const filterStates = context.filterStates; // Local ref
      for (let ch = 0; ch < channelCount; ch++) {
        const offset = ch * blockSize;
        const bandSignalsCh = context.bandSignals[ch]; // Buffers for this channel's bands

        // Get temporary buffers for this channel's processing
        const inputBuffer = tempBuffers[0]; // Use temp buffer 0 for channel input
        const hp1Buffer   = tempBuffers[1]; // Use temp buffer 1 for intermediate HP
        const hp2Buffer   = tempBuffers[2]; // Use temp buffer 2 for intermediate HP

        // 1. Copy channel data from input 'data' to 'inputBuffer'
        // This avoids modifying the original 'data' and fits the filter function signature.
        // Direct subarray view is not possible if 'data' is interleaved. This implementation
        // assumes channel data is block-sequential as in: offset = ch * blockSize; data[offset + i]
        for (let i = 0; i < blockSize; i++) {
            inputBuffer[i] = data[offset + i];
        }
        // If data was potentially interleaved, a copy like above is necessary.
        // If data is guaranteed non-interleaved Float32Array per channel, could use subarray:
        // const inputBuffer = data.subarray(offset, offset + blockSize); // But this wasn't in original, stick to copy.


        // 2. Apply filters sequentially using the temporary buffers
        // Band 0 (Low): Lowpass filter applied to the input signal
        applyFilterBlock(inputBuffer, bandSignalsCh[0], cachedFilters[0].lowpassStage1, cachedFilters[0].lowpassStage2, filterStates.lowpass[0], ch, blockSize);

        // Calculate the high-pass complement for the remaining bands
        applyFilterBlock(inputBuffer, hp1Buffer, cachedFilters[0].highpassStage1, cachedFilters[0].highpassStage2, filterStates.highpass[0], ch, blockSize);

        // Band 1 (Low-Mid): Lowpass filter applied to the first high-pass result
        applyFilterBlock(hp1Buffer, bandSignalsCh[1], cachedFilters[1].lowpassStage1, cachedFilters[1].lowpassStage2, filterStates.lowpass[1], ch, blockSize);

        // Calculate the high-pass complement for the next bands
        applyFilterBlock(hp1Buffer, hp2Buffer, cachedFilters[1].highpassStage1, cachedFilters[1].highpassStage2, filterStates.highpass[1], ch, blockSize);

        // Band 2 (Mid): Lowpass filter applied to the second high-pass result
        applyFilterBlock(hp2Buffer, bandSignalsCh[2], cachedFilters[2].lowpassStage1, cachedFilters[2].lowpassStage2, filterStates.lowpass[2], ch, blockSize);

        // Calculate the high-pass complement (reuse hp1Buffer as it's no longer needed)
        applyFilterBlock(hp2Buffer, hp1Buffer, cachedFilters[2].highpassStage1, cachedFilters[2].highpassStage2, filterStates.highpass[2], ch, blockSize);

        // Band 3 (High-Mid): Lowpass filter applied to the third high-pass result
        applyFilterBlock(hp1Buffer, bandSignalsCh[3], cachedFilters[3].lowpassStage1, cachedFilters[3].lowpassStage2, filterStates.lowpass[3], ch, blockSize);

        // Band 4 (High): Highpass filter applied to the third high-pass result
        // This is the highest band, so it's the final high-pass residual.
        applyFilterBlock(hp1Buffer, bandSignalsCh[4], cachedFilters[3].highpassStage1, cachedFilters[3].highpassStage2, filterStates.highpass[3], ch, blockSize);
      }

      // --- Compressor Parameter Preparation ---
      const sampleRateMs = sampleRate / 1000;

      // Precompute time constants if needed or if relevant parameters changed
      let timeConstantsNeedUpdate = !context.timeConstants || context.timeConstants.length !== 10; // 5 bands * 2 coeffs (atk, rel)
      if (!timeConstantsNeedUpdate && context.lastBandParams) {
        for (let b = 0; b < 5; b++) {
          const bandParams = parameters.bands[b];
          const lastParams = context.lastBandParams[b];
          // Only check parameters affecting time constants (attack 'a', release 'rl')
          if (bandParams.a !== lastParams.a || bandParams.rl !== lastParams.rl) {
            timeConstantsNeedUpdate = true;
            break;
          }
        }
      } else if (!context.lastBandParams) {
          timeConstantsNeedUpdate = true; // Need initial calculation
      }

      if (timeConstantsNeedUpdate) {
        if (!context.timeConstants) context.timeConstants = new Float32Array(10);
        if (!context.lastBandParams) context.lastBandParams = new Array(5); // Initialize if first time

        const timeConstants = context.timeConstants; // Local ref
        for (let b = 0; b < 5; b++) {
          const bandParams = parameters.bands[b];
          // Calculate attack and release coefficients using exponential decay formula
          // Ensure time > 0 by using Math.max(1, ...) for ms values
          timeConstants[b * 2]     = Math.exp(-LOG2 / Math.max(1, bandParams.a  * sampleRateMs)); // Attack coeff
          timeConstants[b * 2 + 1] = Math.exp(-LOG2 / Math.max(1, bandParams.rl * sampleRateMs)); // Release coeff

          // Store parameters used for this calculation to check for changes next time
          // Create/update entry for this band in lastBandParams
          context.lastBandParams[b] = { ...context.lastBandParams[b], a: bandParams.a, rl: bandParams.rl };
        }
      }
      const timeConstants = context.timeConstants; // Local ref for access

      // Precompute derived band parameters (threshold, knee, ratio, makeup) if needed
      if (!context.bandParams) context.bandParams = new Array(5);

      let bandParamsNeedUpdate = false;
      if (!context.lastBandParams) { // If lastBandParams wasn't even created, bandParams definitely need update
          bandParamsNeedUpdate = true;
      } else {
          for (let b = 0; b < 5; b++) {
              const bp = parameters.bands[b];
              const last = context.lastBandParams[b];
              // Check parameters affecting gain curve (threshold 't', ratio 'r', knee 'k', makeup gain 'g')
              if (!last || bp.t !== last.t || bp.r !== last.r || bp.k !== last.k || bp.g !== last.g) {
                  bandParamsNeedUpdate = true;
                  break;
              }
          }
      }

      if (bandParamsNeedUpdate) {
          for (let band = 0; band < 5; band++) {
              const bp = parameters.bands[band];
              const ratio = Math.max(0.5, Math.min(20, bp.r)); // Ensure ratio is within valid range (0.5 to 20)
              const knee = Math.max(0, bp.k); // Ensure knee >= 0

              // For ratio < 1 (upward expansion): slope = 1 - 1/ratio is negative, so gain increases below threshold
              // For ratio >= 1 (compression): slope = 1 - 1/ratio is positive, so gain decreases above threshold
              const slope = (ratio === 1.0) ? 0.0 : (1.0 - 1.0 / ratio);

              context.bandParams[band] = {
                  thresholdDb: bp.t,
                  kneeDb: knee,
                  ratio: ratio,
                  makeupDb: bp.g,
                  // Precompute values used in gain calculation
                  halfKneeDb: knee * 0.5,
                  slope: slope, // slope for gain change: positive for compression, negative for expansion
                  makeupLinear: Math.exp(bp.g * GAIN_FACTOR) // Linear makeup gain
              };
              // Update lastBandParams with these values as well
              context.lastBandParams[band] = { ...context.lastBandParams[band], t: bp.t, r: bp.r, k: bp.k, g: bp.g };
          }
      }
      const bandParamsCache = context.bandParams; // Local ref

      // --- Lookup Table Setup (as in original) ---
      if (!context.dbLookup) {
          const DB_LOOKUP_SIZE = 4096;
          const DB_LOOKUP_SCALE = DB_LOOKUP_SIZE / 10; // Maps input [0, 10] -> index [0, 4095]
          context.dbLookup = new Float32Array(DB_LOOKUP_SIZE);
          for (let i = 0; i < DB_LOOKUP_SIZE; i++) {
            const x = i / DB_LOOKUP_SCALE;
            context.dbLookup[i] = (x < MIN_ENV_VAL) ? -120 : LOG10_20 * Math.log(x);
          }

          const EXP_LOOKUP_SIZE = 2048;
          const EXP_LOOKUP_SCALE = EXP_LOOKUP_SIZE / 60; // Maps input [0, 60] dB -> index [0, 2047]
          context.expLookup = new Float32Array(EXP_LOOKUP_SIZE);
          for (let i = 0; i < EXP_LOOKUP_SIZE; i++) {
            const x_db = i / EXP_LOOKUP_SCALE; // dB value
            context.expLookup[i] = Math.exp(-x_db * GAIN_FACTOR); // Linear gain multiplier for negative dB
          }

          // Store constants for faster access within lookup functions
          context.DB_LOOKUP_SIZE = DB_LOOKUP_SIZE;
          context.DB_LOOKUP_SCALE = DB_LOOKUP_SCALE;
          context.EXP_LOOKUP_SIZE = EXP_LOOKUP_SIZE;
          context.EXP_LOOKUP_SCALE = EXP_LOOKUP_SCALE;
          context.MIN_DB_VALUE = -120; // Consistent min dB value
          context.MAX_GR_DB = 60; // Max gain reduction handled by exp lookup
      }
      // Cache lookup tables and constants locally
      const dbLookup = context.dbLookup;
      const expLookup = context.expLookup;
      const DB_LOOKUP_SCALE = context.DB_LOOKUP_SCALE;
      const EXP_LOOKUP_SCALE = context.EXP_LOOKUP_SCALE;
      const MIN_DB_VALUE = context.MIN_DB_VALUE;
      const MAX_GR_DB = context.MAX_GR_DB;

      // Fast approximation functions using lookup tables (as defined in original)
      function fastDb(x) {
        if (x < MIN_ENV_VAL) return MIN_DB_VALUE;
        // Clamp index to valid range
        const indexFloor = Math.floor(x * DB_LOOKUP_SCALE);
        // Replace Math.min with ternary for better performance
        const index = indexFloor > dbLookup.length - 1 ? dbLookup.length - 1 : indexFloor;
        return dbLookup[index]; // Linear interpolation could improve accuracy but wasn't in original
      }

      function fastExp(gainReductionDb) {
        // Input is positive dB reduction, we want exp(-input * factor)
        if (gainReductionDb <= 0) return 1.0;
        if (gainReductionDb >= MAX_GR_DB) return expLookup[expLookup.length - 1];
        // Clamp index to valid range
        const indexFloor = Math.floor(gainReductionDb * EXP_LOOKUP_SCALE);
        // Replace Math.min with ternary for better performance
        const index = indexFloor > expLookup.length - 1 ? expLookup.length - 1 : indexFloor;
        return expLookup[index]; // Linear interpolation could improve accuracy
      }


      // --- Envelope Detection and Gain Application Stage ---
      const envelopeStates = context.envelopeStates; // Local ref

      for (let ch = 0; ch < channelCount; ch++) {
        const bandSignalsCh = context.bandSignals[ch];
        const resultOffset = ch * blockSize;
        const envelopeOffset = ch * 5; // Starting index for this channel's envelopes

        // Clear the per-channel output buffer for summing bands
        // Using fill is generally efficient for TypedArrays
        outputBuffer.fill(0); // Sum bands into this buffer for the current channel

        // Process each band for this channel
        for (let band = 0; band < 5; band++) {
          const bandSignal = bandSignalsCh[band]; // Input signal for this band
          const params = bandParamsCache[band];   // Cached compressor params for this band
          const attackCoeff = timeConstants[band * 2];
          const releaseCoeff = timeConstants[band * 2 + 1];
          let envelope = envelopeStates[envelopeOffset + band]; // Current envelope state

          // Local copies of params for potential performance gain inside the loop
          const thresholdDb = params.thresholdDb;
          const halfKneeDb = params.halfKneeDb;
          const kneeDb = params.kneeDb;
          const slope = params.slope; // (1 - 1/R): positive for compression, negative for expansion
          const makeupLinear = params.makeupLinear;

          let lastGainReduction = 0; // For metering

          // --- Block processing optimization from original ---
          // First pass: Calculate envelope for the block
          let maxEnvelope = envelope; // Track max for potential optimization
          for (let i = 0; i < blockSize; i++) {
              const sample = bandSignal[i];
              const absVal = sample >= 0 ? sample : -sample;
              const coeff = absVal > envelope ? attackCoeff : releaseCoeff;
              envelope = envelope * coeff + absVal * (1 - coeff);
              // Clamp envelope to prevent issues with log(0) or denormals
              if (envelope < MIN_ENV_VAL) envelope = MIN_ENV_VAL;
              workBuffer[i] = envelope; // Store envelope for the second pass
              if (envelope > maxEnvelope) maxEnvelope = envelope;
          }

          // Check if the entire block might be below the threshold zone
          const maxEnvelopeDb = fastDb(maxEnvelope);
          const maxDiff = maxEnvelopeDb - thresholdDb; // Max signal level relative to threshold

          // Skip detailed processing if all samples are below threshold-knee/2
          // This applies to both compression and expansion (gainChange = 0 below knee)
          if (maxDiff <= -halfKneeDb) {
            // Apply only makeup gain
            if (makeupLinear !== 1.0) { // Avoid multiplication by 1
                for (let i = 0; i < blockSize; i++) {
                    outputBuffer[i] += bandSignal[i] * makeupLinear;
                }
            } else {
                for (let i = 0; i < blockSize; i++) {
                    outputBuffer[i] += bandSignal[i];
                }
            }
            lastGainReduction = 0; // No reduction applied
          } else {
            // Compression needed for at least part of the block
            // Second pass: Calculate gain reduction and apply gain
            const blockSizeMod8 = blockSize & ~7; // Align for 8x unrolling
            let i = 0;

            // Loop unrolled by 8 (as in original)
            for (; i < blockSizeMod8; i += 8) {
              // Process 8 samples - compute gain change then apply
              for (let j=0; j<8; ++j) {
                  const idx = i + j;
                  const currentEnvelope = workBuffer[idx];
                  const envelopeDb = fastDb(currentEnvelope);
                  const diff = envelopeDb - thresholdDb; // Signal relative to threshold (dB)

                  // Unified formula for both compression and expansion
                  // For compression (ratio >= 1): slope > 0, gainChange > 0 above threshold (reduction)
                  // For expansion (ratio < 1): slope < 0, gainChange < 0 above threshold (boost)
                  let gainChange = 0;
                  if (diff <= -halfKneeDb) {
                      // Below knee: no change
                      gainChange = 0;
                  } else if (diff >= halfKneeDb) {
                      // Above knee: linear gain change
                      gainChange = diff * slope;
                  } else {
                      // Within knee: quadratic transition
                      const tVal = (diff + halfKneeDb) / kneeDb;
                      gainChange = slope * kneeDb * tVal * tVal * 0.5;
                  }

                  // Apply gain: gainChange > 0 means reduction, gainChange < 0 means boost
                  // fastExp expects positive dB values, so we handle sign
                  const absGainChange = gainChange >= 0 ? gainChange : -gainChange;
                  const gainMultiplier = gainChange >= 0 ? fastExp(absGainChange) : (1.0 / fastExp(absGainChange));
                  const totalGainLin = makeupLinear * gainMultiplier;
                  outputBuffer[idx] += bandSignal[idx] * totalGainLin;

                  // Store last gain change for metering (use absolute value)
                  if (idx === blockSize - 1) {
                    lastGainReduction = absGainChange;
                  }
              }
            }

            // Handle remaining samples (if blockSize wasn't multiple of 8)
            for (; i < blockSize; i++) {
              const currentEnvelope = workBuffer[i];
              const envelopeDb = fastDb(currentEnvelope);
              const diff = envelopeDb - thresholdDb;

              // Unified formula for both compression and expansion
              let gainChange = 0;
              if (diff <= -halfKneeDb) {
                  gainChange = 0;
              } else if (diff >= halfKneeDb) {
                  gainChange = diff * slope;
              } else {
                  const tVal = (diff + halfKneeDb) / kneeDb;
                  gainChange = slope * kneeDb * tVal * tVal * 0.5;
              }

              const absGainChange = gainChange >= 0 ? gainChange : -gainChange;
              const gainMultiplier = gainChange >= 0 ? fastExp(absGainChange) : (1.0 / fastExp(absGainChange));
              const totalGainLin = makeupLinear * gainMultiplier;
              outputBuffer[i] += bandSignal[i] * totalGainLin;

              if (i === blockSize - 1) {
                lastGainReduction = absGainChange;
              }
            }
          }

          // Update envelope state for the next block
          // Clamp again after processing the block
          if (envelope < MIN_ENV_VAL) envelope = MIN_ENV_VAL;
          envelopeStates[envelopeOffset + band] = envelope;

          // Store gain reduction for metering (using the value from the last sample)
          // Ensure it's non-negative
          gainReductions[band] = Math.max(0, lastGainReduction);

        } // End of band loop

        // --- Final Output Generation for Channel ---
        const fadeInState = context.fadeIn;
        // Apply fade-in if active
        if (fadeInState && fadeInState.counter < fadeInState.length) {
          const fadeLen = fadeInState.length;
          for (let i = 0; i < blockSize; i++) {
              // Replace Math.min with ternary for better performance
              const counterRatio = fadeInState.counter / fadeLen;
              const fadeGain = counterRatio > 1.0 ? 1.0 : counterRatio;
              result[resultOffset + i] = outputBuffer[i] * fadeGain;
              fadeInState.counter++;
              // Stop applying gain calculation once counter reaches length within the block
              if (fadeInState.counter >= fadeLen) {
                  // Copy remaining samples directly if fade finished mid-block
                  for (let k = i + 1; k < blockSize; k++) {
                      result[resultOffset + k] = outputBuffer[k];
                  }
                  break; // Exit inner fade loop
              }
          }
          // If fade completed exactly at block end or before
          if (fadeInState.counter >= fadeLen) {
              context.fadeIn = null; // Deactivate fade
          }
        } else {
          // No fade-in active, copy processed summed signal directly to the final result buffer
          // Use TypedArray.set for potential performance benefit over a loop
          result.set(outputBuffer, resultOffset);
        }

      } // End of channel loop

      // Attach measurements to the output
      result.measurements = {
        time: parameters.time,
        gainReductions: gainReductions.slice(0, 5) // Return a copy
      };

      return result;
    `; // End of processor code string
  }

  onMessage(message) {
    if (message.type === 'processBuffer') {
      const result = this.process(message);
      // Only update graphs if there's significant gain reduction (using a threshold to avoid lingering updates)
      const GR_THRESHOLD = 0.05; // 0.05 dB threshold for considering gain reduction significant
      if (this.canvas && this.bands.some(band => band.gr > GR_THRESHOLD)) {
        this.updateTransferGraphs();
      }
      return result;
    }
  }

  process(message) {
    if (!message?.measurements) return;
    const currentTime = performance.now() / 1000;
    const deltaTime = currentTime - this.lastProcessTime;
    this.lastProcessTime = currentTime;
    const targetGrs = message.measurements.gainReductions || Array(5).fill(0);
    const attackTime = 0.005;  // 5ms for fast attack
    const releaseTime = 0.100; // 100ms for smooth release

    for (let i = 0; i < 5; i++) {
      const smoothingFactor = targetGrs[i] > this.bands[i].gr
        ? Math.min(1, deltaTime / attackTime)
        : Math.min(1, deltaTime / releaseTime);
      this.bands[i].gr = Math.max(0, this.bands[i].gr + (targetGrs[i] - this.bands[i].gr) * smoothingFactor);
    }
    return;
  }

  setParameters(params) {
    let graphNeedsUpdate = false;

    // Update crossover frequencies with bounds checking
    if (params.f1 !== undefined) {
      this.f1 = Math.max(20, Math.min(500, params.f1));
      graphNeedsUpdate = true;
    }
    if (params.f2 !== undefined) {
      this.f2 = Math.max(100, Math.min(2000, Math.max(this.f1, params.f2)));
      graphNeedsUpdate = true;
    }
    if (params.f3 !== undefined) {
      this.f3 = Math.max(500, Math.min(8000, Math.max(this.f2, params.f3)));
      graphNeedsUpdate = true;
    }
    if (params.f4 !== undefined) {
      this.f4 = Math.max(1000, Math.min(20000, Math.max(this.f3, params.f4)));
      graphNeedsUpdate = true;
    }

    // Update band parameters if provided as an array
    if (Array.isArray(params.bands)) {
      params.bands.forEach((bandParams, i) => {
        if (i < 5) {
          const band = this.bands[i];
          if (bandParams.t !== undefined) band.t = Math.max(-60, Math.min(0, bandParams.t));
          if (bandParams.r !== undefined) band.r = Math.max(0.5, Math.min(20, bandParams.r));
          if (bandParams.a !== undefined) band.a = Math.max(0.1, Math.min(100, bandParams.a));
          if (bandParams.rl !== undefined) band.rl = Math.max(10, Math.min(1000, bandParams.rl));
          if (bandParams.k !== undefined) band.k = Math.max(0, Math.min(12, bandParams.k));
          if (bandParams.g !== undefined) band.g = Math.max(-12, Math.min(12, bandParams.g));
        }
      });
      graphNeedsUpdate = true;
    } else if (params.band !== undefined) {
      // Check if band index is valid
      if (params.band >= this.bands.length) {
        console.warn(`Invalid band index: ${params.band}`);
        return;
      }
      // Update a single band parameter if provided
      const band = this.bands[params.band];
      if (!band) {
        console.warn(`Band ${params.band} is undefined`);
        return;
      }
      if (params.t !== undefined) { band.t = Math.max(-60, Math.min(0, params.t)); graphNeedsUpdate = true; }
      if (params.r !== undefined) { band.r = Math.max(0.5, Math.min(20, params.r)); graphNeedsUpdate = true; }
      if (params.a !== undefined) band.a = Math.max(0.1, Math.min(100, params.a));
      if (params.rl !== undefined) band.rl = Math.max(10, Math.min(1000, params.rl));
      if (params.k !== undefined) { band.k = Math.max(0, Math.min(12, params.k)); graphNeedsUpdate = true; }
      if (params.g !== undefined) { band.g = Math.max(-12, Math.min(12, params.g)); graphNeedsUpdate = true; }
    }
    if (params.enabled !== undefined) this.enabled = params.enabled;

    this.updateParameters();
    if (graphNeedsUpdate) this.updateTransferGraphs();
  }

  // Frequency slider setters
  setF1(value) { this.setParameters({ f1: value }); }
  setF2(value) { this.setParameters({ f2: value }); }
  setF3(value) { this.setParameters({ f3: value }); }
  setF4(value) { this.setParameters({ f4: value }); }

  // Band parameter setters
  setT(value) { this.setParameters({ band: this.selectedBand, t: value }); }
  setR(value) { this.setParameters({ band: this.selectedBand, r: value }); }
  setA(value) { this.setParameters({ band: this.selectedBand, a: value }); }
  setRl(value) { this.setParameters({ band: this.selectedBand, rl: value }); }
  setK(value) { this.setParameters({ band: this.selectedBand, k: value }); }
  setG(value) { this.setParameters({ band: this.selectedBand, g: value }); }

  getParameters() {
    return {
      type: this.constructor.name,
      f1: this.f1,
      f2: this.f2,
      f3: this.f3,
      f4: this.f4,
      bands: this.bands.map(b => ({
        t: b.t,
        r: b.r,
        a: b.a,
        rl: b.rl,
        k: b.k,
        g: b.g,
        gr: b.gr
      })),
      enabled: this.enabled
    };
  }

  updateTransferGraphs() {
    // Find container element
    const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
    if (!container) return;  // Exit if container is not in DOM

    // Cache DOM query result to minimize reflows, scoped to this instance
    const canvases = Array.from(container.querySelectorAll('.multiband-compressor-band-graph canvas'));
    if (!canvases.length) return;  // Exit if no canvases found

    // Update canvas reference if needed
    if (!this.canvas || !document.contains(this.canvas)) {
      this.canvas = container.querySelector('.multiband-compressor-band-graph.active canvas');
      if (!this.canvas) return;  // Exit if active canvas not found
    }

    // Cached constants for drawing
    const DB_POINTS = [-48, -36, -24, -12];
    const GRID_COLOR = '#444';
    const LABEL_COLOR = '#666';
    const CURVE_COLOR = '#0f0';
    const METER_COLOR = '#008000';

    const graphContexts = canvases.map(canvas => ({
      ctx: canvas.getContext('2d'),
      width: canvas.width,
      height: canvas.height
    }));

    graphContexts.forEach((graph, bandIndex) => {
      // Check if band index is within valid range
      if (bandIndex >= this.bands.length) {
        console.warn(`Invalid band index: ${bandIndex}`);
        return;
      }
      const { ctx, width, height } = graph;
      const band = this.bands[bandIndex];
      
      // Skip processing if band is undefined
      if (!band) {
        console.warn(`Band ${bandIndex} is undefined`);
        return;
      }

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Draw grid lines (vertical & horizontal)
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      DB_POINTS.forEach(db => {
        const x = ((db + 60) / 60) * width;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        const y = height - ((db + 60) / 60) * height;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      });
      ctx.stroke();

      // Draw labels for grid lines
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = '20px Arial';
      DB_POINTS.forEach(db => {
        const x = ((db + 60) / 60) * width;
        const y = height - ((db + 60) / 60) * height;
        ctx.textAlign = 'right';
        ctx.fillText(`${db}dB`, 80, y + 6);
        ctx.textAlign = 'center';
        ctx.fillText(`${db}dB`, x, height - 40);
      });

      // Draw axis labels
      ctx.fillStyle = '#fff';
      ctx.font = '28px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('in', width / 2, height - 5);
      ctx.save();
      ctx.translate(20, height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('out', 0, 0);
      ctx.restore();

      // Draw transfer curve for current band
      ctx.strokeStyle = CURVE_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const halfKnee = band.k * 0.5;
      const ratio = band.r;
      const slope = (ratio === 1.0) ? 0.0 : (1.0 - 1.0 / ratio);

      // Use a smaller number of points for the curve to improve performance
      const numPoints = Math.min(width, 100); // Reduce from width to 100 points
      const pointSpacing = width / numPoints;

      ctx.moveTo(0, height); // Start at bottom-left

      for (let i = 0; i < numPoints; i++) {
        const x = i * pointSpacing;
        const inputDb = (x / width) * 60 - 60;
        const diff = inputDb - band.t;

        // Unified formula for both compression (ratio >= 1) and expansion (ratio < 1)
        // For compression: slope > 0, gainChange > 0 above threshold (reduction)
        // For expansion: slope < 0, gainChange < 0 above threshold (boost)
        let gainChange = 0;
        if (diff <= -halfKnee) {
          gainChange = 0;
        } else if (diff >= halfKnee) {
          gainChange = diff * slope;
        } else {
          const t = (diff + halfKnee) / band.k;
          gainChange = slope * band.k * t * t * 0.5;
        }

        // gainChange > 0 means reduction, gainChange < 0 means boost
        const outputDb = inputDb - gainChange + band.g;
        const y = height - ((outputDb + 60) / 60) * height;
        ctx.lineTo(x, y);// do not clamp y here to allow curve to go off-canvas
      }
      ctx.stroke();

      // Draw gain reduction meter if applicable
      if (band.gr > 0) {
        ctx.fillStyle = METER_COLOR;
        const meterHeight = Math.min(height, (band.gr / 60) * height);
        ctx.fillRect(width - 10, 0, 10, meterHeight);
      }
    });
  }

  createUI() {
    const container = document.createElement('div');
    // Add unique instance identifier
    this.instanceId = `multiband-compressor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    container.className = 'multiband-compressor-container';
    container.setAttribute('data-instance-id', this.instanceId);

    // Frequency sliders UI
    const freqContainer = document.createElement('div');
    freqContainer.className = 'plugin-parameter-ui';
    const freqSliders = document.createElement('div');
    freqSliders.className = 'multiband-compressor-frequency-sliders';
    freqContainer.appendChild(freqSliders);

    const createFreqSlider = (label, min, max, value, setter) => {
      const sliderContainer = document.createElement('div');
      sliderContainer.className = 'multiband-compressor-frequency-slider';
      const topRow = document.createElement('div');
      topRow.className = 'multiband-compressor-frequency-slider-top parameter-row';
      
      // Create a parameter name from the label (e.g., "Freq 1 (Hz):" -> "freq1")
      const paramName = label.toLowerCase().split(' ')[0] + label.match(/\d+/)[0];
      
      const sliderId = `${this.id}-${this.name}-${paramName}-slider`;
      const numberId = `${this.id}-${this.name}-${paramName}-number`;
      
      const labelEl = document.createElement('label');
      labelEl.textContent = label;
      labelEl.htmlFor = sliderId;
      
      const numberInput = document.createElement('input');
      numberInput.type = 'number';
      numberInput.id = numberId;
      numberInput.name = numberId;
      numberInput.min = min;
      numberInput.max = max;
      numberInput.step = 1;
      numberInput.value = value;
      numberInput.autocomplete = "off";
      
      const rangeInput = document.createElement('input');
      rangeInput.type = 'range';
      rangeInput.id = sliderId;
      rangeInput.name = sliderId;
      rangeInput.min = min;
      rangeInput.max = max;
      rangeInput.step = 1;
      rangeInput.value = value;
      rangeInput.autocomplete = "off";
      rangeInput.addEventListener('input', (e) => {
        setter(parseFloat(e.target.value));
        numberInput.value = e.target.value;
      });
      numberInput.addEventListener('input', (e) => {
        const val = Math.max(min, Math.min(max, parseFloat(e.target.value) || 0));
        setter(val);
        rangeInput.value = val;
        e.target.value = val;
      });
      topRow.appendChild(labelEl);
      topRow.appendChild(numberInput);
      sliderContainer.appendChild(topRow);
      sliderContainer.appendChild(rangeInput);
      return sliderContainer;
    };

    freqSliders.appendChild(createFreqSlider('Freq 1 (Hz):', 20, 500, this.f1, this.setF1.bind(this)));
    freqSliders.appendChild(createFreqSlider('Freq 2 (Hz):', 100, 2000, this.f2, this.setF2.bind(this)));
    freqSliders.appendChild(createFreqSlider('Freq 3 (Hz):', 500, 8000, this.f3, this.setF3.bind(this)));
    freqSliders.appendChild(createFreqSlider('Freq 4 (Hz):', 1000, 20000, this.f4, this.setF4.bind(this)));
    container.appendChild(freqContainer);

    // Band settings UI
    const bandSettings = document.createElement('div');
    bandSettings.className = 'multiband-compressor-band-settings';
    const bandTabs = document.createElement('div');
    bandTabs.className = 'multiband-compressor-band-tabs';
    const bandContents = document.createElement('div');
    bandContents.className = 'multiband-compressor-band-contents';

    for (let i = 0; i < this.bands.length; i++) {
      const tab = document.createElement('button');
      tab.className = `multiband-compressor-band-tab ${i === 0 ? 'active' : ''}`;
      tab.textContent = `Band ${i + 1}`;
      // Add instance ID to elements
      tab.setAttribute('data-instance-id', this.instanceId);
      
      tab.onclick = () => {
        if (i >= this.bands.length) {
          console.warn(`Invalid band index: ${i}`);
          return;
        }
        const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
        container.querySelectorAll('.multiband-compressor-band-tab').forEach(t => t.classList.remove('active'));
        container.querySelectorAll('.multiband-compressor-band-content').forEach(c => c.classList.remove('active'));
        container.querySelectorAll('.multiband-compressor-band-graph').forEach(g => g.classList.remove('active'));
        tab.classList.add('active');
        content.classList.add('active');
        container.querySelectorAll('.multiband-compressor-band-graph')[i].classList.add('active');
        this.selectedBand = i;
        this.updateTransferGraphs();
      };
      bandTabs.appendChild(tab);

      // Generate band content
      const content = document.createElement('div');
      content.className = `multiband-compressor-band-content plugin-parameter-ui ${i === 0 ? 'active' : ''}`;
      content.setAttribute('data-instance-id', this.instanceId);

      // Pass the band index to createControl to ensure unique IDs
      const createControl = (label, min, max, step, value, setter, bandIndex) => {
        const row = document.createElement('div');
        row.className = 'parameter-row';
        
        // Create a parameter name from the label (e.g., "Threshold (dB):" -> "thresholddb")
        // Include more of the label to ensure uniqueness
        const paramName = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        const sliderId = `${this.id}-${this.name}-band${bandIndex+1}-${paramName}-slider`;
        const numberId = `${this.id}-${this.name}-band${bandIndex+1}-${paramName}-number`;
        
        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        labelEl.htmlFor = sliderId;
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.name = sliderId;
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        slider.autocomplete = "off";
        
        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.id = numberId;
        numberInput.name = numberId;
        numberInput.min = min;
        numberInput.max = max;
        numberInput.step = step;
        numberInput.value = value;
        numberInput.autocomplete = "off";
        slider.addEventListener('input', (e) => {
          setter(parseFloat(e.target.value));
          numberInput.value = e.target.value;
        });
        numberInput.addEventListener('input', (e) => {
          const parsedValue = parseFloat(e.target.value) || 0;
          const val = parsedValue < min ? min : (parsedValue > max ? max : parsedValue);
          setter(val);
          slider.value = val;
          e.target.value = val;
        });
        row.appendChild(labelEl);
        row.appendChild(slider);
        row.appendChild(numberInput);
        return row;
      };

      const band = this.bands[i];
      content.appendChild(createControl('Threshold (dB):', -60, 0, 1, band.t, this.setT.bind(this), i));
      content.appendChild(createControl('Ratio:', 0.5, 20, 0.01, band.r, this.setR.bind(this), i));
      content.appendChild(createControl('Attack (ms):', 0.1, 100, 0.1, band.a, this.setA.bind(this), i));
      content.appendChild(createControl('Release (ms):', 1, 1000, 1, band.rl, this.setRl.bind(this), i));
      content.appendChild(createControl('Knee (dB):', 0, 12, 1, band.k, this.setK.bind(this), i));
      content.appendChild(createControl('Gain (dB):', -12, 12, 0.1, band.g, this.setG.bind(this), i));
      bandContents.appendChild(content);
    }

    bandSettings.appendChild(bandTabs);
    bandSettings.appendChild(bandContents);
    container.appendChild(bandSettings);

    // Gain reduction graphs UI
    const graphsContainer = document.createElement('div');
    graphsContainer.className = 'multiband-compressor-graphs';
    // Generate graphs based on number of bands
    for (let i = 0; i < this.bands.length; i++) {
      const graphDiv = document.createElement('div');
      graphDiv.className = `multiband-compressor-band-graph ${i === 0 ? 'active' : ''}`;
      graphDiv.setAttribute('data-instance-id', this.instanceId);
      const canvas = document.createElement('canvas');
      // Set canvas buffer size for high-resolution display.
      // This size is intentionally larger than the display size (160x160px defined in CSS)
      // to ensure sharpness when scaled or on high-DPI screens.
      canvas.width = 320;
      canvas.height = 320;
      canvas.style.width = '160px';
      canvas.style.height = '160px';
      canvas.style.backgroundColor = '#222';
      const label = document.createElement('div');
      label.className = 'multiband-compressor-band-graph-label';
      label.textContent = `Band ${i + 1}`;
      graphDiv.appendChild(canvas);
      graphDiv.appendChild(label);
      
      // Add click event to switch to this band when clicking on the graph
      const bandIndex = i; // Capture the current band index
      graphDiv.addEventListener('click', () => {
        if (bandIndex >= this.bands.length) return;
        const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
        container.querySelectorAll('.multiband-compressor-band-tab').forEach(t => t.classList.remove('active'));
        container.querySelectorAll('.multiband-compressor-band-content').forEach(c => c.classList.remove('active'));
        container.querySelectorAll('.multiband-compressor-band-graph').forEach(g => g.classList.remove('active'));
        
        // Find and activate the corresponding tab
        const tab = container.querySelectorAll('.multiband-compressor-band-tab')[bandIndex];
        const content = container.querySelectorAll('.multiband-compressor-band-content')[bandIndex];
        if (tab) tab.classList.add('active');
        if (content) content.classList.add('active');
        graphDiv.classList.add('active');
        
        this.selectedBand = bandIndex;
        this.updateTransferGraphs();
      });
      
      graphsContainer.appendChild(graphDiv);
    }
    container.appendChild(graphsContainer);

    // Cache main canvas reference for animation updates
    this.canvas = container.querySelector('.multiband-compressor-band-graph.active canvas');
    this.updateTransferGraphs();
    this.startAnimation();

    return container;
  }

  startAnimation() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    
    let lastGraphState = null;
    
    const animate = () => {
      // Check if container still exists in DOM
      const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
      if (!container) {
        this.cleanup();  // Stop animation if container is removed
        return;
      }
      
      // Check if the element is in the viewport before updating
      const rect = container.getBoundingClientRect();
      const isVisible = (
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0
      );
      
      if (isVisible) {
        // Check if we need to update the graph
        const needsUpdate = this.needsGraphUpdate(lastGraphState);
        if (needsUpdate) {
          this.updateTransferGraphs();
          // Store current state for future comparison
          lastGraphState = this.getCurrentGraphState();
        }
      }
      
      this.animationFrameId = requestAnimationFrame(animate);
    };
    
    this.animationFrameId = requestAnimationFrame(animate);
  }
  
  // Helper method to determine if graph update is needed
  needsGraphUpdate(lastState) {
    // Always update if no previous state exists
    if (!lastState) return true;
    
    // Use a threshold to determine significant gain reduction
    const GR_THRESHOLD = 0.05; // 0.05 dB threshold for considering gain reduction significant
    
    // Check if any band has significant gain reduction
    const hasActiveReduction = this.bands.some(band => band.gr > GR_THRESHOLD);
    
    // If any band has significant gain reduction, we should update
    if (hasActiveReduction) return true;
    
    // Compare current state with last state
    const currentState = this.getCurrentGraphState();
    
    // Check if any relevant parameters have changed
    return JSON.stringify(currentState) !== JSON.stringify(lastState);
  }
  
  // Get current state of parameters that affect graph appearance
  getCurrentGraphState() {
    const selectedBand = this.bands[this.selectedBand];
    return {
      selectedBand: this.selectedBand,
      threshold: selectedBand.t,
      ratio: selectedBand.r,
      knee: selectedBand.k,
      gain: selectedBand.g,
      gainReduction: selectedBand.gr
    };
  }

  cleanup() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.canvas = null;  // Clear canvas reference
    this.bands.forEach(band => band.gr = 0);
    this.lastProcessTime = performance.now() / 1000;
  }
}

window.MultibandCompressorPlugin = MultibandCompressorPlugin;
