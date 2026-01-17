class MultibandExpanderPlugin extends PluginBase {
  constructor() {
    super('Multiband Expander', '5-band expander with crossover filters');

    // Crossover frequencies
    this.f1 = 100;  // Low
    this.f2 = 500;  // Low-mid
    this.f3 = 2000; // Mid
    this.f4 = 8000; // High

    // Band parameters (5 bands with initial values for expansion)
    // t: threshold, r: ratio, a: attack, rl: release, k: knee, g: gain, gb: gain boost (metering)
    // Threshold values follow 1/f energy distribution (-3dB/octave)
    // Band 0: ~100Hz (center ~50Hz), Band 1: 100-500Hz (center ~225Hz), Band 2: 500-2kHz (center ~1kHz)
    // Band 3: 2k-8kHz (center ~4kHz), Band 4: 8kHz+ (center ~12kHz)
    this.bands = [
      { t: -30, r: 1.2, a: 10,   rl: 100, k: 6, g: 1.0, gb: 0 },  // Low: ~100Hz
      { t: -16, r: 1.2, a: 7.75, rl: 87.5, k: 4, g: 1.0, gb: 0 }, // Low-Mid: 100-500Hz (-6dB from band 0)
      { t: -22, r: 1.2, a: 5.5,  rl: 75, k: 4, g: 1.0, gb: 0 },   // Mid: 500Hz-2kHz (-6dB from band 1)
      { t: -25, r: 1.2, a: 3.25, rl: 62.5, k: 3, g: 1.0, gb: 0 }, // High-Mid: 2k-8kHz (-3dB from band 2)
      { t: -48, r: 1.1, a: 1,    rl: 50, k: 2, g: 1.0, gb: 0 }    // High: 8kHz+ (-3dB from band 3)
    ];

    this.selectedBand = 0;
    this.lastProcessTime = performance.now() / 1000;
    this.animationFrameId = null;

    // Register the processor code (returned as a string)
    this.registerProcessor(this.getProcessorCode());
  }

  getProcessorCode() {
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
        result.measurements = {
          time: parameters.time,
          gainBoosts: context.gainBoosts ? context.gainBoosts.slice(0, 5) : new Float32Array(5)
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
          frequencies: frequencies.slice(),
          channelCount: channelCount
        };

        // Apply a short fade-in to prevent clicks when filter states are reset
        context.fadeIn = {
          counter: 0,
          length: Math.min(blockSize, Math.ceil(sampleRate * 0.005))
        };
        // Ensure envelope states are initialized
        if (!context.envelopeStates || context.envelopeStates.length !== channelCount * 5) {
            context.envelopeStates = new Float32Array(channelCount * 5).fill(MIN_ENV_VAL);
        }
      }

      // --- Filter Coefficient Calculation & Caching ---
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
      const cachedFilters = context.cachedFilters;

      // --- Buffer Management ---
      if (!context.bandSignals || context.bandSignals.length !== channelCount || context.bandSignals[0][0].length !== blockSize) {
        const totalArrays = channelCount * 5;
        const arrayPool = new Float32Array(totalArrays * blockSize);
        context.bandSignals = Array.from({ length: channelCount }, (_, ch) =>
          Array.from({ length: 5 }, (_, band) => {
            const offset = (ch * 5 + band) * blockSize;
            return arrayPool.subarray(offset, offset + blockSize);
          })
        );
        context.arrayPool = arrayPool;
      }

      if (!context.tempBuffers || context.tempBuffers[0].length !== blockSize) {
          context.tempBuffers = [
            new Float32Array(blockSize),
            new Float32Array(blockSize),
            new Float32Array(blockSize)
          ];
        }
      const tempBuffers = context.tempBuffers;

      if (!context.outputBuffer || context.outputBuffer.length !== blockSize) {
        context.outputBuffer = new Float32Array(blockSize);
      }
      const outputBuffer = context.outputBuffer;

      if (!context.workBuffer || context.workBuffer.length !== blockSize) {
          context.workBuffer = new Float32Array(blockSize);
      }
      const workBuffer = context.workBuffer;

      if (!context.gainBoosts || context.gainBoosts.length !== 5) {
        context.gainBoosts = new Float32Array(5);
      }
      const gainBoosts = context.gainBoosts;

      // --- Helper Function: Apply Biquad Filter Block ---
      function applyFilterBlock(input, output, coeffsStage1, coeffsStage2, state, ch, blockLen) {
        const { b0: b0_1, b1: b1_1, b2: b2_1, a1: a1_1, a2: a2_1 } = coeffsStage1;
        const { b0: b0_2, b1: b1_2, b2: b2_2, a1: a1_2, a2: a2_2 } = coeffsStage2;
        const s1 = state.stage1, s2 = state.stage2;

        let s1_x1 = s1.x1[ch], s1_x2 = s1.x2[ch], s1_y1 = s1.y1[ch], s1_y2 = s1.y2[ch];
        let s2_x1 = s2.x1[ch], s2_x2 = s2.x2[ch], s2_y1 = s2.y1[ch], s2_y2 = s2.y2[ch];

        const blockLenMod4 = blockLen & ~3;
        let i = 0;

        for (; i < blockLenMod4; i += 4) {
          let sample = input[i];
          let stage1_out = b0_1 * sample + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
          s1_x2 = s1_x1; s1_x1 = sample; s1_y2 = s1_y1; s1_y1 = stage1_out;
          let stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
          s2_x2 = s2_x1; s2_x1 = stage1_out; s2_y2 = s2_y1; s2_y1 = stage2_out;
          output[i] = stage2_out;

          sample = input[i+1];
          stage1_out = b0_1 * sample + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
          s1_x2 = s1_x1; s1_x1 = sample; s1_y2 = s1_y1; s1_y1 = stage1_out;
          stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
          s2_x2 = s2_x1; s2_x1 = stage1_out; s2_y2 = s2_y1; s2_y1 = stage2_out;
          output[i+1] = stage2_out;

          sample = input[i+2];
          stage1_out = b0_1 * sample + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
          s1_x2 = s1_x1; s1_x1 = sample; s1_y2 = s1_y1; s1_y1 = stage1_out;
          stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
          s2_x2 = s2_x1; s2_x1 = stage1_out; s2_y2 = s2_y1; s2_y1 = stage2_out;
          output[i+2] = stage2_out;

          sample = input[i+3];
          stage1_out = b0_1 * sample + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
          s1_x2 = s1_x1; s1_x1 = sample; s1_y2 = s1_y1; s1_y1 = stage1_out;
          stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
          s2_x2 = s2_x1; s2_x1 = stage1_out; s2_y2 = s2_y1; s2_y1 = stage2_out;
          output[i+3] = stage2_out;
        }

        for (; i < blockLen; i++) {
          const sample = input[i];
          const stage1_out = b0_1 * sample + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
          s1_x2 = s1_x1; s1_x1 = sample; s1_y2 = s1_y1; s1_y1 = stage1_out;
          const stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
          s2_x2 = s2_x1; s2_x1 = stage1_out; s2_y2 = s2_y1; s2_y1 = stage2_out;
          output[i] = stage2_out;
        }

        s1.x1[ch] = s1_x1; s1.x2[ch] = s1_x2; s1.y1[ch] = s1_y1; s1.y2[ch] = s1_y2;
        s2.x1[ch] = s2_x1; s2.x2[ch] = s2_x2; s2.y1[ch] = s2_y1; s2.y2[ch] = s2_y2;
      }

      // --- Filtering Stage (Channel by Channel) ---
      const filterStates = context.filterStates;
      for (let ch = 0; ch < channelCount; ch++) {
        const offset = ch * blockSize;
        const bandSignalsCh = context.bandSignals[ch];

        const inputBuffer = tempBuffers[0];
        const hp1Buffer   = tempBuffers[1];
        const hp2Buffer   = tempBuffers[2];

        for (let i = 0; i < blockSize; i++) {
            inputBuffer[i] = data[offset + i];
        }

        // Band 0 (Low): Lowpass filter applied to the input signal
        applyFilterBlock(inputBuffer, bandSignalsCh[0], cachedFilters[0].lowpassStage1, cachedFilters[0].lowpassStage2, filterStates.lowpass[0], ch, blockSize);

        // Calculate the high-pass complement for the remaining bands
        applyFilterBlock(inputBuffer, hp1Buffer, cachedFilters[0].highpassStage1, cachedFilters[0].highpassStage2, filterStates.highpass[0], ch, blockSize);

        // Band 1 (Low-Mid)
        applyFilterBlock(hp1Buffer, bandSignalsCh[1], cachedFilters[1].lowpassStage1, cachedFilters[1].lowpassStage2, filterStates.lowpass[1], ch, blockSize);

        // Calculate the high-pass complement for the next bands
        applyFilterBlock(hp1Buffer, hp2Buffer, cachedFilters[1].highpassStage1, cachedFilters[1].highpassStage2, filterStates.highpass[1], ch, blockSize);

        // Band 2 (Mid)
        applyFilterBlock(hp2Buffer, bandSignalsCh[2], cachedFilters[2].lowpassStage1, cachedFilters[2].lowpassStage2, filterStates.lowpass[2], ch, blockSize);

        // Calculate the high-pass complement
        applyFilterBlock(hp2Buffer, hp1Buffer, cachedFilters[2].highpassStage1, cachedFilters[2].highpassStage2, filterStates.highpass[2], ch, blockSize);

        // Band 3 (High-Mid)
        applyFilterBlock(hp1Buffer, bandSignalsCh[3], cachedFilters[3].lowpassStage1, cachedFilters[3].lowpassStage2, filterStates.lowpass[3], ch, blockSize);

        // Band 4 (High)
        applyFilterBlock(hp1Buffer, bandSignalsCh[4], cachedFilters[3].highpassStage1, cachedFilters[3].highpassStage2, filterStates.highpass[3], ch, blockSize);
      }

      // --- Expander Parameter Preparation ---
      const sampleRateMs = sampleRate / 1000;

      // Precompute time constants if needed
      let timeConstantsNeedUpdate = !context.timeConstants || context.timeConstants.length !== 10;
      if (!timeConstantsNeedUpdate && context.lastBandParams) {
        for (let b = 0; b < 5; b++) {
          const bandParams = parameters.bands[b];
          const lastParams = context.lastBandParams[b];
          if (bandParams.a !== lastParams.a || bandParams.rl !== lastParams.rl) {
            timeConstantsNeedUpdate = true;
            break;
          }
        }
      } else if (!context.lastBandParams) {
          timeConstantsNeedUpdate = true;
      }

      if (timeConstantsNeedUpdate) {
        if (!context.timeConstants) context.timeConstants = new Float32Array(10);
        if (!context.lastBandParams) context.lastBandParams = new Array(5);

        const timeConstants = context.timeConstants;
        for (let b = 0; b < 5; b++) {
          const bandParams = parameters.bands[b];
          timeConstants[b * 2]     = Math.exp(-LOG2 / Math.max(1, bandParams.a  * sampleRateMs));
          timeConstants[b * 2 + 1] = Math.exp(-LOG2 / Math.max(1, bandParams.rl * sampleRateMs));
          context.lastBandParams[b] = { ...context.lastBandParams[b], a: bandParams.a, rl: bandParams.rl };
        }
      }
      const timeConstants = context.timeConstants;

      // Precompute derived band parameters
      if (!context.bandParams) context.bandParams = new Array(5);

      let bandParamsNeedUpdate = false;
      if (!context.lastBandParams) {
          bandParamsNeedUpdate = true;
      } else {
          for (let b = 0; b < 5; b++) {
              const bp = parameters.bands[b];
              const last = context.lastBandParams[b];
              if (!last || bp.t !== last.t || bp.r !== last.r || bp.k !== last.k || bp.g !== last.g) {
                  bandParamsNeedUpdate = true;
                  break;
              }
          }
      }

      if (bandParamsNeedUpdate) {
          for (let band = 0; band < 5; band++) {
              const bp = parameters.bands[band];
              const ratio = Math.max(0.05, bp.r);
              const knee = Math.max(0, bp.k);

              context.bandParams[band] = {
                  thresholdDb: bp.t,
                  kneeDb: knee,
                  ratio: ratio,
                  makeupDb: bp.g,
                  halfKneeDb: knee * 0.5,
                  // For expander: expansion slope = ratio - 1
                  expansionSlope: ratio - 1,
                  makeupLinear: Math.exp(bp.g * GAIN_FACTOR)
              };
              context.lastBandParams[band] = { ...context.lastBandParams[band], t: bp.t, r: bp.r, k: bp.k, g: bp.g };
          }
      }
      const bandParamsCache = context.bandParams;

      // --- Lookup Table Setup ---
      if (!context.dbLookup) {
          const DB_LOOKUP_SIZE = 4096;
          const DB_LOOKUP_SCALE = DB_LOOKUP_SIZE / 10;
          context.dbLookup = new Float32Array(DB_LOOKUP_SIZE);
          for (let i = 0; i < DB_LOOKUP_SIZE; i++) {
            const x = i / DB_LOOKUP_SCALE;
            context.dbLookup[i] = (x < MIN_ENV_VAL) ? -120 : LOG10_20 * Math.log(x);
          }

          // Exp lookup for gain (handles both positive and negative dB)
          const EXP_LOOKUP_RANGE_DB = 80.0;
          const EXP_LOOKUP_MIN_DB = -60.0;
          const EXP_LOOKUP_SIZE = 4096;
          const EXP_LOOKUP_SCALE = EXP_LOOKUP_SIZE / EXP_LOOKUP_RANGE_DB;
          context.expLookup = new Float32Array(EXP_LOOKUP_SIZE);
          for (let i = 0; i < EXP_LOOKUP_SIZE; i++) {
            const x_db = EXP_LOOKUP_MIN_DB + (i / EXP_LOOKUP_SCALE);
            context.expLookup[i] = Math.exp(x_db * GAIN_FACTOR);
          }

          context.DB_LOOKUP_SIZE = DB_LOOKUP_SIZE;
          context.DB_LOOKUP_SCALE = DB_LOOKUP_SCALE;
          context.EXP_LOOKUP_SIZE = EXP_LOOKUP_SIZE;
          context.EXP_LOOKUP_SCALE = EXP_LOOKUP_SCALE;
          context.EXP_LOOKUP_MIN_DB = EXP_LOOKUP_MIN_DB;
          context.EXP_LOOKUP_RANGE_DB = EXP_LOOKUP_RANGE_DB;
          context.MIN_DB_VALUE = -120;
      }

      const dbLookup = context.dbLookup;
      const expLookup = context.expLookup;
      const DB_LOOKUP_SCALE = context.DB_LOOKUP_SCALE;
      const EXP_LOOKUP_SCALE = context.EXP_LOOKUP_SCALE;
      const EXP_LOOKUP_MIN_DB = context.EXP_LOOKUP_MIN_DB;
      const EXP_LOOKUP_RANGE_DB = context.EXP_LOOKUP_RANGE_DB;
      const MIN_DB_VALUE = context.MIN_DB_VALUE;

      function fastDb(x) {
        if (x < MIN_ENV_VAL) return MIN_DB_VALUE;
        const indexFloor = Math.floor(x * DB_LOOKUP_SCALE);
        const index = indexFloor > dbLookup.length - 1 ? dbLookup.length - 1 : indexFloor;
        return dbLookup[index];
      }

      function fastExpDb(x_db) {
        if (x_db <= EXP_LOOKUP_MIN_DB) return expLookup[0];
        if (x_db >= EXP_LOOKUP_MIN_DB + EXP_LOOKUP_RANGE_DB) return expLookup[expLookup.length - 1];
        const indexFloor = Math.floor((x_db - EXP_LOOKUP_MIN_DB) * EXP_LOOKUP_SCALE);
        const index = indexFloor > expLookup.length - 1 ? expLookup.length - 1 : indexFloor;
        return expLookup[index];
      }

      // --- Envelope Detection and Gain Application Stage ---
      const envelopeStates = context.envelopeStates;

      for (let ch = 0; ch < channelCount; ch++) {
        const bandSignalsCh = context.bandSignals[ch];
        const resultOffset = ch * blockSize;
        const envelopeOffset = ch * 5;

        outputBuffer.fill(0);

        for (let band = 0; band < 5; band++) {
          const bandSignal = bandSignalsCh[band];
          const params = bandParamsCache[band];
          const attackCoeff = timeConstants[band * 2];
          const releaseCoeff = timeConstants[band * 2 + 1];
          let envelope = envelopeStates[envelopeOffset + band];

          const thresholdDb = params.thresholdDb;
          const halfKneeDb = params.halfKneeDb;
          const kneeDb = params.kneeDb;
          const expansionSlope = params.expansionSlope;
          const makeupLinear = params.makeupLinear;

          let lastGainBoost = 0;

          // First pass: Calculate envelope for the block
          let maxEnvelope = envelope;
          for (let i = 0; i < blockSize; i++) {
              const sample = bandSignal[i];
              const absVal = sample >= 0 ? sample : -sample;
              const coeff = absVal > envelope ? attackCoeff : releaseCoeff;
              envelope = envelope * coeff + absVal * (1 - coeff);
              if (envelope < MIN_ENV_VAL) envelope = MIN_ENV_VAL;
              workBuffer[i] = envelope;
              if (envelope > maxEnvelope) maxEnvelope = envelope;
          }

          // Check if the entire block might be above the threshold zone (no expansion needed)
          const maxEnvelopeDb = fastDb(maxEnvelope);
          const maxDiff = maxEnvelopeDb - thresholdDb;

          // For expander: if signal is above threshold + halfKnee, no expansion needed
          if (maxDiff >= halfKneeDb) {
            if (makeupLinear !== 1.0) {
                for (let i = 0; i < blockSize; i++) {
                    outputBuffer[i] += bandSignal[i] * makeupLinear;
                }
            } else {
                for (let i = 0; i < blockSize; i++) {
                    outputBuffer[i] += bandSignal[i];
                }
            }
            lastGainBoost = 0;
          } else {
            // Expansion needed for at least part of the block
            const blockSizeMod8 = blockSize & ~7;
            let i = 0;

            for (; i < blockSizeMod8; i += 8) {
              for (let j=0; j<8; ++j) {
                  const idx = i + j;
                  const currentEnvelope = workBuffer[idx];
                  const envelopeDb = fastDb(currentEnvelope);
                  const diff = envelopeDb - thresholdDb;

                  let gainBoost = 0;
                  // Expander logic: expand (reduce gain) when below threshold
                  if (diff <= -halfKneeDb) {
                      // Below threshold: apply expansion
                      gainBoost = diff * expansionSlope;
                  } else if (diff >= halfKneeDb) {
                      // Above threshold: no change
                      gainBoost = 0;
                  } else {
                      // Within knee: smooth transition
                      const t = (diff + halfKneeDb) / kneeDb;
                      const linearBelow = (-halfKneeDb) * expansionSlope;
                      gainBoost = linearBelow * (1 - t) * (1 - t);
                  }

                  const totalGainDb = params.makeupDb + gainBoost;
                  const totalGainLin = fastExpDb(totalGainDb);
                  outputBuffer[idx] += bandSignal[idx] * totalGainLin;

                  if (idx === blockSize - 1) {
                    lastGainBoost = gainBoost >= 0 ? gainBoost : -gainBoost;
                  }
              }
            }

            for (; i < blockSize; i++) {
              const currentEnvelope = workBuffer[i];
              const envelopeDb = fastDb(currentEnvelope);
              const diff = envelopeDb - thresholdDb;

              let gainBoost = 0;
              if (diff <= -halfKneeDb) {
                  gainBoost = diff * expansionSlope;
              } else if (diff >= halfKneeDb) {
                  gainBoost = 0;
              } else {
                  const t = (diff + halfKneeDb) / kneeDb;
                  const linearBelow = (-halfKneeDb) * expansionSlope;
                  gainBoost = linearBelow * (1 - t) * (1 - t);
              }

              const totalGainDb = params.makeupDb + gainBoost;
              const totalGainLin = fastExpDb(totalGainDb);
              outputBuffer[i] += bandSignal[i] * totalGainLin;

              if (i === blockSize - 1) {
                lastGainBoost = gainBoost >= 0 ? gainBoost : -gainBoost;
              }
            }
          }

          if (envelope < MIN_ENV_VAL) envelope = MIN_ENV_VAL;
          envelopeStates[envelopeOffset + band] = envelope;

          gainBoosts[band] = Math.max(0, lastGainBoost);

        } // End of band loop

        // --- Final Output Generation for Channel ---
        const fadeInState = context.fadeIn;
        if (fadeInState && fadeInState.counter < fadeInState.length) {
          const fadeLen = fadeInState.length;
          for (let i = 0; i < blockSize; i++) {
              const counterRatio = fadeInState.counter / fadeLen;
              const fadeGain = counterRatio > 1.0 ? 1.0 : counterRatio;
              result[resultOffset + i] = outputBuffer[i] * fadeGain;
              fadeInState.counter++;
              if (fadeInState.counter >= fadeLen) {
                  for (let k = i + 1; k < blockSize; k++) {
                      result[resultOffset + k] = outputBuffer[k];
                  }
                  break;
              }
          }
          if (fadeInState.counter >= fadeLen) {
              context.fadeIn = null;
          }
        } else {
          result.set(outputBuffer, resultOffset);
        }

      } // End of channel loop

      result.measurements = {
        time: parameters.time,
        gainBoosts: gainBoosts.slice(0, 5)
      };

      return result;
    `;
  }

  onMessage(message) {
    if (message.type === 'processBuffer') {
      const result = this.process(message);
      const GB_THRESHOLD = 0.05;
      if (this.canvas && this.bands.some(band => band.gb > GB_THRESHOLD)) {
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
    const targetGbs = message.measurements.gainBoosts || Array(5).fill(0);
    const attackTime = 0.005;
    const releaseTime = 0.100;

    for (let i = 0; i < 5; i++) {
      const smoothingFactor = targetGbs[i] > this.bands[i].gb
        ? Math.min(1, deltaTime / attackTime)
        : Math.min(1, deltaTime / releaseTime);
      this.bands[i].gb = Math.max(0, this.bands[i].gb + (targetGbs[i] - this.bands[i].gb) * smoothingFactor);
    }
    return;
  }

  setParameters(params) {
    let graphNeedsUpdate = false;

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

    if (Array.isArray(params.bands)) {
      params.bands.forEach((bandParams, i) => {
        if (i < 5) {
          const band = this.bands[i];
          if (bandParams.t !== undefined) band.t = Math.max(-60, Math.min(0, bandParams.t));
          if (bandParams.r !== undefined) band.r = Math.max(0.05, Math.min(20, bandParams.r));
          if (bandParams.a !== undefined) band.a = Math.max(0.1, Math.min(100, bandParams.a));
          if (bandParams.rl !== undefined) band.rl = Math.max(10, Math.min(1000, bandParams.rl));
          if (bandParams.k !== undefined) band.k = Math.max(0, Math.min(12, bandParams.k));
          if (bandParams.g !== undefined) band.g = Math.max(-12, Math.min(12, bandParams.g));
        }
      });
      graphNeedsUpdate = true;
    } else if (params.band !== undefined) {
      if (params.band >= this.bands.length) {
        console.warn(`Invalid band index: ${params.band}`);
        return;
      }
      const band = this.bands[params.band];
      if (!band) {
        console.warn(`Band ${params.band} is undefined`);
        return;
      }
      if (params.t !== undefined) { band.t = Math.max(-60, Math.min(0, params.t)); graphNeedsUpdate = true; }
      if (params.r !== undefined) { band.r = Math.max(0.05, Math.min(20, params.r)); graphNeedsUpdate = true; }
      if (params.a !== undefined) band.a = Math.max(0.1, Math.min(100, params.a));
      if (params.rl !== undefined) band.rl = Math.max(10, Math.min(1000, params.rl));
      if (params.k !== undefined) { band.k = Math.max(0, Math.min(12, params.k)); graphNeedsUpdate = true; }
      if (params.g !== undefined) { band.g = Math.max(-12, Math.min(12, params.g)); graphNeedsUpdate = true; }
    }
    if (params.enabled !== undefined) this.enabled = params.enabled;

    this.updateParameters();
    if (graphNeedsUpdate) this.updateTransferGraphs();
  }

  setF1(value) { this.setParameters({ f1: value }); }
  setF2(value) { this.setParameters({ f2: value }); }
  setF3(value) { this.setParameters({ f3: value }); }
  setF4(value) { this.setParameters({ f4: value }); }

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
        gb: b.gb
      })),
      enabled: this.enabled
    };
  }

  updateTransferGraphs() {
    const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
    if (!container) return;

    const canvases = Array.from(container.querySelectorAll('.multiband-expander-band-graph canvas'));
    if (!canvases.length) return;

    if (!this.canvas || !document.contains(this.canvas)) {
      this.canvas = container.querySelector('.multiband-expander-band-graph.active canvas');
      if (!this.canvas) return;
    }

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
      if (bandIndex >= this.bands.length) {
        console.warn(`Invalid band index: ${bandIndex}`);
        return;
      }
      const { ctx, width, height } = graph;
      const band = this.bands[bandIndex];

      if (!band) {
        console.warn(`Band ${bandIndex} is undefined`);
        return;
      }

      ctx.clearRect(0, 0, width, height);

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

      ctx.fillStyle = '#fff';
      ctx.font = '28px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('in', width / 2, height - 5);
      ctx.save();
      ctx.translate(20, height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('out', 0, 0);
      ctx.restore();

      // Draw transfer curve for expander
      ctx.strokeStyle = CURVE_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();

      const halfKnee = band.k * 0.5;
      const expansionSlope = band.r - 1;

      const numPoints = Math.min(width, 100);
      const pointSpacing = width / numPoints;

      ctx.moveTo(0, height);

      for (let i = 0; i < numPoints; i++) {
        const x = i * pointSpacing;
        const inputDb = (x / width) * 60 - 60;
        const diff = inputDb - band.t;
        let gainBoost = 0;

        // Expander logic: expand below threshold
        if (diff <= -halfKnee) {
          gainBoost = diff * expansionSlope;
        } else if (diff >= halfKnee) {
          gainBoost = 0;
        } else {
          const t = (diff + halfKnee) / band.k;
          const linearBelow = (-halfKnee) * expansionSlope;
          gainBoost = linearBelow * (1 - t) * (1 - t);
        }

        const totalGain = gainBoost + band.g;
        const clampedTotalGain = Math.max(-60, Math.min(20, totalGain));
        const outputDb = inputDb + clampedTotalGain;
        const y = height - ((outputDb + 60) / 60) * height;
        ctx.lineTo(x, Math.max(0, Math.min(height, y)));
      }
      ctx.stroke();

      // Draw gain boost meter (from top down, similar to expander)
      if (band.gb > 0) {
        ctx.fillStyle = METER_COLOR;
        const meterHeight = Math.min(height, (band.gb / 60) * height);
        ctx.fillRect(width - 10, 0, 10, meterHeight);
      }
    });
  }

  createUI() {
    const container = document.createElement('div');
    this.instanceId = `multiband-expander-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    container.className = 'multiband-expander-container';
    container.setAttribute('data-instance-id', this.instanceId);

    // Frequency sliders UI
    const freqContainer = document.createElement('div');
    freqContainer.className = 'plugin-parameter-ui';
    const freqSliders = document.createElement('div');
    freqSliders.className = 'multiband-expander-frequency-sliders';
    freqContainer.appendChild(freqSliders);

    const createFreqSlider = (label, min, max, value, setter) => {
      const sliderContainer = document.createElement('div');
      sliderContainer.className = 'multiband-expander-frequency-slider';
      const topRow = document.createElement('div');
      topRow.className = 'multiband-expander-frequency-slider-top parameter-row';

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
    bandSettings.className = 'multiband-expander-band-settings';
    const bandTabs = document.createElement('div');
    bandTabs.className = 'multiband-expander-band-tabs';
    const bandContents = document.createElement('div');
    bandContents.className = 'multiband-expander-band-contents';

    for (let i = 0; i < this.bands.length; i++) {
      const tab = document.createElement('button');
      tab.className = `multiband-expander-band-tab ${i === 0 ? 'active' : ''}`;
      tab.textContent = `Band ${i + 1}`;
      tab.setAttribute('data-instance-id', this.instanceId);

      tab.onclick = () => {
        if (i >= this.bands.length) {
          console.warn(`Invalid band index: ${i}`);
          return;
        }
        const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
        container.querySelectorAll('.multiband-expander-band-tab').forEach(t => t.classList.remove('active'));
        container.querySelectorAll('.multiband-expander-band-content').forEach(c => c.classList.remove('active'));
        container.querySelectorAll('.multiband-expander-band-graph').forEach(g => g.classList.remove('active'));
        tab.classList.add('active');
        content.classList.add('active');
        container.querySelectorAll('.multiband-expander-band-graph')[i].classList.add('active');
        this.selectedBand = i;
        this.updateTransferGraphs();
      };
      bandTabs.appendChild(tab);

      const content = document.createElement('div');
      content.className = `multiband-expander-band-content plugin-parameter-ui ${i === 0 ? 'active' : ''}`;
      content.setAttribute('data-instance-id', this.instanceId);

      const createControl = (label, min, max, step, value, setter, bandIndex) => {
        const row = document.createElement('div');
        row.className = 'parameter-row';

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
      content.appendChild(createControl('Ratio:', 0.05, 20, 0.01, band.r, this.setR.bind(this), i));
      content.appendChild(createControl('Attack (ms):', 0.1, 100, 0.1, band.a, this.setA.bind(this), i));
      content.appendChild(createControl('Release (ms):', 1, 1000, 1, band.rl, this.setRl.bind(this), i));
      content.appendChild(createControl('Knee (dB):', 0, 12, 1, band.k, this.setK.bind(this), i));
      content.appendChild(createControl('Gain (dB):', -12, 12, 0.1, band.g, this.setG.bind(this), i));
      bandContents.appendChild(content);
    }

    bandSettings.appendChild(bandTabs);
    bandSettings.appendChild(bandContents);
    container.appendChild(bandSettings);

    // Gain boost graphs UI
    const graphsContainer = document.createElement('div');
    graphsContainer.className = 'multiband-expander-graphs';
    for (let i = 0; i < this.bands.length; i++) {
      const graphDiv = document.createElement('div');
      graphDiv.className = `multiband-expander-band-graph ${i === 0 ? 'active' : ''}`;
      graphDiv.setAttribute('data-instance-id', this.instanceId);
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 320;
      canvas.style.width = '160px';
      canvas.style.height = '160px';
      canvas.style.backgroundColor = '#222';
      const label = document.createElement('div');
      label.className = 'multiband-expander-band-graph-label';
      label.textContent = `Band ${i + 1}`;
      graphDiv.appendChild(canvas);
      graphDiv.appendChild(label);

      const bandIndex = i;
      graphDiv.addEventListener('click', () => {
        if (bandIndex >= this.bands.length) return;
        const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
        container.querySelectorAll('.multiband-expander-band-tab').forEach(t => t.classList.remove('active'));
        container.querySelectorAll('.multiband-expander-band-content').forEach(c => c.classList.remove('active'));
        container.querySelectorAll('.multiband-expander-band-graph').forEach(g => g.classList.remove('active'));

        const tab = container.querySelectorAll('.multiband-expander-band-tab')[bandIndex];
        const content = container.querySelectorAll('.multiband-expander-band-content')[bandIndex];
        if (tab) tab.classList.add('active');
        if (content) content.classList.add('active');
        graphDiv.classList.add('active');

        this.selectedBand = bandIndex;
        this.updateTransferGraphs();
      });

      graphsContainer.appendChild(graphDiv);
    }
    container.appendChild(graphsContainer);

    this.canvas = container.querySelector('.multiband-expander-band-graph.active canvas');
    this.updateTransferGraphs();
    this.startAnimation();

    return container;
  }

  startAnimation() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

    let lastGraphState = null;

    const animate = () => {
      const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
      if (!container) {
        this.cleanup();
        return;
      }

      const rect = container.getBoundingClientRect();
      const isVisible = (
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0
      );

      if (isVisible) {
        const needsUpdate = this.needsGraphUpdate(lastGraphState);
        if (needsUpdate) {
          this.updateTransferGraphs();
          lastGraphState = this.getCurrentGraphState();
        }
      }

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  needsGraphUpdate(lastState) {
    if (!lastState) return true;

    const GB_THRESHOLD = 0.05;

    const hasActiveBoost = this.bands.some(band => band.gb > GB_THRESHOLD);

    if (hasActiveBoost) return true;

    const currentState = this.getCurrentGraphState();

    return JSON.stringify(currentState) !== JSON.stringify(lastState);
  }

  getCurrentGraphState() {
    const selectedBand = this.bands[this.selectedBand];
    return {
      selectedBand: this.selectedBand,
      threshold: selectedBand.t,
      ratio: selectedBand.r,
      knee: selectedBand.k,
      gain: selectedBand.g,
      gainBoost: selectedBand.gb
    };
  }

  cleanup() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.canvas = null;
    this.bands.forEach(band => band.gb = 0);
    this.lastProcessTime = performance.now() / 1000;
  }
}

window.MultibandExpanderPlugin = MultibandExpanderPlugin;
