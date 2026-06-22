class GatePlugin extends PluginBase {
    constructor() {
        super('Gate', 'Noise gate with threshold, ratio, and knee control');
        
        // Initialize parameters
        this.th = -40;  // Threshold (-96 to 0 dB)
        this.rt = 10;   // Ratio (1:1 to 100:1)
        this.at = 1;    // Attack Time (0.01 to 50 ms)
        this.rl = 200;  // Release Time (10 to 2000 ms)
        this.kn = 1;    // Knee (0 to 6 dB)
        this.gn = 0;    // Gain (-12 to +12 dB)
        this.gr = 0;    // Current gain reduction value
        this.lastProcessTime = performance.now() / 1000;
        this.animationFrameId = null;
        this._hasMessageHandler = false;
        this.isVisible = true;
        this.observer = null;

        this._setupMessageHandler();

        // Register processor with optimized block processing
        this.registerProcessor(this.getProcessorCode());
    }

    // Returns the processor code string with optimized block processing
    getProcessorCode() {
        // NOTE: This is the optimized version.
        // Original logic and input/output behavior are preserved,
        // except for potential minor differences due to floating-point arithmetic optimizations optimizations
        // (e.g., order of operations, avoiding redundant calculations)
        // and LUT approximations (which were already present in the original code).
    
        // Function body as a string
        return `
            // Use the input data directly
            const result = data;
    
            // --- Early exit if disabled ---
            if (!parameters.enabled) {
                // Attach empty measurements object if required by the interface, even when disabled
                // To match the original behavior strictly, only return result when disabled.
                // If measurements are expected even when disabled, uncomment the next line:
                // result.measurements = { time: parameters.time, gainReduction: 0 };
                return result;
            }
    
            // --- Constants ---
            const MIN_ENVELOPE = 1e-6;
            const MIN_DB = -96;
            // const MAX_DB = 0; // Not used in the processing loop
            const LOG2 = ${Math.log(2)}; // Embed constant value: 0.6931471805599453
            const LOG10_20 = ${20 / Math.log(10)}; // Embed constant value: 8.685889638065035
            const gainFactor = ${Math.log(10) / 20}; // Embed constant value: 0.11512925464970229
    
            // --- Context Initialization and Parameter Caching ---
            let needsRecalculation = false; // Flag to check if dependent params need update
    
            // Calculate attack and release coefficients if needed or if parameters changed
            if (!context.timeConstants ||
                context.lastAt !== parameters.at ||
                context.lastRl !== parameters.rl ||
                context.lastSampleRate !== parameters.sampleRate) {
    
                const sampleRateMs = parameters.sampleRate / 1000;
                // Ensure samples are at least 1 to avoid division by zero or NaN/Infinity coefficients
                const attackSamples = Math.max(1, parameters.at * sampleRateMs);
                const releaseSamples = Math.max(1, parameters.rl * sampleRateMs);
    
                // Standard coefficients for single-pole IIR filter (envelope follower)
                // alpha = exp(-log(2) / (time_constant_samples))
                const attackCoeff = Math.exp(-LOG2 / attackSamples);
                const releaseCoeff = Math.exp(-LOG2 / releaseSamples);
    
                context.timeConstants = {
                    attack: attackCoeff,
                    release: releaseCoeff,
                    // Precompute (1 - coeff) for the envelope calculation
                    oneMinusAttack: 1.0 - attackCoeff,
                    oneMinusRelease: 1.0 - releaseCoeff
                };
    
                // Store parameters for future comparison
                context.lastAt = parameters.at;
                context.lastRl = parameters.rl;
                context.lastSampleRate = parameters.sampleRate;
                needsRecalculation = true; // Indicate coefficients changed
            }
    
            // Cache frequently used time constants
            const attackCoeff = context.timeConstants.attack;
            const releaseCoeff = context.timeConstants.release;
            const oneMinusAttackCoeff = context.timeConstants.oneMinusAttack;
            const oneMinusReleaseCoeff = context.timeConstants.oneMinusRelease;
    
            // Precompute gate parameters if needed or if parameters changed
            if (!context.gateParams ||
                context.gateParams.th !== parameters.th ||
                context.gateParams.rt !== parameters.rt ||
                context.gateParams.kn !== parameters.kn ||
                context.gateParams.gn !== parameters.gn) {
    
                const threshold = parameters.th; // dB
                const ratio = parameters.rt;     // e.g., 2 for 2:1
                const knee = parameters.kn;      // dB
                const gain = parameters.gn;      // dB (Output Gain)
    
                const halfKnee = knee * 0.5;
                // Original code used rt - 1. This assumes rt is the ratio (>= 1).
                const invRatio = ratio - 1.0; // For ratio=1, invRatio=0.
    
                context.gateParams = {
                    th: threshold,
                    rt: ratio, // Store original ratio
                    kn: knee,
                    gn: gain,
                    halfKnee: halfKnee,
                    invRatio: invRatio,
                    kneeWidth: knee // Cache knee width for calculations
                };
    
                // Invalidate precomputed output gain factor as 'gn' might have changed
                context.precomputedOutputGainFactor = undefined; // Use undefined to signal invalidation
                needsRecalculation = true; // Indicate parameters changed
            }
    
            // Cache frequently used gate parameters
            const gateParams = context.gateParams;
            const threshold = gateParams.th;
            const halfKnee = gateParams.halfKnee;
            const invRatio = gateParams.invRatio; // Note: This is ratio - 1
            const gainParam = gateParams.gn;    // Gain parameter in dB
            const kneeWidth = gateParams.kn;    // Cached knee width
    
            // Initialize envelope state per channel if not already set or channel count changed
            // Check channelCount directly as it's the dependency
            if (!context.envelopeStates || context.envelopeStates.length !== parameters.channelCount) {
                context.envelopeStates = new Float32Array(parameters.channelCount).fill(MIN_ENVELOPE);
                // No need to set needsRecalculation here, state init doesn't affect other params
            }
    
            // --- Lookup Table Initialization (if not present) ---
            // This part remains the same as it's initialization logic
            if (!context.dbLookup) {
                const DB_LOOKUP_SIZE = 4096;
                // The original code scaled for a 0-10 range. Assuming envelope values can exceed 1.
                const DB_LOOKUP_SCALE = DB_LOOKUP_SIZE / 10.0;
                context.dbLookup = new Float32Array(DB_LOOKUP_SIZE);
                for (let i = 0; i < DB_LOOKUP_SIZE; i++) {
                    const x = i / DB_LOOKUP_SCALE;
                    // Use a small epsilon consistent with MIN_ENVELOPE to avoid log(0)
                    context.dbLookup[i] = (x < MIN_ENVELOPE) ? MIN_DB : LOG10_20 * Math.log(x);
                }
    
                const EXP_LOOKUP_SIZE = 2048;
                // Range 0 to 60 dB for gain reduction seems reasonable
                const EXP_LOOKUP_SCALE = EXP_LOOKUP_SIZE / 60.0;
                context.expLookup = new Float32Array(EXP_LOOKUP_SIZE);
                for (let i = 0; i < EXP_LOOKUP_SIZE; i++) {
                    const x_db = i / EXP_LOOKUP_SCALE;
                    // Corresponds to original fastExp(x_db) calculation: exp(-x_db * gainFactor)
                    context.expLookup[i] = Math.exp(-x_db * gainFactor);
                }
    
                // Store constants for faster access inside inlined functions
                context.DB_LOOKUP_SIZE = DB_LOOKUP_SIZE;
                context.DB_LOOKUP_SCALE = DB_LOOKUP_SCALE;
                context.EXP_LOOKUP_SIZE = EXP_LOOKUP_SIZE;
                context.EXP_LOOKUP_SCALE = EXP_LOOKUP_SCALE;
                context.MIN_DB = MIN_DB; // Cache MIN_DB for inlined fastDb
                // No need to set needsRecalculation here, LUT init is one-time
            }
    
            // Cache LUTs and related constants for direct access
            const dbLookup = context.dbLookup;
            const dbLookupSize = context.DB_LOOKUP_SIZE;
            const dbLookupScale = context.DB_LOOKUP_SCALE;
            const expLookup = context.expLookup;
            const expLookupSize = context.EXP_LOOKUP_SIZE;
            const expLookupScale = context.EXP_LOOKUP_SCALE;
            const lutMinDb = context.MIN_DB;
            const lutExpMaxIndex = expLookupSize - 1;
            const lutDbMaxIndex = dbLookupSize - 1;
    
            // Precompute output gain independently from gate reduction.
            let outputGainFactor;
            if (context.precomputedOutputGainFactor === undefined) { // Check if invalidated
                outputGainFactor = Math.exp(gainParam * gainFactor);
                context.precomputedOutputGainFactor = outputGainFactor; // Cache the computed value
                // context.lastGn is implicitly tracked by gateParams check above
            }
            outputGainFactor = context.precomputedOutputGainFactor; // Use the precomputed/cached value
    
            // --- Main Processing Loop ---
            let blockMaxGainReduction = 0; // Track max GR for measurements
            const blockSize = parameters.blockSize;
            const channelCount = parameters.channelCount;
            const envelopeStates = context.envelopeStates; // Get reference to the array
    
            for (let ch = 0; ch < channelCount; ch++) {
                const offset = ch * blockSize;
                let envelope = envelopeStates[ch]; // Get current envelope state for the channel
    
                // --- Combined Envelope Calculation and Gain Application Pass ---
                // Loop unrolling preparation
                const blockSizeMod4 = blockSize - (blockSize % 4); // Process chunks of 4
                let i = 0;
    
                // Unrolled loop (4 samples at a time) - improves performance in some JS engines
                for (; i < blockSizeMod4; i += 4) {
                    // --- Process 4 samples ---
    
                    // Sample 1 (index i)
                    let val1 = data[offset + i];
                    let inputAbs1 = val1 >= 0 ? val1 : -val1;
                    let coeff1 = (inputAbs1 > envelope) ? attackCoeff : releaseCoeff;
                    let oneMinusCoeff1 = (inputAbs1 > envelope) ? oneMinusAttackCoeff : oneMinusReleaseCoeff;
                    envelope = envelope * coeff1 + inputAbs1 * oneMinusCoeff1;
                    if (envelope < MIN_ENVELOPE) envelope = MIN_ENVELOPE; // Clamp envelope floor
                    let currentEnvelope1 = envelope; // Store envelope for this sample's calculation
    
                    // Sample 2 (index i+1) - Calculate envelope sequentially
                    let val2 = data[offset + i + 1];
                    let inputAbs2 = val2 >= 0 ? val2 : -val2;
                    let coeff2 = (inputAbs2 > envelope) ? attackCoeff : releaseCoeff;
                    let oneMinusCoeff2 = (inputAbs2 > envelope) ? oneMinusAttackCoeff : oneMinusReleaseCoeff;
                    envelope = envelope * coeff2 + inputAbs2 * oneMinusCoeff2;
                    if (envelope < MIN_ENVELOPE) envelope = MIN_ENVELOPE;
                    let currentEnvelope2 = envelope;
    
                    // Sample 3 (index i+2)
                    let val3 = data[offset + i + 2];
                    let inputAbs3 = val3 >= 0 ? val3 : -val3;
                    let coeff3 = (inputAbs3 > envelope) ? attackCoeff : releaseCoeff;
                    let oneMinusCoeff3 = (inputAbs3 > envelope) ? oneMinusAttackCoeff : oneMinusReleaseCoeff;
                    envelope = envelope * coeff3 + inputAbs3 * oneMinusCoeff3;
                    if (envelope < MIN_ENVELOPE) envelope = MIN_ENVELOPE;
                    let currentEnvelope3 = envelope;
    
                    // Sample 4 (index i+3)
                    let val4 = data[offset + i + 3];
                    let inputAbs4 = val4 >= 0 ? val4 : -val4;
                    let coeff4 = (inputAbs4 > envelope) ? attackCoeff : releaseCoeff;
                    let oneMinusCoeff4 = (inputAbs4 > envelope) ? oneMinusAttackCoeff : oneMinusReleaseCoeff;
                    envelope = envelope * coeff4 + inputAbs4 * oneMinusCoeff4;
                    if (envelope < MIN_ENVELOPE) envelope = MIN_ENVELOPE;
                    let currentEnvelope4 = envelope;
    
                    // --- Apply Gain Reduction for the 4 samples ---
                    // We use the calculated envelope value *for each sample* respectively
    
                    // Gain Calc Sample 1
                    // --- Inlined fastDb(currentEnvelope1) ---
                    let envelopeDb1;
                    if (currentEnvelope1 < MIN_ENVELOPE) { envelopeDb1 = lutMinDb; } // Use MIN_ENVELOPE consistently
                    else {
                        const db_idx_f1 = currentEnvelope1 * dbLookupScale;
                        const db_idx1_floor = Math.floor(db_idx_f1);
                        // Replace Math.max/min with if/ternary for better performance
                        const db_idx1 = db_idx1_floor < 0 ? 0 : (db_idx1_floor > lutDbMaxIndex ? lutDbMaxIndex : db_idx1_floor); // Clamp index
                        envelopeDb1 = dbLookup[db_idx1];
                    }
                    // --- End Inlined fastDb ---
                    let diff1 = threshold - envelopeDb1;
                    let gainReduction1 = 0;
                    // Calculate gain reduction only if ratio > 1 and input is above lower knee boundary
                    if (invRatio > 1e-9 && diff1 > -halfKnee) { // Use epsilon for float comparison, invRatio > 0 means ratio > 1
                        if (diff1 >= halfKnee) { // Above knee: Hard knee characteristic
                            gainReduction1 = diff1 * invRatio;
                        } else { // In knee: Soft knee characteristic
                            // Avoid division by zero/small kneeWidth
                            if (kneeWidth > 1e-9) {
                               const kneeFactor1 = (diff1 + halfKnee) / kneeWidth; // Position within the knee (0 to 1)
                               // Original formula structure: GR = invRatio * kneeWidth * 0.5 * kneeFactor^2
                               // Ensure factor is non-negative before squaring (should be due to diff > -halfKnee)
                               gainReduction1 = 0.5 * invRatio * kneeWidth * kneeFactor1 * kneeFactor1;
                            } // Else: kneeWidth is near zero, effectively hard knee (handled by diff >= halfKnee)
                        }
                        // Ensure gain reduction is not negative (can happen with numerical instability)
                        if (gainReduction1 < 0) gainReduction1 = 0;
                    }
                    if (gainReduction1 > blockMaxGainReduction) blockMaxGainReduction = gainReduction1;
                    let totalGainLin1 = outputGainFactor;
                    if (gainReduction1 > 1e-9) { // Apply reduction only if it is significant
                        // --- Inlined fastExp(gainReduction1) ---
                        let reductionGainLin1;
                        if (gainReduction1 >= 60) { reductionGainLin1 = expLookup[lutExpMaxIndex]; }
                        else {
                             const exp_idx_f1 = gainReduction1 * expLookupScale;
                             const exp_idx1_floor = Math.floor(exp_idx_f1);
                             // Replace Math.max/min with if/ternary for better performance
                             const exp_idx1 = exp_idx1_floor < 0 ? 0 : (exp_idx1_floor > lutExpMaxIndex ? lutExpMaxIndex : exp_idx1_floor);
                             reductionGainLin1 = expLookup[exp_idx1];
                        } // No need for <=0 check due to outer if (gainReduction1 > 1e-9)
                        // --- End Inlined fastExp ---
                        totalGainLin1 *= reductionGainLin1;
                    }
                    if (totalGainLin1 !== 1.0) {
                        result[offset + i] *= totalGainLin1; // Apply gain to the result buffer
                    }
    
                    // Gain Calc Sample 2 (using currentEnvelope2, diff2, etc.)
                    let envelopeDb2;
                    if (currentEnvelope2 < MIN_ENVELOPE) { envelopeDb2 = lutMinDb; }
                    else {
                        const db_idx_f2 = currentEnvelope2 * dbLookupScale;
                        const db_idx2_floor = Math.floor(db_idx_f2);
                        // Replace Math.max/min with if/ternary for better performance
                        const db_idx2 = db_idx2_floor < 0 ? 0 : (db_idx2_floor > lutDbMaxIndex ? lutDbMaxIndex : db_idx2_floor);
                        envelopeDb2 = dbLookup[db_idx2];
                    }
                    let diff2 = threshold - envelopeDb2;
                    let gainReduction2 = 0;
                    if (invRatio > 1e-9 && diff2 > -halfKnee) {
                        if (diff2 >= halfKnee) { gainReduction2 = diff2 * invRatio; }
                        else { if (kneeWidth > 1e-9) { const kneeFactor2 = (diff2 + halfKnee) / kneeWidth; gainReduction2 = 0.5 * invRatio * kneeWidth * kneeFactor2 * kneeFactor2; } }
                        if (gainReduction2 < 0) gainReduction2 = 0;
                    }
                    if (gainReduction2 > blockMaxGainReduction) blockMaxGainReduction = gainReduction2;
                    let totalGainLin2 = outputGainFactor;
                    if (gainReduction2 > 1e-9) {
                        let reductionGainLin2;
                        if (gainReduction2 >= 60) { reductionGainLin2 = expLookup[lutExpMaxIndex]; }
                        else {
                            const exp_idx_f2 = gainReduction2 * expLookupScale;
                            const exp_idx2_floor = Math.floor(exp_idx_f2);
                            // Replace Math.max/min with if/ternary for better performance
                            const exp_idx2 = exp_idx2_floor < 0 ? 0 : (exp_idx2_floor > lutExpMaxIndex ? lutExpMaxIndex : exp_idx2_floor);
                            reductionGainLin2 = expLookup[exp_idx2];
                        }
                        totalGainLin2 *= reductionGainLin2;
                    }
                    if (totalGainLin2 !== 1.0) {
                        result[offset + i + 1] *= totalGainLin2;
                    }
    
                    // Gain Calc Sample 3 (using currentEnvelope3, diff3, etc.)
                    let envelopeDb3;
                    if (currentEnvelope3 < MIN_ENVELOPE) { envelopeDb3 = lutMinDb; }
                    else {
                        const db_idx_f3 = currentEnvelope3 * dbLookupScale;
                        const db_idx3_floor = Math.floor(db_idx_f3);
                        // Replace Math.max/min with if/ternary for better performance
                        const db_idx3 = db_idx3_floor < 0 ? 0 : (db_idx3_floor > lutDbMaxIndex ? lutDbMaxIndex : db_idx3_floor);
                        envelopeDb3 = dbLookup[db_idx3];
                    }
                    let diff3 = threshold - envelopeDb3;
                    let gainReduction3 = 0;
                    if (invRatio > 1e-9 && diff3 > -halfKnee) {
                        if (diff3 >= halfKnee) { gainReduction3 = diff3 * invRatio; }
                        else { if (kneeWidth > 1e-9) { const kneeFactor3 = (diff3 + halfKnee) / kneeWidth; gainReduction3 = 0.5 * invRatio * kneeWidth * kneeFactor3 * kneeFactor3; } }
                        if (gainReduction3 < 0) gainReduction3 = 0;
                    }
                    if (gainReduction3 > blockMaxGainReduction) blockMaxGainReduction = gainReduction3;
                    let totalGainLin3 = outputGainFactor;
                    if (gainReduction3 > 1e-9) {
                        let reductionGainLin3;
                        if (gainReduction3 >= 60) { reductionGainLin3 = expLookup[lutExpMaxIndex]; }
                        else {
                            const exp_idx_f3 = gainReduction3 * expLookupScale;
                            const exp_idx3_floor = Math.floor(exp_idx_f3);
                            // Replace Math.max/min with if/ternary for better performance
                            const exp_idx3 = exp_idx3_floor < 0 ? 0 : (exp_idx3_floor > lutExpMaxIndex ? lutExpMaxIndex : exp_idx3_floor);
                            reductionGainLin3 = expLookup[exp_idx3];
                        }
                        totalGainLin3 *= reductionGainLin3;
                    }
                    if (totalGainLin3 !== 1.0) {
                        result[offset + i + 2] *= totalGainLin3;
                    }
    
                    // Gain Calc Sample 4 (using currentEnvelope4, diff4, etc.)
                    let envelopeDb4;
                    if (currentEnvelope4 < MIN_ENVELOPE) { envelopeDb4 = lutMinDb; }
                    else {
                        const db_idx_f4 = currentEnvelope4 * dbLookupScale;
                        const db_idx4_floor = Math.floor(db_idx_f4);
                        // Replace Math.max/min with if/ternary for better performance
                        const db_idx4 = db_idx4_floor < 0 ? 0 : (db_idx4_floor > lutDbMaxIndex ? lutDbMaxIndex : db_idx4_floor);
                        envelopeDb4 = dbLookup[db_idx4];
                    }
                    let diff4 = threshold - envelopeDb4;
                    let gainReduction4 = 0;
                    if (invRatio > 1e-9 && diff4 > -halfKnee) {
                        if (diff4 >= halfKnee) { gainReduction4 = diff4 * invRatio; }
                        else { if (kneeWidth > 1e-9) { const kneeFactor4 = (diff4 + halfKnee) / kneeWidth; gainReduction4 = 0.5 * invRatio * kneeWidth * kneeFactor4 * kneeFactor4; } }
                        if (gainReduction4 < 0) gainReduction4 = 0;
                    }
                    if (gainReduction4 > blockMaxGainReduction) blockMaxGainReduction = gainReduction4;
                    let totalGainLin4 = outputGainFactor;
                    if (gainReduction4 > 1e-9) {
                        let reductionGainLin4;
                        if (gainReduction4 >= 60) { reductionGainLin4 = expLookup[lutExpMaxIndex]; }
                        else {
                            const exp_idx_f4 = gainReduction4 * expLookupScale;
                            const exp_idx4_floor = Math.floor(exp_idx_f4);
                            // Replace Math.max/min with if/ternary for better performance
                            const exp_idx4 = exp_idx4_floor < 0 ? 0 : (exp_idx4_floor > lutExpMaxIndex ? lutExpMaxIndex : exp_idx4_floor);
                            reductionGainLin4 = expLookup[exp_idx4];
                        }
                        totalGainLin4 *= reductionGainLin4;
                    }
                    if (totalGainLin4 !== 1.0) {
                        result[offset + i + 3] *= totalGainLin4;
                    }
    
                } // End of unrolled loop
    
                // Handle remaining samples (less than 4) using the same logic
                for (; i < blockSize; i++) {
                    let val = data[offset + i];
                    let inputAbs = val >= 0 ? val : -val;
                    let coeff = (inputAbs > envelope) ? attackCoeff : releaseCoeff;
                    let oneMinusCoeff = (inputAbs > envelope) ? oneMinusAttackCoeff : oneMinusReleaseCoeff;
                    envelope = envelope * coeff + inputAbs * oneMinusCoeff;
                    if (envelope < MIN_ENVELOPE) envelope = MIN_ENVELOPE;
                    let currentEnvelope = envelope;
    
                    // --- Inlined fastDb(currentEnvelope) ---
                    let envelopeDb;
                     if (currentEnvelope < MIN_ENVELOPE) { envelopeDb = lutMinDb; }
                     else {
                         const db_idx_f = currentEnvelope * dbLookupScale;
                         const db_idx_floor = Math.floor(db_idx_f);
                         // Replace Math.max/min with if/ternary for better performance
                         const db_idx = db_idx_floor < 0 ? 0 : (db_idx_floor > lutDbMaxIndex ? lutDbMaxIndex : db_idx_floor);
                         envelopeDb = dbLookup[db_idx];
                     }
                    // --- End Inlined fastDb ---
    
                    let diff = threshold - envelopeDb;
                    let gainReduction = 0;
                    if (invRatio > 1e-9 && diff > -halfKnee) {
                        if (diff >= halfKnee) { gainReduction = diff * invRatio; }
                        else { if (kneeWidth > 1e-9) { const kneeFactor = (diff + halfKnee) / kneeWidth; gainReduction = 0.5 * invRatio * kneeWidth * kneeFactor * kneeFactor; } }
                        if (gainReduction < 0) gainReduction = 0;
                    }
    
                    if (gainReduction > blockMaxGainReduction) blockMaxGainReduction = gainReduction;
    
                    let totalGainLin = outputGainFactor;
                    if (gainReduction > 1e-9) { // Apply reduction only if it is significant
                        // --- Inlined fastExp(gainReduction) ---
                         let reductionGainLin;
                         if (gainReduction >= 60) { reductionGainLin = expLookup[lutExpMaxIndex]; }
                         else {
                             const exp_idx_f = gainReduction * expLookupScale;
                             const exp_idx_floor = Math.floor(exp_idx_f);
                             // Replace Math.max/min with if/ternary for better performance
                             const exp_idx = exp_idx_floor < 0 ? 0 : (exp_idx_floor > lutExpMaxIndex ? lutExpMaxIndex : exp_idx_floor);
                             reductionGainLin = expLookup[exp_idx];
                         }
                         // --- End Inlined fastExp ---
                         totalGainLin *= reductionGainLin;
                     }
                     if (totalGainLin !== 1.0) {
                         result[offset + i] *= totalGainLin;
                     }
                }
    
                // Update envelope state for the next block
                envelopeStates[ch] = envelope;
            } // End of channel loop
    
            // --- Set measurements ---
            // Attaching properties to a TypedArray is non-standard but replicates original behavior.
            result.measurements = {
                time: parameters.time, // Assume parameters.time exists
                gainReduction: blockMaxGainReduction
            };
    
            return result;
        `; // End of function body string
    }
    
    onMessage(message) {
        if (message.type === 'processBuffer') {
            const result = this.process(message);
            
            // Only update graphs if there's significant gain reduction
            const GR_THRESHOLD = 0.05; // 0.05 dB threshold for considering gain reduction significant
            if (this.canvas && this.gr > GR_THRESHOLD) {
                this.updateTransferGraph();
                this.updateReductionMeter();
            }
            
            return result;
        }
    }

    process(message) {
        if (!message?.measurements) return;

        const time = performance.now() / 1000;
        const deltaTime = time - this.lastProcessTime;
        this.lastProcessTime = time;

        const targetGr = message.measurements.gainReduction || 0;
        const attackTime = 0.005;  // 5ms for fast attack
        const releaseTime = 0.100; // 100ms for smooth release
        
        const smoothingFactor = targetGr > this.gr ? 
            Math.min(1, deltaTime / attackTime) : 
            Math.min(1, deltaTime / releaseTime);
        
        this.gr = this.gr + (targetGr - this.gr) * smoothingFactor;
        this.gr = this.gr < 0 ? 0 : this.gr;

        return;
    }

    setParameters(params) {
        let graphNeedsUpdate = false;
        super._setValidatedParameters(params);

        if (params.th !== undefined) {
            this.th = this.parseFiniteNumber(params.th, -96, 0, this.th);
            graphNeedsUpdate = true;
        }
        if (params.rt !== undefined) {
            this.rt = this.parseFiniteNumber(params.rt, 1, 100, this.rt);
            graphNeedsUpdate = true;
        }
        if (params.at !== undefined) {
            this.at = this.parseFiniteNumber(params.at, 0.01, 50, this.at);
        }
        if (params.rl !== undefined) {
            this.rl = this.parseFiniteNumber(params.rl, 10, 2000, this.rl);
        }
        if (params.kn !== undefined) {
            this.kn = this.parseFiniteNumber(params.kn, 0, 6, this.kn);
            graphNeedsUpdate = true;
        }
        if (params.gn !== undefined) {
            this.gn = this.parseFiniteNumber(params.gn, -12, 12, this.gn);
            graphNeedsUpdate = true;
        }

        this.updateParameters();
        if (graphNeedsUpdate) {
            this.updateTransferGraph();
        }
    }

    setTh(value) { this.setParameters({ th: value }); }
    setRt(value) { this.setParameters({ rt: value }); }
    setAt(value) { this.setParameters({ at: value }); }
    setRl(value) { this.setParameters({ rl: value }); }
    setKn(value) { this.setParameters({ kn: value }); }
    setGn(value) { this.setParameters({ gn: value }); }

    getParameters() {
        return {
            type: this.constructor.name,
            th: this.th,
            rt: this.rt,
            at: this.at,
            rl: this.rl,
            kn: this.kn,
            gn: this.gn,
            enabled: this.enabled
        };
    }

    updateTransferGraph() {
        const canvas = this.canvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Draw grid and dB labels
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#666';
        ctx.font = '20px Arial';
        
        [-72, -48, -24].forEach(db => {
            const x = ((db + 96) / 96) * width;
            const y = height - ((db + 96) / 96) * height;
            
            // Draw vertical grid line
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            
            // Draw horizontal grid line
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            
            // Draw labels
            ctx.textAlign = 'right';
            ctx.fillText(`${db}dB`, 80, y + 6);
            
            ctx.textAlign = 'center';
            ctx.fillText(`${db}dB`, x, height - 40);
        });

        // Draw transfer function
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const thresholdDb = this.th;
        const ratio = this.rt;
        const kneeDb = this.kn;
        const gainDb = this.gn;

        for (let i = 0; i < width; i++) {
            const inputDb = (i / width) * 96 - 96;
            
            const diff = thresholdDb - inputDb;
            let gainReduction = 0;
            
            if (ratio === 1) {
                gainReduction = 0;
            } else {
                if (diff <= -kneeDb / 2) {
                    gainReduction = 0;
                } else if (diff >= kneeDb / 2) {
                    gainReduction = diff * (ratio - 1);
                } else {
                    const t = (diff + kneeDb / 2) / kneeDb;
                    gainReduction = (ratio - 1) * kneeDb * t * t / 2;
                }
            }
            
            const outputDb = inputDb - gainReduction + gainDb;
            
            const x = i;
            const y = ((outputDb + 96) / 96) * height;
            
            if (i === 0) {
                ctx.moveTo(x, height - y);
            } else {
                ctx.lineTo(x, height - y);
            }
        }
        ctx.stroke();

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
    }

    updateReductionMeter() {
        const canvas = this.canvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const height = canvas.height;

        ctx.save();

        const meterX = 0;
        const meterWidth = 32;
        ctx.beginPath();
        ctx.rect(meterX, 0, meterWidth, height);
        ctx.clip();

        ctx.fillStyle = '#222';
        ctx.fillRect(meterX, 0, meterWidth, height);

        const reductionHeight = Math.min(height, (this.gr / 60) * height);

        if (reductionHeight > 0) {
            ctx.fillStyle = '#008000';
            ctx.fillRect(meterX, 0, meterWidth, reductionHeight);
        }

        ctx.restore();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'gate-plugin-ui plugin-parameter-ui';

        // Use inherited createParameterControl
        container.appendChild(this.createParameterControl('Threshold', -96, 0, 1, this.th, this.setTh.bind(this), 'dB'));
        container.appendChild(this.createParameterControl('Ratio', 1, 100, 0.1, this.rt, this.setRt.bind(this), ':1')); // Corrected range/step based on constructor
        container.appendChild(this.createParameterControl('Attack', 0.01, 50, 0.01, this.at, this.setAt.bind(this), 'ms')); // Corrected range/step based on constructor
        container.appendChild(this.createParameterControl('Release', 10, 2000, 10, this.rl, this.setRl.bind(this), 'ms')); // Corrected range/step based on constructor
        container.appendChild(this.createParameterControl('Knee', 0, 6, 0.1, this.kn, this.setKn.bind(this), 'dB')); // Corrected range/step based on constructor
        container.appendChild(this.createParameterControl('Gain', -12, 12, 0.1, this.gn, this.setGn.bind(this), 'dB'));

        const canvas = document.createElement('canvas');
        // Set canvas buffer size for high-resolution display.
        // This size is intentionally larger than the display size (200x200px defined in CSS)
        // to ensure sharpness when scaled or on high-DPI screens.
        canvas.width = 400;
        canvas.height = 400;
        canvas.style.width = '200px';
        canvas.style.height = '200px';
        canvas.style.backgroundColor = '#222';
        this.canvas = canvas;

        const graphContainer = document.createElement('div');
        graphContainer.style.position = 'relative';
        graphContainer.appendChild(canvas);
        container.appendChild(graphContainer);

        this.observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                this.isVisible = entry.isIntersecting;
                if (this.isVisible) {
                    this.startAnimation();
                } else {
                    this.stopAnimation();
                }
            }
        });
        this.observer.observe(this.canvas);

        this.updateTransferGraph();
        this.startAnimation();
        return container;
    }

    startAnimation() {
        if (!this.enabled || !this._sectionEnabled) return;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        let lastGraphState = null;
        
        const animate = () => {
            // Check if canvas still exists in DOM
            if (!this.canvas) {
                this.cleanup();  // Stop animation if canvas is removed
                return;
            }

            const isVisible = this.isVisible;

            if (isVisible) {
                // Check if we need to update the graph
                const needsUpdate = this.needsGraphUpdate(lastGraphState);
                if (needsUpdate) {
                    const ctx = this.canvas.getContext('2d');
                    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                    
                    this.updateReductionMeter();
                    this.updateTransferGraph();
                    
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
        
        // Check if there's significant gain reduction
        const hasActiveReduction = this.gr > GR_THRESHOLD;
        
        // If there's significant gain reduction, we should update
        if (hasActiveReduction) return true;
        
        // Compare current state with last state
        const currentState = this.getCurrentGraphState();
        
        // Check if any relevant parameters have changed
        return JSON.stringify(currentState) !== JSON.stringify(lastState);
    }
    
    // Get current state of parameters that affect graph appearance
    getCurrentGraphState() {
        return {
            threshold: this.th,
            ratio: this.rt,
            knee: this.kn,
            gain: this.gn,
            gainReduction: this.gr
        };
    }

    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    cleanup() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.gr = 0;
        this.lastProcessTime = performance.now() / 1000;
        super.cleanup();
    }
}

window.GatePlugin = GatePlugin;
