// Digital-Error Emulator Plugin
// Simulates various digital audio transmission errors
class DigitalErrorEmulatorPlugin extends PluginBase {
    constructor() {
      super('Digital Error Emulator', 'Simulates various digital audio transmission errors');
      // Parameter mappings
      this.be = -6;    // BER exponent (-12 to -2)
      this.md = "10A";   // Mode ("1", "2A", "2B", "3A", "3B", "4", "5A", "5B", "5C", "6A", "6B", "7", "8", "9", "10", "10A")
      this.rf = 48;    // Reference Fs (kHz)
      this.wt = 100;   // Wet Mix (0-100%)
      
      // Constants for error processing
      this.CONSTANTS = {
        FADE_SAMPLES: 16,         // Generic fade in/out duration in samples
        BLUETOOTH_DECAY: 0.995,      // Bluetooth PLC decay factor (ITU-T reference)
        BLUETOOTH_WARBLE_HZ: 4.3,     // Bluetooth warble frequency in Hz
        BLUETOOTH_WARBLE_AMP: 0.002,   // Bluetooth warble amplitude
        LC3_BLEND_FACTOR: 0.95,      // LC3 codec blend factor
        LC3_ARTIFACT_AMP: 0.0002,     // LC3 artifact noise amplitude
        HDMI_NOISE_AMP: 0.001,      // HDMI quantization noise amplitude
        RF_SQUELCH_MIN_MS: 1,       // Minimum RF squelch duration
        RF_SQUELCH_MAX_MS: 50       // Maximum RF squelch duration
      };
      // Unified mode definitions
      this.MODE_DEFINITIONS = {
        "1":  { name: 'AES3 / S-PDIF (I²S) — Bit Error (Hold)',    unitSize: 1,  bitsPerUnit: 24,    sampleFixed: true },
        "2A": { name: 'ADAT / TDIF / MADI — Short Burst (Hold)',   unitSize: 32,  bitsPerUnit: 1024,   sampleFixed: true },
        "2B": { name: 'ADAT / TDIF / MADI — Short Burst (Mute)',   unitSize: 32,  bitsPerUnit: 1024,   sampleFixed: true },
        "3A": { name: 'HDMI / DP — Row Corruption (CRC Pass)',    unitSize: 192, bitsPerUnit: 6144,   sampleFixed: true },
        "3B": { name: 'HDMI / DP — Row Mute (CRC Fail)',       unitSize: 192, bitsPerUnit: 6144,   sampleFixed: true },
        "4":  { name: 'USB / 1394 / TB — µ-Frame Drop',       unitSize: 0,  bitsPerUnit: 0,    sampleFixed: false }, // Calculated dynamically
        "5A": { name: 'Dante / AES67 / AVB — UDP Drop (64 samp)',  unitSize: 64,  bitsPerUnit: 0,    sampleFixed: true },  // Calculated dynamically
        "5B": { name: 'Dante / AES67 / AVB — UDP Drop (128 samp)',  unitSize: 128, bitsPerUnit: 0,    sampleFixed: true },  // Calculated dynamically
        "5C": { name: 'Dante / AES67 / AVB — UDP Drop (256 samp)',  unitSize: 256, bitsPerUnit: 0,    sampleFixed: true },  // Calculated dynamically
        "6A": { name: 'Bluetooth A2DP — Digital Transmission',     unitSize: 360, bitsPerUnit: 0,    sampleFixed: true }, // Post-codec transmission errors with FEC
        "6B": { name: 'Bluetooth LE — Digital Transmission',     unitSize: 480, bitsPerUnit: 0,    sampleFixed: true }, // Post-codec transmission errors with FEC
        "8":  { name: 'WiSA — FEC Block Mute',            unitSize: 32,  bitsPerUnit: 1024,   sampleFixed: true },
        "9":  { name: 'WMAS / DECT / Axient — RF Squelch',      unitSize: 48,  bitsPerUnit: 1536,   sampleFixed: true },
        "10": { name: 'CD Audio — CIRC Error Correction (Hold)',      unitSize: 588, bitsPerUnit: 0,    sampleFixed: true },  // 1 EFM frame = 588 ch-bits
        "10A": { name: 'CD Audio — CIRC Error Correction (Interpolated)',      unitSize: 588, bitsPerUnit: 0,    sampleFixed: true }  // 1 EFM frame = 588 ch-bits with improved interpolation
      };
      this.REFERENCE_FS_KHZ_VALUES = [44.1, 48, 88.2, 96, 176.4, 192];
      this.registerProcessor(`
        if (!parameters.enabled) return data;
        const { sampleRate: fs, blockSize, channelCount } = parameters;
        const MAX_PLC_BUFFER_SAMPLES = 8192;
        // --- Processor State Initialization ---
        if (!context.initialized) {
          context.sampleCount = 0;
          context.nextEventTime = -1; // -1 forces scheduling on the first run
          context.errorState = { active: false, samplesRemaining: 0, mode: null, lastGoodSamples: null, totalDuration: 0 };
          
          context.lastParams = {}; // Store last known parameters to detect changes
          
          // Delay buffer for next sample reference (1 sample delay) - only for 10A mode
          context.delayBuffer = null;
          context.delayBufferValid = false;
          context.channelCount = -1;
          context.wetData = null;
          context.delayedData = null;
          context.sharedErrorProbability3A = null;
          context.sharedBitPosition3A = null;
          context.sharedWarblePhase = null;
          context.symbolErrorFlags = new Uint8Array(24);
          
          // CD-specific state for CIRC error correction simulation
          context.cdState = {
            c1ErrorCount: 0,    // Count of C1 uncorrectable errors
            c2ErrorCount: 0,    // Count of C2 uncorrectable errors
            consecutiveErrors: 0,  // Count of consecutive uncorrectable samples
            errorSeverity: 'none' // 'none', 'interpolate', 'hold', 'mute', 'skip'
          };
          context.initialized = true;
        }
        if (!context.plcBuffer || context.channelCount !== channelCount) {
          // Buffer for Packet Loss Concealment (PLC), sized for the largest possible error unit.
          context.plcBuffer = new Array(channelCount)
            .fill(null).map(() => new Float32Array(MAX_PLC_BUFFER_SAMPLES));

          // Pink noise generator state for LC3 simulation
          context.pinkNoiseState = new Float32Array(channelCount).fill(0);

          // Store the last good sample before an error, for interpolation
          context.lastGoodSamples = new Float32Array(channelCount).fill(0);
          context.delayBuffer = new Array(channelCount)
            .fill(null).map(() => new Float32Array(1));
          context.delayBufferValid = false;
          context.channelCount = channelCount;
          context.errorLastGoodSamples = new Float32Array(channelCount);
          context.nextEventTime = -1;
          context.errorState.active = false;
          context.errorState.samplesRemaining = 0;
          context.errorState.mode = null;
          context.errorState.lastGoodSamples = null;
          context.errorState.totalDuration = 0;
        }
        const dataLength = data.length;
        if (!context.wetData || context.wetData.length !== dataLength) {
          context.wetData = new Float32Array(dataLength);
        }
        if (!context.sharedErrorProbability3A || context.sharedErrorProbability3A.length !== blockSize) {
          context.sharedErrorProbability3A = new Float64Array(blockSize);
          context.sharedBitPosition3A = new Uint8Array(blockSize);
          context.sharedWarblePhase = new Float64Array(blockSize);
        }
        const CONSTANTS = ${JSON.stringify(this.CONSTANTS)};
        const modeInfo = ${JSON.stringify(this.MODE_DEFINITIONS)}[parameters.md];
        // --- Parameter Change Detection ---
        // If key parameters change, invalidate current schedule to apply new parameters.
        const paramsChanged = parameters.be !== context.lastParams.be ||
                   parameters.md !== context.lastParams.md ||
                   parameters.rf !== context.lastParams.rf ||
                   fs !== context.lastParams.sampleRate;
        if (paramsChanged) {
          context.nextEventTime = -1; // Invalidate current schedule (will reschedule with new params)
          // Clear any active error state to apply new parameters immediately
          context.errorState.active = false;
          context.errorState.samplesRemaining = 0;
          context.errorState.mode = null;
          context.errorState.lastGoodSamples = null;
          context.errorState.totalDuration = 0;
          context.lastParams.be = parameters.be;
          context.lastParams.md = parameters.md;
          context.lastParams.rf = parameters.rf;
          context.lastParams.sampleRate = fs;
        }
        // --- Dynamic Mode & Parameter Calculation ---
        const wetMix = parameters.wt / 100;
        const dryMix = 1 - wetMix;
        
        // Calculate error unit size in samples based on real-world behavior
        let unitSamples;
        if (parameters.md === "1") { // AES3/S-PDIF: Always single sample
          unitSamples = 1;
        } else if (parameters.md === "2A" || parameters.md === "2B") { // ADAT/TDIF/MADI: Fixed 32-sample blocks
          unitSamples = 32;
        } else if (parameters.md === "3A" || parameters.md === "3B") { // HDMI/DP: Fixed 192-sample rows
          unitSamples = 192;
        } else if (parameters.md === "4") { // USB/1394/TB: 125µs micro-frame (time-based)
          unitSamples = Math.round(fs * 0.000125);
          if (unitSamples < 1) unitSamples = 1;
        } else if (parameters.md === "5A" || parameters.md === "5B" || parameters.md === "5C") { // Dante: Actual sample count based on current Fs
          const scale = fs / (parameters.rf * 1000);
          unitSamples = Math.round(modeInfo.unitSize * scale);
          if (unitSamples < 1) unitSamples = 1;
        } else if (parameters.md === "6A" || parameters.md === "6B") { // Bluetooth: Fixed frame sizes
          unitSamples = modeInfo.unitSize; // 360 or 480 samples
        } else if (parameters.md === "8") { // WiSA: Fixed 32-sample blocks
          unitSamples = 32;
        } else if (parameters.md === "9") { // RF Squelch: Base duration (will be randomized later)
          unitSamples = Math.round(48 * fs / 48000); // Scale 48 samples from 48kHz base
          if (unitSamples < 1) unitSamples = 1;
        } else if (parameters.md === "10" || parameters.md === "10A") { // CD Audio: EFM frame corresponds to audio samples
          unitSamples = Math.round(fs / 7350); // 1 EFM frame = 1/7350 second (44.1kHz/6 samples per frame)
          if (unitSamples < 1) unitSamples = 1;
        }
        if (!Number.isFinite(unitSamples) || unitSamples < 1) {
          unitSamples = 1;
        } else if (unitSamples > MAX_PLC_BUFFER_SAMPLES) {
          unitSamples = MAX_PLC_BUFFER_SAMPLES;
        }
        // Calculate bits per error unit for probability calculation
        let bitsPerUnit = modeInfo.bitsPerUnit;
        if (parameters.md === "4") {
          bitsPerUnit = unitSamples * 32 * channelCount; // 32 bits per sample, across all channels
        } else if (parameters.md === "5A" || parameters.md === "5B" || parameters.md === "5C") {
          const payloadBits = modeInfo.unitSize * 24 * channelCount; // 24-bit audio data
          const headerBits = 432; // Typical L2/IP/UDP/RTP header size in bits
          bitsPerUnit = payloadBits + headerBits;
        } else if (parameters.md === "6A") {
          // Bluetooth A2DP: Post-codec digital transmission with 2/3 FEC (does not simulate codec processing)
          const audioBits = unitSamples * 16 * channelCount; // Compressed audio data bits after codec processing
          const l2capHeader = 32; // L2CAP header (4 bytes)
          const avdtpHeader = 96; // AVDTP header + RTP-like header (12 bytes)
          bitsPerUnit = audioBits + l2capHeader + avdtpHeader; // FEC effect handled in probability calculation
        } else if (parameters.md === "6B") {
          // Bluetooth LE: Post-codec digital transmission with enhanced FEC (does not simulate codec processing)
          const audioBits = unitSamples * 16 * channelCount; // Compressed audio data bits after codec processing
          const isoHeader = 48; // ISO packet header (6 bytes)
          const le_audioHeader = 64; // LE Audio stack overhead (8 bytes)
          bitsPerUnit = audioBits + isoHeader + le_audioHeader; // FEC effect handled in probability calculation
        } else if (parameters.md === "10" || parameters.md === "10A") {
          // CD Audio: 588 ch-bits per EFM frame, accounting for CIRC processing
          bitsPerUnit = 588; // Channel bits per EFM frame
        }
        // --- Event Probability and Scheduling ---
        let pEventPerUnit = 0;
        if (parameters.md === "10" || parameters.md === "10A") {
          // CD Audio: Real CIRC simulation - process every EFM frame
          // Always process frames to simulate actual bit errors and Reed-Solomon correction
          pEventPerUnit = 1.0; // Process every EFM frame
        } else {
          const ber = Math.pow(10, parameters.be);
          if (ber > 0 && bitsPerUnit > 0) {
            // Calculate base error probability
            let effectiveBER = ber;
            
            // Apply FEC correction effect for Bluetooth transmission modes (post-codec)
            if (parameters.md === "6A") {
              // Bluetooth A2DP transmission: 2/3 FEC reduces effective BER by ~10x for moderate error rates
              effectiveBER = ber * 0.1;
            } else if (parameters.md === "6B") {
              // Bluetooth LE transmission: Enhanced FEC reduces effective BER by ~20x
              effectiveBER = ber * 0.05;
            }
            
            // Probability of at least one uncorrectable error in a unit of N bits
            let noErrorProbability = 1.0 - effectiveBER;
            if (noErrorProbability < 0) noErrorProbability = 0;
            pEventPerUnit = 1.0 - Math.pow(noErrorProbability, bitsPerUnit);
          }
        }
        // Clamp probability to prevent numerical instability with Math.log.
        if (pEventPerUnit < 0) {
          pEventPerUnit = 0;
        } else if (pEventPerUnit > 0.999999999999) {
          pEventPerUnit = 0.999999999999;
        }
        
        // Schedule the next error event if one is not already scheduled or active.
        if (context.nextEventTime < context.sampleCount && !context.errorState.active) {
          if (pEventPerUnit > 1e-12) {
            // Use numerically stable geometric distribution
            let randomU = Math.random(); // Avoid 0 and 1
            if (randomU < 1e-15) {
              randomU = 1e-15;
            } else if (randomU > 1 - 1e-15) {
              randomU = 1 - 1e-15;
            }
            const nextEventInUnits = Math.floor(Math.log1p(-randomU) / Math.log1p(-pEventPerUnit));
            const nextEventOffset = (nextEventInUnits > 0 ? nextEventInUnits : 0) * unitSamples;
            context.nextEventTime = context.sampleCount + nextEventOffset;
          } else {
            context.nextEventTime = Infinity; // Effectively no errors
          }
        }
        // --- Create Wet Signal Buffer ---
        const wetData = context.wetData;
        wetData.set(data);
        
        // --- Setup 1-sample delay for next sample reference (only for 10A mode) ---
        let delayedData = null;
        if (parameters.md === "10A") {
          // Initialize delay buffer if needed
          if (!context.delayBuffer || context.delayBuffer.length !== channelCount) {
            context.delayBuffer = new Array(channelCount)
              .fill(null).map(() => new Float32Array(1));
            context.delayBufferValid = false;
          }
          
          // Create delayed signal for interpolation
          if (!context.delayedData || context.delayedData.length !== dataLength) {
            context.delayedData = new Float32Array(dataLength);
          }
          delayedData = context.delayedData;
          delayedData.set(data);
          
          // Apply 1 sample delay using delay buffer
          for (let ch = 0; ch < channelCount; ch++) {
            const offset = ch * blockSize;
            if (context.delayBufferValid) {
              // First sample comes from delay buffer
              delayedData[offset] = context.delayBuffer[ch][0];
              // Remaining samples shift by 1
              for (let i = 1; i < blockSize; i++) {
                delayedData[offset + i] = data[offset + i - 1];
              }
            } else {
              // First run - copy as is
              for (let i = 0; i < blockSize; i++) {
                delayedData[offset + i] = data[offset + i];
              }
            }
            // Store last sample for next block
            context.delayBuffer[ch][0] = data[offset + blockSize - 1];
          }
          context.delayBufferValid = true;
        }
        
        // --- Main Processing Loop ---
        let i = 0;
        while (i < blockSize) {
          const currentGlobalSample = context.sampleCount + i;
          
          // --- Handle Ongoing Error State ---
          if (context.errorState.active) {
            const remainingBlockSamples = blockSize - i;
            const samplesToProcess = remainingBlockSamples < context.errorState.samplesRemaining
              ? remainingBlockSamples
              : context.errorState.samplesRemaining;
            // Mute modes are handled here. PLC modes with multi-block state are continued below.
            if (context.errorState.mode === '2B' || context.errorState.mode === '3B' || context.errorState.mode === '8' || context.errorState.mode === '9') {
              for (let j = 0; j < samplesToProcess; j++) {
                for (let ch = 0; ch < channelCount; ch++) {
                  wetData[ch * blockSize + i + j] = 0;
                }
              }
            } else if (context.errorState.mode === '6A' || context.errorState.mode === '6B') { // Bluetooth: Continue PLC over block boundaries
              const totalErrorDuration = context.errorState.totalDuration || unitSamples;
              const samplesProcessed = totalErrorDuration - context.errorState.samplesRemaining;
              const storedLastGoodSamples = context.errorState.lastGoodSamples || context.lastGoodSamples;
              const errorEndsInBlock = (i + samplesToProcess) < blockSize;

              for (let j = 0; j < samplesToProcess; j++) {
                const globalErrorProgress = samplesProcessed + j;
                const warblePhase = 2 * Math.PI * CONSTANTS.BLUETOOTH_WARBLE_HZ * (currentGlobalSample + j) / fs;
                for (let ch = 0; ch < channelCount; ch++) {
                  const offset = ch * blockSize;
                  const sampleIndex = i + j;
                  const lastGoodSample = storedLastGoodSamples[ch];
                  let concealedSample;

                  if (context.errorState.mode === '6A') {
                    const decay = Math.pow(CONSTANTS.BLUETOOTH_DECAY, globalErrorProgress);
                    const warble = Math.sin(warblePhase) * CONSTANTS.BLUETOOTH_WARBLE_AMP;
                    concealedSample = lastGoodSample * decay + warble;
                  } else {
                    const nextGoodSample = errorEndsInBlock ? data[offset + i + samplesToProcess] : lastGoodSample;
                    const alpha6B = (globalErrorProgress + 1) / (totalErrorDuration + 1);
                    concealedSample = lastGoodSample * (1 - alpha6B) + nextGoodSample * alpha6B;

                    // Post-codec transmission error characteristic: High-frequency attenuation during concealment
                    const hfRolloff = Math.exp(-globalErrorProgress * 0.1);
                    concealedSample *= hfRolloff;

                    // Add subtle pink noise artifact (digital transmission error characteristic)
                    const white6B = Math.random() - 0.5;
                    context.pinkNoiseState[ch] = (0.99765 * context.pinkNoiseState[ch]) + (white6B * 0.0990460);
                    concealedSample += context.pinkNoiseState[ch] * CONSTANTS.LC3_ARTIFACT_AMP * 0.5;
                    concealedSample = concealedSample * CONSTANTS.LC3_BLEND_FACTOR + lastGoodSample * (1 - CONSTANTS.LC3_BLEND_FACTOR);
                  }

                  if (concealedSample > 1.0) {
                    concealedSample = 1.0;
                  } else if (concealedSample < -1.0) {
                    concealedSample = -1.0;
                  }
                  wetData[offset + sampleIndex] = concealedSample;
                }
              }
            } else if (context.errorState.mode === '10' || context.errorState.mode === '10A') { // CD Audio: Continue concealment with real behavior
              const totalErrorDuration = context.errorState.totalDuration || unitSamples;
              const samplesProcessed = (totalErrorDuration - context.errorState.samplesRemaining);
              
              for (let j = 0; j < samplesToProcess; j++) {
                for (let ch = 0; ch < channelCount; ch++) {
                  const offset = ch * blockSize;
                  const sampleIndex = i + j;
                  const globalErrorProgress = samplesProcessed + j;
                  const lastGoodSample = context.lastGoodSamples[ch];
                  // For interpolation, use delayed data to get next sample (only for 10A mode)
                  let nextGoodSample;
                  if (context.errorState.mode === '10A' && context.delayBuffer) {
                    nextGoodSample = context.delayBuffer[ch][0];
                  } else {
                    // For mode 10 (standard CD), maintain original behavior
                    nextGoodSample = lastGoodSample; // Will be used in interpolation parts
                  }
                  
                  // Apply same concealment logic as in the main processing
                                      if (context.errorState.mode === '10A') {
                      // Enhanced CD Audio with improved interpolation
                      if (totalErrorDuration <= 10) {
                        const alpha = (globalErrorProgress + 1) / (totalErrorDuration + 1);
                        wetData[offset + sampleIndex] = lastGoodSample * (1 - alpha) + nextGoodSample * alpha;
                      } else if (totalErrorDuration <= 32) {
                        if (globalErrorProgress < totalErrorDuration * 0.5) {
                          const alpha = globalErrorProgress / (totalErrorDuration * 0.5);
                          const midValue = (lastGoodSample + nextGoodSample) * 0.5;
                          wetData[offset + sampleIndex] = lastGoodSample * (1 - alpha) + midValue * alpha;
                        } else {
                          const alpha = (globalErrorProgress - totalErrorDuration * 0.5) / (totalErrorDuration * 0.5);
                          const midValue = (lastGoodSample + nextGoodSample) * 0.5;
                          wetData[offset + sampleIndex] = midValue * (1 - alpha) + nextGoodSample * alpha;
                        }
                      } else if (totalErrorDuration <= 128) {
                        if (globalErrorProgress < 16) {
                          const alpha = globalErrorProgress / 16;
                          const targetValue = (lastGoodSample + nextGoodSample) * 0.5;
                          wetData[offset + sampleIndex] = lastGoodSample * (1 - alpha) + targetValue * alpha;
                        } else if (globalErrorProgress > totalErrorDuration - 16) {
                          const alpha = (globalErrorProgress - (totalErrorDuration - 16)) / 16;
                          const targetValue = (lastGoodSample + nextGoodSample) * 0.5;
                          wetData[offset + sampleIndex] = targetValue * (1 - alpha) + nextGoodSample * alpha;
                        } else {
                          const midValue = (lastGoodSample + nextGoodSample) * 0.5;
                          const fadeFactor = Math.pow(0.995, (globalErrorProgress - 16) * 20 / (totalErrorDuration - 32));
                          wetData[offset + sampleIndex] = midValue * fadeFactor;
                        }
                      } else {
                        if (globalErrorProgress < 16) {
                          const emergency_fade = Math.pow(0.7, globalErrorProgress);
                          wetData[offset + sampleIndex] = lastGoodSample * emergency_fade;
                        } else {
                          wetData[offset + sampleIndex] = 0;
                        }
                      }
                    } else {
                    // Standard CD Audio processing
                                          if (totalErrorDuration <= 2) {
                        const alpha = (globalErrorProgress + 1) / (totalErrorDuration + 1);
                        wetData[offset + sampleIndex] = lastGoodSample * (1 - alpha) + nextGoodSample * alpha;
                    } else if (totalErrorDuration <= 10) {
                      const decay = Math.pow(0.996, globalErrorProgress);
                      wetData[offset + sampleIndex] = lastGoodSample * decay;
                    } else if (totalErrorDuration <= 32) {
                      if (globalErrorProgress < totalErrorDuration * 0.3) {
                        const decay = Math.pow(0.992, globalErrorProgress);
                        wetData[offset + sampleIndex] = lastGoodSample * decay;
                      } else if (globalErrorProgress > totalErrorDuration * 0.7) {
                        const interpStart = Math.floor(totalErrorDuration * 0.7);
                        const interpProgress = (globalErrorProgress - interpStart) / (totalErrorDuration - interpStart);
                        const heldValue = lastGoodSample * Math.pow(0.992, interpStart);
                        wetData[offset + sampleIndex] = heldValue * (1 - interpProgress) + nextGoodSample * interpProgress;
                      } else {
                        const baseDecay = Math.pow(0.992, globalErrorProgress);
                        const jitter = (Math.random() - 0.5) * 0.02;
                        wetData[offset + sampleIndex] = lastGoodSample * baseDecay * (1 + jitter);
                      }
                    } else if (totalErrorDuration <= 128) {
                      if (globalErrorProgress < 8) {
                        const fastDecay = Math.pow(0.85, globalErrorProgress);
                        wetData[offset + sampleIndex] = lastGoodSample * fastDecay;
                      } else {
                        const residualNoise = (Math.random() - 0.5) * 0.001 * Math.pow(0.95, globalErrorProgress - 8);
                        wetData[offset + sampleIndex] = residualNoise;
                      }
                    } else {
                      if (globalErrorProgress < 16) {
                        const emergency_fade = Math.pow(0.7, globalErrorProgress);
                        wetData[offset + sampleIndex] = lastGoodSample * emergency_fade;
                      } else {
                        wetData[offset + sampleIndex] = 0;
                      }
                    }
                  }
                }
              }
            }
            
            context.errorState.samplesRemaining -= samplesToProcess;
            if (context.errorState.samplesRemaining <= 0) {
              context.errorState.active = false;
              context.nextEventTime = -1; // Force reschedule for next event after error ends
            }
            i += samplesToProcess;
            continue; // Continue to the next part of the block
          }
          // --- Check for and Trigger New Error Event ---
          if (currentGlobalSample >= context.nextEventTime) {
            const eventStart = i;
            
            // Determine the length of this error event in samples
            let errorDurationSamples = unitSamples;
            if (parameters.md === "9") { // RF Squelch has variable length
              const squelchMs = CONSTANTS.RF_SQUELCH_MIN_MS + Math.random() * (CONSTANTS.RF_SQUELCH_MAX_MS - CONSTANTS.RF_SQUELCH_MIN_MS);
              errorDurationSamples = Math.round(squelchMs * fs / 1000);
              
            } else if (parameters.md === "10" || parameters.md === "10A") { // CD Audio: Faithful CIRC simulation per EFM frame
              // Real CD CIRC parameters - based on actual hardware implementation
              const ber = Math.pow(10, parameters.be);
              const efmFrameBits = 588; // One EFM frame = 588 channel bits
              
              // EFM demodulation: Convert 588 channel bits to 192 data bits (24 symbols × 8 bits)
              // EFM has 8-to-14 encoding, so 588 bits ÷ 14 × 8 = ~336 data bits, but accounting for sync/subcode
              const dataSymbolsPerFrame = 24; // 24 symbols of audio data per EFM frame
              const bitsPerSymbol = 8;
              
              // Step 1: Generate channel bit errors based on BER (efficient binomial sampling)
              let channelBitErrors = 0;
              const expectedChannelErrors = efmFrameBits * ber;
              if (expectedChannelErrors < 0.1) {
                // Very low error rate: use direct probability
                channelBitErrors = Math.random() < expectedChannelErrors ? 1 : 0;
              } else if (expectedChannelErrors < 10) {
                // Low error rate: use Poisson approximation (Knuth's algorithm)
                let product = Math.random();
                const threshold = Math.exp(-expectedChannelErrors);
                while (product > threshold) {
                  channelBitErrors++;
                  product *= Math.random();
                }
              } else {
                // High error rate: use normal approximation
                const variance = efmFrameBits * ber * (1 - ber);
                const u1 = Math.random();
                const u2 = Math.random();
                const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
                channelBitErrors = Math.round(expectedChannelErrors + Math.sqrt(variance) * standardNormal);
                if (channelBitErrors < 0) channelBitErrors = 0;
              }
              
              // Step 2: EFM demodulation errors (efficient binomial sampling)  
              let efmDemodErrors = 0;
              if (channelBitErrors > 0) {
                const efmDemodProb = 0.3;
                if (channelBitErrors <= 10) {
                  // Small n: direct sampling
                  for (let i = 0; i < channelBitErrors; i++) {
                    if (Math.random() < efmDemodProb) {
                      efmDemodErrors++;
                    }
                  }
                } else {
                  // Large n: normal approximation
                  const expectedEfmErrors = channelBitErrors * efmDemodProb;
                  const variance = channelBitErrors * efmDemodProb * (1 - efmDemodProb);
                  const u1 = Math.random();
                  const u2 = Math.random();
                  const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
                  efmDemodErrors = Math.round(expectedEfmErrors + Math.sqrt(variance) * standardNormal);
                  if (efmDemodErrors < 0) efmDemodErrors = 0;
                }
              }
              
              // Step 3: Additional data bit errors (efficient binomial sampling)
              let dataBitErrors = 0;
              const dataBits = dataSymbolsPerFrame * bitsPerSymbol;
              const dataErrorProb = ber * 0.1;
              const expectedDataErrors = dataBits * dataErrorProb;
              if (expectedDataErrors < 0.1) {
                // Very low error rate: use direct probability
                dataBitErrors = Math.random() < expectedDataErrors ? 1 : 0;
              } else if (expectedDataErrors < 10) {
                // Low error rate: use Poisson approximation
                let product = Math.random();
                const threshold = Math.exp(-expectedDataErrors);
                while (product > threshold) {
                  dataBitErrors++;
                  product *= Math.random();
                }
              } else {
                // High error rate: use normal approximation
                const variance = dataBits * dataErrorProb * (1 - dataErrorProb);
                const u1 = Math.random();
                const u2 = Math.random();
                const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
                dataBitErrors = Math.round(expectedDataErrors + Math.sqrt(variance) * standardNormal);
                if (dataBitErrors < 0) dataBitErrors = 0;
              }
              
              // Step 4: Convert bit errors to symbol errors (real CD behavior)
              const symbolErrorFlags = context.symbolErrorFlags;
              symbolErrorFlags.fill(0);
              let totalSymbolErrors = 0;
              
              // EFM demodulation errors directly create symbol errors
              for (let i = 0; i < efmDemodErrors; i++) {
                const symbolPos = Math.floor(Math.random() * dataSymbolsPerFrame);
                if (symbolErrorFlags[symbolPos] === 0) {
                  symbolErrorFlags[symbolPos] = 1;
                  totalSymbolErrors++;
                }
              }
              
              // Data bit errors create symbol errors
              for (let i = 0; i < dataBitErrors; i++) {
                const symbolPos = Math.floor(Math.random() * dataSymbolsPerFrame);
                if (symbolErrorFlags[symbolPos] === 0) {
                  symbolErrorFlags[symbolPos] = 1;
                  totalSymbolErrors++;
                }
              }
              
              // Step 5: Realistic CIRC correction simulation (C1 decoder)
              // Real C1: RS(32,28) with t=2 correction capability, but organized in specific pattern
              // In practice, burst errors and cross-interleaving make correction less effective
              let c1FailedSymbols = 0;
              
              if (totalSymbolErrors === 0) {
                c1FailedSymbols = 0;
              } else if (totalSymbolErrors <= 1) {
                // Single symbol error: 98% correction success
                c1FailedSymbols = (Math.random() < 0.02) ? 1 : 0;
              } else if (totalSymbolErrors === 2) {
                // Two symbol errors: 85% correction success (less than theoretical due to real-world factors)
                c1FailedSymbols = (Math.random() < 0.15) ? totalSymbolErrors : 0;
              } else if (totalSymbolErrors <= 4) {
                // 3-4 errors: C1 can detect but not correct, some errors may be corrected by chance
                c1FailedSymbols = Math.floor(totalSymbolErrors * (0.7 + Math.random() * 0.3));
              } else {
                // 5+ errors: C1 correction completely fails, may even introduce more errors
                c1FailedSymbols = Math.floor(totalSymbolErrors * (1.1 + Math.random() * 0.2));
                if (c1FailedSymbols > dataSymbolsPerFrame) c1FailedSymbols = dataSymbolsPerFrame;
              }
              
              // Step 6: C2 correction simulation
              // Real CD player cross-interleaving distributes errors across time
              // C2 operates on columns after delay/deinterleaving
              let c2FailedSymbols = 0;
              
              if (c1FailedSymbols === 0) {
                c2FailedSymbols = 0;
              } else if (c1FailedSymbols <= 2) {
                // C2 can usually handle what C1 missed
                c2FailedSymbols = (Math.random() < 0.05) ? 1 : 0;
              } else if (c1FailedSymbols <= 4) {
                // C2 struggles with multiple errors from C1
                c2FailedSymbols = Math.floor(c1FailedSymbols * (0.3 + Math.random() * 0.4));
              } else {
                // C2 overwhelmed, most errors pass through
                c2FailedSymbols = Math.floor(c1FailedSymbols * (0.8 + Math.random() * 0.2));
              }
              
              // Step 7: Determine audio concealment based on uncorrectable errors
              if (c2FailedSymbols === 0) {
                // Perfect correction
                errorDurationSamples = 0;
              } else {
                // Real CD player concealment behavior
                if (c2FailedSymbols === 1) {
                  // Single symbol error: 1-2 sample interpolation
                  errorDurationSamples = 1 + Math.floor(Math.random() * 2);
                } else if (c2FailedSymbols <= 3) {
                  // Few symbol errors: Short interpolation/hold
                  errorDurationSamples = 2 + Math.floor(Math.random() * 8);
                } else if (c2FailedSymbols <= 6) {
                  // Multiple symbol errors: Longer concealment
                  errorDurationSamples = 8 + Math.floor(Math.random() * 24);
                } else if (c2FailedSymbols <= 12) {
                  // Many symbol errors: Noticeable dropout
                  errorDurationSamples = 32 + Math.floor(Math.random() * 96);
                } else {
                  // Severe symbol errors: Long mute/skip
                  errorDurationSamples = 128 + Math.floor(Math.random() * 256);
                }
                
                // Scale to current sample rate (base calculation is for 44.1kHz)
                errorDurationSamples = Math.round(errorDurationSamples * fs / 44100);
                if (errorDurationSamples < 1) errorDurationSamples = 1;
                
                // Add realistic random variation to mimic real CD player behavior
                const variation = 0.8 + Math.random() * 0.4; // ±20% variation
                errorDurationSamples = Math.round(errorDurationSamples * variation);
                if (errorDurationSamples < 1) errorDurationSamples = 1;
              }
            }
            
            // Skip processing if no audible error (all corrected or no packet loss)
            if (errorDurationSamples === 0) {
              context.nextEventTime = -1; // Force reschedule for next frame
              i++;
              continue;
            }
            
            const blockRemaining = blockSize - eventStart;
            const samplesInBlock = blockRemaining < errorDurationSamples ? blockRemaining : errorDurationSamples;
            const errorLastGoodSamples = context.errorLastGoodSamples;
            // --- PLC Pre-computation ---
            // Capture previous good samples right before the error happens.
            for (let ch = 0; ch < channelCount; ch++) {
              const offset = ch * blockSize;
              errorLastGoodSamples[ch] = eventStart > 0 ? wetData[offset + eventStart - 1] : context.lastGoodSamples[ch];
              const historyToCopy = eventStart < unitSamples ? eventStart : unitSamples;
              if (historyToCopy > 0) {
                const sourceStart = eventStart - historyToCopy;
                // Use original data (not wetData) to avoid cascading corruption
                const plcBuffer = context.plcBuffer[ch];
                const destStart = unitSamples - historyToCopy;
                for (let h = 0; h < historyToCopy; h++) {
                  plcBuffer[destStart + h] = data[offset + sourceStart + h];
                }
              }
            }
            // --- Apply Error Based on Mode ---
            // Some modes affect channels independently, others affect all channels simultaneously
            const isChannelIndependent = (parameters.md === "1"); // Only AES3/S-PDIF has independent channel errors
            
            if (isChannelIndependent) {
              // Channel-independent processing (only Mode 1)
              for (let ch = 0; ch < channelCount; ch++) {
                const offset = ch * blockSize;
                const lastGoodSample = errorLastGoodSamples[ch];
                
                for (let j = 0; j < samplesInBlock; j++) {
                  const sampleIndex = eventStart + j;
                  
                  // AES3/S-PDIF: Real hardware behavior simulation
                  // Mode 1 always has errorDurationSamples = 1 (single sample errors only)
                  // Parity error detected - apply Sample & Hold concealment
                  wetData[offset + sampleIndex] = lastGoodSample;
                }
              }
            } else {
              // Channel-correlated processing (all other modes)
              // Pre-generate shared randomness for correlated errors
              const sharedErrorProbability3A = context.sharedErrorProbability3A;
              const sharedBitPosition3A = context.sharedBitPosition3A;
              const sharedWarblePhase = context.sharedWarblePhase;
              for (let j = 0; j < samplesInBlock; j++) {
                sharedErrorProbability3A[j] = Math.random();
                sharedBitPosition3A[j] = Math.floor(Math.random() * 24);
                sharedWarblePhase[j] = 2 * Math.PI * CONSTANTS.BLUETOOTH_WARBLE_HZ * (currentGlobalSample + j) / fs;
              }
              
              for (let ch = 0; ch < channelCount; ch++) {
                const offset = ch * blockSize;
                const plcBuffer = context.plcBuffer[ch];
                
                const lastGoodSample = errorLastGoodSamples[ch];
                const errorEndsInBlock = (eventStart + errorDurationSamples) < blockSize;
                let nextGoodSample;
                if (parameters.md === "10A" && delayedData && context.delayBuffer) {
                  // For 10A mode, use delayed data for interpolation
                  nextGoodSample = errorEndsInBlock ? 
                    delayedData[offset + eventStart + errorDurationSamples] : 
                    context.delayBuffer[ch][0]; // Use delay buffer for next block's first sample
                } else {
                  // For other modes, use original data
                  nextGoodSample = errorEndsInBlock ? 
                    data[offset + eventStart + errorDurationSamples] : 
                    lastGoodSample; // Fallback to last good sample
                }
                for (let j = 0; j < samplesInBlock; j++) {
                  const sampleIndex = eventStart + j;
                  
                  switch (parameters.md) {
                    case "2A": // ADAT/TDIF/MADI: Hold last good block
                      wetData[offset + sampleIndex] = plcBuffer[(unitSamples - errorDurationSamples + j) % unitSamples];
                      break;
                    case "2B": // ADAT/TDIF/MADI: Mute
                      wetData[offset + sampleIndex] = 0;
                      break;
                    case "3A": // HDMI/DP (CRC Pass): Bit corruption in audio row
                      const originalSample3A = wetData[offset + sampleIndex];
                      let sampleInt3A = Math.round(originalSample3A * 8388607);
                      if (sampleInt3A > 8388607) {
                        sampleInt3A = 8388607;
                      } else if (sampleInt3A < -8388608) {
                        sampleInt3A = -8388608;
                      }
                      
                      // Use shared randomness so all channels get the same error pattern
                      const errorProbabilityPerSample = 2.0 / unitSamples;
                      if (sharedErrorProbability3A[j] < errorProbabilityPerSample) {
                        sampleInt3A ^= (1 << sharedBitPosition3A[j]);
                      }
                      
                      let sample3A = sampleInt3A / 8388607;
                      if (sample3A > 1.0) {
                        sample3A = 1.0;
                      } else if (sample3A < -1.0) {
                        sample3A = -1.0;
                      }
                      wetData[offset + sampleIndex] = sample3A;
                      break;
                    case "3B": // HDMI/DP (CRC Fail): Mute
                    case "8":  // WiSA: Mute
                    case "9":  // RF Squelch: Mute
                      wetData[offset + sampleIndex] = 0;
                      break;
                    case "4": // USB/1394/TB: Linear Interpolation PLC
                      const alpha = (j + 1) / (errorDurationSamples + 1);
                      let concealedSample = lastGoodSample * (1 - alpha) + nextGoodSample * alpha;
                      wetData[offset + sampleIndex] = concealedSample;
                      break;
                    case "5A": // Dante/AES67/AVB: Packet Repeat PLC with fade (64 samp)
                    case "5B": // Dante/AES67/AVB: Packet Repeat PLC with fade (128 samp)
                    case "5C": // Dante/AES67/AVB: Packet Repeat PLC with fade (256 samp)
                      let lambda = (j / unitSamples) * 2;
                      if (lambda > 1.0) lambda = 1.0;
                      wetData[offset + sampleIndex] = plcBuffer[(unitSamples - errorDurationSamples + j) % unitSamples] * (1 - lambda);
                      break;
                    case "6A": // Bluetooth A2DP transmission: Sample Repeat + Warble PLC (post-codec error concealment)
                      const decay = Math.pow(CONSTANTS.BLUETOOTH_DECAY, j);
                      const warble = Math.sin(sharedWarblePhase[j]) * CONSTANTS.BLUETOOTH_WARBLE_AMP;
                      wetData[offset + sampleIndex] = lastGoodSample * decay + warble;
                      break;
                    case "6B": // Bluetooth LE transmission: Enhanced PLC with adaptive concealment (post-codec error concealment)
                      const alpha6B = (j + 1) / (errorDurationSamples + 1);
                      let concealedSample6B = lastGoodSample * (1 - alpha6B) + nextGoodSample * alpha6B;
                      
                      // Post-codec transmission error characteristic: High-frequency attenuation during concealment
                      const hfRolloff = Math.exp(-j * 0.1); // Gradual HF rolloff
                      concealedSample6B *= hfRolloff;
                      
                      // Add subtle pink noise artifact (digital transmission error characteristic)
                      const white6B = Math.random() - 0.5;
                      context.pinkNoiseState[ch] = (0.99765 * context.pinkNoiseState[ch]) + (white6B * 0.0990460);
                      concealedSample6B += context.pinkNoiseState[ch] * CONSTANTS.LC3_ARTIFACT_AMP * 0.5;
                      concealedSample6B = concealedSample6B * CONSTANTS.LC3_BLEND_FACTOR + lastGoodSample * (1 - CONSTANTS.LC3_BLEND_FACTOR);
                      
                      wetData[offset + sampleIndex] = concealedSample6B;
                      break;
                    case "10": // CD Audio: Real hardware concealment behavior
                      // Real CD players use different concealment strategies based on error severity
                      const errorProgress = j / errorDurationSamples;
                      
                      if (errorDurationSamples <= 2) {
                        // 1-2 samples: Linear interpolation (perfect on good players)
                        const alpha = (j + 1) / (errorDurationSamples + 1);
                        wetData[offset + sampleIndex] = lastGoodSample * (1 - alpha) + nextGoodSample * alpha;
                      } else if (errorDurationSamples <= 10) {
                        // 3-10 samples: Previous sample hold with slight decay (common concealment)
                        const decay = Math.pow(0.996, j); // Slight decay to avoid DC buildup
                        wetData[offset + sampleIndex] = lastGoodSample * decay;
                      } else if (errorDurationSamples <= 32) {
                        // 11-32 samples: Mixed hold/interpolation with audible artifacts
                        if (j < errorDurationSamples * 0.3) {
                          // Hold phase
                          const decay = Math.pow(0.992, j);
                          wetData[offset + sampleIndex] = lastGoodSample * decay;
                        } else if (j > errorDurationSamples * 0.7) {
                          // Interpolation phase toward next sample
                          const interpStart = Math.floor(errorDurationSamples * 0.7);
                          const interpProgress = (j - interpStart) / (errorDurationSamples - interpStart);
                          const heldValue = lastGoodSample * Math.pow(0.992, interpStart);
                          wetData[offset + sampleIndex] = heldValue * (1 - interpProgress) + nextGoodSample * interpProgress;
                        } else {
                          // Transition phase with slight randomness (mimics real hardware jitter)
                          const baseDecay = Math.pow(0.992, j);
                          const jitter = (Math.random() - 0.5) * 0.02; // Small amplitude jitter
                          wetData[offset + sampleIndex] = lastGoodSample * baseDecay * (1 + jitter);
                        }
                      } else if (errorDurationSamples <= 128) {
                        // 33-128 samples: Noticeable dropout with fade-out (typical of real dropouts)
                        if (j < 8) {
                          // Initial hold with rapid fade
                          const fastDecay = Math.pow(0.85, j);
                          wetData[offset + sampleIndex] = lastGoodSample * fastDecay;
                        } else {
                          // Mute with occasional low-level noise (mimics real CD player behavior)
                          const residualNoise = (Math.random() - 0.5) * 0.001 * Math.pow(0.95, j - 8);
                          wetData[offset + sampleIndex] = residualNoise;
                        }
                      } else {
                        // 128+ samples: Long dropout/mute (severe errors, player may seek/retry)
                        if (j < 16) {
                          // Very brief fade-out
                          const emergency_fade = Math.pow(0.7, j);
                          wetData[offset + sampleIndex] = lastGoodSample * emergency_fade;
                        } else {
                          // Complete mute (player internal muting circuit activates)
                          wetData[offset + sampleIndex] = 0;
                        }
                      }
                      break;
                    case "10A": // CD Audio: Enhanced concealment with improved interpolation
                      // Enhanced CD players use linear interpolation for all short errors
                      if (errorDurationSamples <= 10) {
                        // 1-10 samples: Linear interpolation for improved quality
                        const alpha = (j + 1) / (errorDurationSamples + 1);
                        wetData[offset + sampleIndex] = lastGoodSample * (1 - alpha) + nextGoodSample * alpha;
                      } else if (errorDurationSamples <= 32) {
                        // 11-32 samples: Mixed linear interpolation with reduced artifacts
                        if (j < errorDurationSamples * 0.5) {
                          // First half: Linear interpolation to midpoint
                          const alpha = j / (errorDurationSamples * 0.5);
                          const midValue = (lastGoodSample + nextGoodSample) * 0.5;
                          wetData[offset + sampleIndex] = lastGoodSample * (1 - alpha) + midValue * alpha;
                        } else {
                          // Second half: Linear interpolation from midpoint to next
                          const alpha = (j - errorDurationSamples * 0.5) / (errorDurationSamples * 0.5);
                          const midValue = (lastGoodSample + nextGoodSample) * 0.5;
                          wetData[offset + sampleIndex] = midValue * (1 - alpha) + nextGoodSample * alpha;
                        }
                      } else if (errorDurationSamples <= 128) {
                        // 33-128 samples: Interpolation with gradual fade
                        if (j < 16) {
                          // Initial interpolation phase
                          const alpha = j / 16;
                          const targetValue = (lastGoodSample + nextGoodSample) * 0.5;
                          wetData[offset + sampleIndex] = lastGoodSample * (1 - alpha) + targetValue * alpha;
                        } else if (j > errorDurationSamples - 16) {
                          // Final interpolation phase
                          const alpha = (j - (errorDurationSamples - 16)) / 16;
                          const targetValue = (lastGoodSample + nextGoodSample) * 0.5;
                          wetData[offset + sampleIndex] = targetValue * (1 - alpha) + nextGoodSample * alpha;
                        } else {
                          // Middle phase: Hold interpolated value with gentle fade
                          const midValue = (lastGoodSample + nextGoodSample) * 0.5;
                          const fadeProgress = (j - 16) / (errorDurationSamples - 32);
                          const fadeFactor = Math.pow(0.995, fadeProgress * 20);
                          wetData[offset + sampleIndex] = midValue * fadeFactor;
                        }
                      } else {
                        // 128+ samples: Long dropout with fade-out (similar to standard mode)
                        if (j < 16) {
                          // Very brief fade-out
                          const emergency_fade = Math.pow(0.7, j);
                          wetData[offset + sampleIndex] = lastGoodSample * emergency_fade;
                        } else {
                          // Complete mute (player internal muting circuit activates)
                          wetData[offset + sampleIndex] = 0;
                        }
                      }
                      break;
                  }
                  // Clamp sample values to prevent overload
                  let clampedSample = wetData[offset + sampleIndex];
                  if (clampedSample > 1.0) {
                    clampedSample = 1.0;
                  } else if (clampedSample < -1.0) {
                    clampedSample = -1.0;
                  }
                  wetData[offset + sampleIndex] = clampedSample;
                }
              }
            }
            // --- Update State for Next Iteration ---
            const errorState = context.errorState;
            if (errorDurationSamples > samplesInBlock) {
              errorState.active = true;
              errorState.samplesRemaining = errorDurationSamples - samplesInBlock;
              errorState.mode = parameters.md;
              errorState.lastGoodSamples = errorLastGoodSamples;
              errorState.totalDuration = errorDurationSamples; // Store for CD concealment
            } else {
              errorState.active = false;
              errorState.samplesRemaining = 0;
              errorState.mode = null;
              errorState.lastGoodSamples = null;
              errorState.totalDuration = 0;
              // Error completed within this block, schedule next event
              context.nextEventTime = -1; // Force reschedule for the next event
            }
            i += samplesInBlock;
          } else {
            i++;
          }
        }
        
        // --- Post-processing and State Update ---
        context.sampleCount += blockSize;
        
        // Store the last processed samples for the next block's PLC
        for (let ch = 0; ch < channelCount; ch++) {
          context.lastGoodSamples[ch] = wetData[ch * blockSize + blockSize - 1];
        }
        // --- Apply Wet/Dry Mix ---
        for (let ch = 0; ch < channelCount; ch++) {
          const offset = ch * blockSize;
          for (let i = 0; i < blockSize; i++) {
            data[offset + i] = data[offset + i] * dryMix + wetData[offset + i] * wetMix;
          }
        }
        return data;
      `);
    }
    setParameters(params) {
      let needsUpdate = false;
      const parseNumber = (value) => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          const trimmedValue = value.trim();
          if (trimmedValue !== '') return Number(trimmedValue);
        }
        return NaN;
      };
      if (params.be !== undefined) {
        const value = parseNumber(params.be);
        if (Number.isFinite(value)) {
          const nextBe = value < -12 ? -12 : (value > -2 ? -2 : value);
          if (this.be !== nextBe) {
            this.be = nextBe;
            needsUpdate = true;
          }
        }
      }
      if (params.md !== undefined && this.md !== params.md) {
        const validModes = ["1", "2A", "2B", "3A", "3B", "4", "5A", "5B", "5C", "6A", "6B", "8", "9", "10", "10A"];
        if (validModes.includes(params.md)) {
          this.md = params.md;
          needsUpdate = true;
        }
      }
      if (params.rf !== undefined) {
        const value = parseNumber(params.rf);
        if (Number.isFinite(value) && this.REFERENCE_FS_KHZ_VALUES.includes(value) && this.rf !== value) {
          this.rf = value;
          needsUpdate = true;
        }
      }
      if (params.wt !== undefined) {
        const value = parseNumber(params.wt);
        if (Number.isFinite(value)) {
          const nextWt = value < 0 ? 0 : (value > 100 ? 100 : value);
          if (this.wt !== nextWt) {
            this.wt = nextWt;
            needsUpdate = true;
          }
        }
      }
      if (needsUpdate) {
        this.updateParameters();
      }
    }
    setBERExponent(value) { this.setParameters({ be: value }); }
    setMode(value) {
      this.setParameters({ md: value });
      this.updateModeControls();
    }
    setReferenceFsKHz(value) { this.setParameters({ rf: value }); }
    setWetMix(value) { this.setParameters({ wt: value }); }
    getParameters() {
      return {
        type: this.constructor.name,
        be: this.be, md: this.md, rf: this.rf,
        wt: this.wt,
        enabled: this.enabled
      };
    }
    
    // --- UI Methods ---
    createUI() {
      const container = document.createElement('div');
      container.className = 'digital-error-emulator-plugin-ui plugin-parameter-ui';
      
      // BER Exponent Control
      container.appendChild(this.createParameterControl(
        'Bit Error Rate', -12, -2, 0.2, this.be,
        (value) => this.setBERExponent(value), '10^x'
      ));
      
      // Mode Selection using select (display only technical names, hide internal mode strings)
      const modeRow = document.createElement('div');
      modeRow.className = 'parameter-row';
      const modeLabel = document.createElement('label');
      modeLabel.textContent = 'Mode:';
      const modeSelect = document.createElement('select');
      modeSelect.id = `${this.id}-${this.name}-mode`;
      modeSelect.name = `${this.id}-${this.name}-mode`;
      modeSelect.autocomplete = "off";
      modeLabel.htmlFor = modeSelect.id;
      
      const modeOrder = ["1", "2A", "2B", "3A", "3B", "4", "5A", "5B", "5C", "6A", "6B", "8", "9", "10", "10A"];
      modeOrder.forEach(modeId => {
        const option = document.createElement('option');
        option.value = modeId;
        // Display only the technical name without the internal mode identifier
        option.textContent = this.MODE_DEFINITIONS[modeId].name;
        if (modeId === this.md) option.selected = true;
        modeSelect.appendChild(option);
      });
      
      modeSelect.addEventListener('change', (e) => {
        this.setMode(e.target.value);
        this.updateModeControls();
      });
      modeRow.appendChild(modeLabel);
      modeRow.appendChild(modeSelect);
      container.appendChild(modeRow);
      
      // Reference Fs Control using radio buttons
      const refFsRow = document.createElement('div');
      refFsRow.className = 'parameter-row';
      
      const refFsLabel = document.createElement('label');
      refFsLabel.textContent = 'Fs (kHz):';
      
      const refFsRadioGroup = document.createElement('div');
      refFsRadioGroup.className = 'radio-group';
      
      this.REFERENCE_FS_KHZ_VALUES.forEach(fsValue => {
        const radioId = `${this.id}-${this.name}-fs-${fsValue}`;
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `${this.id}-${this.name}-fs`;
        radio.id = radioId;
        radio.value = fsValue;
        radio.checked = this.rf === fsValue;
        radio.autocomplete = "off";
        radio.addEventListener('change', () => this.setReferenceFsKHz(fsValue));
        
        const radioLabel = document.createElement('label');
        radioLabel.htmlFor = radioId;
        radioLabel.appendChild(radio);
        radioLabel.appendChild(document.createTextNode(`${fsValue}`));
        refFsRadioGroup.appendChild(radioLabel);
      });
      
      refFsRow.appendChild(refFsLabel);
      refFsRow.appendChild(refFsRadioGroup);
      container.appendChild(refFsRow);
      // Wet Mix
      container.appendChild(this.createParameterControl('Wet Mix', 0, 100, 1, this.wt, (val) => this.setWetMix(val), '%'));
      
      return container;
    }
    updateModeControls() {
      // No mode-specific UI controls needed anymore
    }
  }
  // Register the plugin
  window.DigitalErrorEmulatorPlugin = DigitalErrorEmulatorPlugin;
