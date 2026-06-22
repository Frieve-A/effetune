class ExpanderPlugin extends PluginBase {
    constructor() {
        super('Expander', 'Dynamic range expansion below threshold with ratio and knee control');

        this.th = -24;  // th: Threshold (-60 to 0 dB)
        this.rt = 2;    // rt: Ratio (0.05:1 to 20:1)
        this.at = 10;   // at: Attack Time (0.1 to 100 ms)
        this.rl = 100;  // rl: Release Time (10 to 1000 ms)
        this.kn = 3;    // kn: Knee (0 to 12 dB)
        this.gn = 0;    // gn: Gain (-12 to +12 dB)
        this.gb = 0;    // gb: Current gain boost value (instead of gain reduction)
        this.enabled = true; // Plugin is enabled by default
        this.lastProcessTime = performance.now() / 1000;
        this.animationFrameId = null;
        this._hasMessageHandler = false;
        this.isVisible = true;
        this.observer = null;

        this._setupMessageHandler();

        this.registerProcessor(this.getProcessorCode());
    }

    // Returns the processor code string with optimized processing
    getProcessorCode() {
        return `
            // If expansion is disabled, return the input immediately without processing
            if (!parameters.enabled) {
                // Attach measurements object even when disabled for consistent return type
                data.measurements = {
                    time: parameters.time, // Pass time through
                    gainBoost: 0.0     // No gain boost when disabled
                };
                return data;
            }

            // Allocate result buffer
            const result = new Float32Array(data.length);

            // Constants (kept from original)
            const MIN_ENVELOPE = 1e-6;
            const LOG10_20 = 8.685889638065035; // 20/ln(10)
            const GAIN_FACTOR = 0.11512925464970229; // ln(10)/20

            // Cache frequently used parameters from the 'parameters' object
            const th = parameters.th;
            const rt = parameters.rt;
            const kn = parameters.kn;
            const gn = parameters.gn; // Makeup gain in dB
            const blockSize = parameters.blockSize;
            const channelCount = parameters.channelCount;
            const sampleRate = parameters.sampleRate;

            // Calculate derived parameters
            const halfKnee = kn * 0.5;
            // For expander: when signal is below threshold, apply expansion
            // Expansion ratio calculation based on requirements:
            // - Ratio 2.0: input at threshold-12dB should output at threshold-24dB (relative -24dB)
            // - Ratio 0.5: input at threshold-12dB should output at threshold-6dB (relative -6dB)
            // Formula: output = threshold + (input - threshold) * ratio
            // Test: threshold=-12dB, input=-24dB, diff=-12dB
            // Ratio 2.0: output = -12 + (-12) * 2 = -12 - 24 = -36dB (threshold-24dB) ✓
            // Ratio 0.5: output = -12 + (-12) * 0.5 = -12 - 6 = -18dB (threshold-6dB) ✓
            const expansionSlope = rt - 1; // Expansion slope for below-threshold signals (match graph logic)

            // Calculate filter coefficients for attack and release
            const attackSamplesRaw = (parameters.at * sampleRate) / 1000.0;
            const attackSamples = attackSamplesRaw < 1.0 ? 1.0 : attackSamplesRaw;
            const releaseSamplesRaw = (parameters.rl * sampleRate) / 1000.0;
            const releaseSamples = releaseSamplesRaw < 1.0 ? 1.0 : releaseSamplesRaw;
            // Coefficient calculation: exp(-LN2 / T_samples)
            // This corresponds to the time it takes for the envelope to reach half the target value
            const attackCoeff = Math.exp(-Math.LN2 / attackSamples);
            const releaseCoeff = Math.exp(-Math.LN2 / releaseSamples);
            // Pre-calculate (1 - coeff) for the envelope update formula is a valid micro-optimization
            const oneMinusAttackCoeff = 1.0 - attackCoeff;
            const oneMinusReleaseCoeff = 1.0 - releaseCoeff;


            // Initialize envelope state per channel if needed
            if (!context.envelopeStates || context.envelopeStates.length !== channelCount) {
                context.envelopeStates = new Float32Array(channelCount).fill(MIN_ENVELOPE);
            }

            // Create or reuse lookup tables (LUTs) - Functionally identical to original setup
            if (!context.dbLookup || !context.expLookup) {
                // --- dB Lookup Table (linear amplitude to dB) ---
                const DB_LOOKUP_SIZE = 4096;
                const DB_LOOKUP_SCALE = DB_LOOKUP_SIZE / 10.0; // Map 0-10 amplitude range to indices
                context.dbLookup = new Float32Array(DB_LOOKUP_SIZE);
                const MIN_DB_LOOKUP = LOG10_20 * Math.log(MIN_ENVELOPE); // Calculate once
                for (let i = 0; i < DB_LOOKUP_SIZE; i++) {
                    const x = i / DB_LOOKUP_SCALE;
                    context.dbLookup[i] = (x < MIN_ENVELOPE) ? MIN_DB_LOOKUP : LOG10_20 * Math.log(x);
                }
                context.MIN_DB_LOOKUP = MIN_DB_LOOKUP;

                // --- Exp Lookup Table (dB value to linear gain multiplier: 10^(db / 20)) ---
                // This table needs to handle both positive (makeup gain) and negative (reduction) dB values.
                // Let's map a range like -60dB to +20dB.
                const EXP_LOOKUP_RANGE_DB = 80.0; // e.g., -60 to +20 dB
                const EXP_LOOKUP_MIN_DB = -60.0;
                const EXP_LOOKUP_SIZE = 4096; // Increase size for better resolution over wider range
                const EXP_LOOKUP_SCALE = EXP_LOOKUP_SIZE / EXP_LOOKUP_RANGE_DB;
                context.expLookup = new Float32Array(EXP_LOOKUP_SIZE);
                const MIN_EXP_LOOKUP_VAL = Math.exp(EXP_LOOKUP_MIN_DB * GAIN_FACTOR); // Gain at -60dB
                const MAX_EXP_LOOKUP_VAL = Math.exp((EXP_LOOKUP_MIN_DB + EXP_LOOKUP_RANGE_DB) * GAIN_FACTOR); // Gain at +20dB

                for (let i = 0; i < EXP_LOOKUP_SIZE; i++) {
                    const x_db = EXP_LOOKUP_MIN_DB + (i / EXP_LOOKUP_SCALE); // dB value
                    context.expLookup[i] = Math.exp(x_db * GAIN_FACTOR); // Calculate linear gain: 10^(dB/20)
                }
                context.MIN_EXP_LOOKUP_VAL = MIN_EXP_LOOKUP_VAL;
                context.MAX_EXP_LOOKUP_VAL = MAX_EXP_LOOKUP_VAL;
                context.EXP_LOOKUP_MIN_DB = EXP_LOOKUP_MIN_DB;
                context.EXP_LOOKUP_RANGE_DB = EXP_LOOKUP_RANGE_DB;
                context.EXP_LOOKUP_SIZE = EXP_LOOKUP_SIZE;
                context.EXP_LOOKUP_SCALE = EXP_LOOKUP_SCALE;
                context.expLookupMaxIndex = EXP_LOOKUP_SIZE - 1;

                 // Store constants for dbLookup as well
                 context.DB_LOOKUP_SIZE = DB_LOOKUP_SIZE;
                 context.DB_LOOKUP_SCALE = DB_LOOKUP_SCALE;
                 context.dbLookupMaxIndex = DB_LOOKUP_SIZE - 1;
            }

            // --- Fast approximation functions using lookup tables ---
            const dbLookup = context.dbLookup;
            const dbLookupScale = context.DB_LOOKUP_SCALE;
            const dbLookupMaxIndex = context.dbLookupMaxIndex;
            const minDbLookup = context.MIN_DB_LOOKUP;

            const expLookup = context.expLookup;
            const expLookupScale = context.EXP_LOOKUP_SCALE;
            const expLookupMaxIndex = context.expLookupMaxIndex;
            const expLookupMinDb = context.EXP_LOOKUP_MIN_DB;
            const minExpLookupVal = context.MIN_EXP_LOOKUP_VAL;
            const maxExpLookupVal = context.MAX_EXP_LOOKUP_VAL;


            // Fast dB conversion: linear amplitude -> dB (Functionally identical to original)
            function fastDb(x) {
                if (x < MIN_ENVELOPE) return minDbLookup;
                // Using | 0 as floor, clamp index
                const indexRaw = (x * dbLookupScale) | 0;
                const index = indexRaw > dbLookupMaxIndex ? dbLookupMaxIndex : indexRaw;
                return dbLookup[index];
            }

            // Fast exponential conversion: dB value -> linear gain multiplier
            function fastExpDb(x_db) { // Input is dB value (can be positive or negative)
                if (x_db <= expLookupMinDb) return minExpLookupVal; // Clamp below range
                if (x_db >= expLookupMinDb + context.EXP_LOOKUP_RANGE_DB) return maxExpLookupVal; // Clamp above range
                // Calculate index relative to the start of the lookup table's dB range
                const indexRaw = ((x_db - expLookupMinDb) * expLookupScale) | 0;
                const index = indexRaw > expLookupMaxIndex ? expLookupMaxIndex : indexRaw;
                return expLookup[index];
            }
            // --- End Fast approximation functions ---


            // Create or reuse work buffer for intermediate envelope calculations per block
             if (!context.workBuffer || context.workBuffer.length !== blockSize) {
                 if (blockSize <= 0) { // Basic check added previously, good safeguard
                    console.error("ExpanderPlugin: Invalid blockSize received:", blockSize);
                    result.set(data);
                    result.measurements = { time: parameters.time, gainBoost: 0.0 };
                    return result;
                 }
                 context.workBuffer = new Float32Array(blockSize);
             }
            const workBuffer = context.workBuffer;

            let maxGainBoost = 0.0; // Track max GB within this block

            // Process each audio channel
            for (let ch = 0; ch < channelCount; ch++) {
                const offset = ch * blockSize;
                let envelope = context.envelopeStates[ch]; // Load previous state

                // First pass: Calculate signal envelope using original logic
                for (let i = 0; i < blockSize; i++) {
                    const input = data[offset + i]; // Get input sample directly
                    const inputAbs = input >= 0 ? input : -input;
                    // Original logic: Determine coefficient based on input vs current envelope
                    const coeff = inputAbs > envelope ? attackCoeff : releaseCoeff;
                    // Envelope update formula
                    envelope = envelope * coeff + inputAbs * (1.0 - coeff);
                    // Ensure minimum envelope value and store in work buffer
                    workBuffer[i] = envelope < MIN_ENVELOPE ? MIN_ENVELOPE : envelope;
                }

                // Store the final envelope state for the next block
                context.envelopeStates[ch] = envelope;

                // --- Optimization: Check if expansion is needed ---
                let maxEnvelope = MIN_ENVELOPE;
                 for (let i = 0; i < blockSize; i++) {
                     if (workBuffer[i] > maxEnvelope) maxEnvelope = workBuffer[i];
                 }
                const maxEnvelopeDb = fastDb(maxEnvelope);
                const maxDiff = maxEnvelopeDb - th;

                // For expander: If max level is above the start of the knee, skip detailed processing
                if (maxDiff >= halfKnee) {
                    // Apply ONLY makeup gain if needed. Calculate makeup gain multiplier.
                    const makeupGainMultiplier = fastExpDb(gn);
                    if (makeupGainMultiplier !== 1.0) {
                        for (let i = 0; i < blockSize; i++) {
                            result[offset + i] = data[offset + i] * makeupGainMultiplier;
                        }
                    } else {
                        // Fastest path: No expansion, no makeup gain. Copy data.
                        result.set(data.subarray(offset, offset + blockSize), offset);
                    }
                    continue; // Skip to next channel
                }
                // --- End Optimization Check ---


                // Second pass: Calculate gain boost and apply gain. Loop unrolling maintained.
                const blockSizeMod4 = blockSize - (blockSize % 4);
                let i = 0;

                // Process 4 samples per iteration
                for (; i < blockSizeMod4; i += 4) {
                    // --- Sample 1 ---
                    const envDb1 = fastDb(workBuffer[i]);
                    const diff1 = envDb1 - th;
                    let gb1 = 0.0; // Gain Boost in dB (non-negative)
                    // Expander gain reduction logic:
                    if (diff1 <= -halfKnee) {
                        gb1 = diff1 * expansionSlope; // Linear reduction below threshold
                    } else if (diff1 >= halfKnee) {
                        gb1 = 0.0; // No reduction above threshold
                    } else { // Within knee
                        const t1 = (diff1 + halfKnee) / kn;
                        // Quadratic knee with value continuity at boundaries
                        const linearBelow = (-halfKnee) * expansionSlope;
                        gb1 = linearBelow * (1 - t1) * (1 - t1);
                    }
                    const finalDbGain1 = gn + gb1; // Total gain = Makeup Gain + Gain Boost
                    const linearGain1 = fastExpDb(finalDbGain1); // Convert total dB gain to linear multiplier
                    result[offset + i] = data[offset + i] * linearGain1;
                    const absGb1 = gb1 >= 0 ? gb1 : -gb1;
                    if (absGb1 > maxGainBoost) maxGainBoost = absGb1; // Update max GB

                    // --- Sample 2 ---
                    const envDb2 = fastDb(workBuffer[i + 1]);
                    const diff2 = envDb2 - th;
                    let gb2 = 0.0;
                    if (diff2 <= -halfKnee) { gb2 = diff2 * expansionSlope; }
                    else if (diff2 >= halfKnee) { gb2 = 0.0; }
                    else { const t2 = (diff2 + halfKnee) / kn; const linearBelow2 = (-halfKnee) * expansionSlope; gb2 = linearBelow2 * (1 - t2) * (1 - t2); }
                    const finalDbGain2 = gn + gb2;
                    const linearGain2 = fastExpDb(finalDbGain2);
                    result[offset + i + 1] = data[offset + i + 1] * linearGain2;
                    const absGb2 = gb2 >= 0 ? gb2 : -gb2;
                    if (absGb2 > maxGainBoost) maxGainBoost = absGb2;

                    // --- Sample 3 ---
                    const envDb3 = fastDb(workBuffer[i + 2]);
                    const diff3 = envDb3 - th;
                    let gb3 = 0.0;
                    if (diff3 <= -halfKnee) { gb3 = diff3 * expansionSlope; }
                    else if (diff3 >= halfKnee) { gb3 = 0.0; }
                    else { const t3 = (diff3 + halfKnee) / kn; const linearBelow3 = (-halfKnee) * expansionSlope; gb3 = linearBelow3 * (1 - t3) * (1 - t3); }
                    const finalDbGain3 = gn + gb3;
                    const linearGain3 = fastExpDb(finalDbGain3);
                    result[offset + i + 2] = data[offset + i + 2] * linearGain3;
                    const absGb3 = gb3 >= 0 ? gb3 : -gb3;
                    if (absGb3 > maxGainBoost) maxGainBoost = absGb3;

                    // --- Sample 4 ---
                    const envDb4 = fastDb(workBuffer[i + 3]);
                    const diff4 = envDb4 - th;
                    let gb4 = 0.0;
                    if (diff4 <= -halfKnee) { gb4 = diff4 * expansionSlope; }
                    else if (diff4 >= halfKnee) { gb4 = 0.0; }
                    else { const t4 = (diff4 + halfKnee) / kn; const linearBelow4 = (-halfKnee) * expansionSlope; gb4 = linearBelow4 * (1 - t4) * (1 - t4); }
                    const finalDbGain4 = gn + gb4;
                    const linearGain4 = fastExpDb(finalDbGain4);
                    result[offset + i + 3] = data[offset + i + 3] * linearGain4;
                    const absGb4 = gb4 >= 0 ? gb4 : -gb4;
                    if (absGb4 > maxGainBoost) maxGainBoost = absGb4;
                }

                // Handle remaining samples (if blockSize is not a multiple of 4)
                for (; i < blockSize; i++) {
                    const envelopeDb = fastDb(workBuffer[i]);
                    const diff = envelopeDb - th;
                    let gainBoost = 0.0;

                    if (diff <= -halfKnee) {
                        gainBoost = diff * expansionSlope;
                    } else if (diff >= halfKnee) {
                        gainBoost = 0.0;
                    } else {
                        const t = (diff + halfKnee) / kn;
                        const linearBelow = (-halfKnee) * expansionSlope;
                        gainBoost = linearBelow * (1 - t) * (1 - t);
                    }

                    const absGainBoost = gainBoost >= 0 ? gainBoost : -gainBoost;
                    if (absGainBoost > maxGainBoost) maxGainBoost = absGainBoost;

                    const finalDbGain = gn + gainBoost; // Total dB gain
                    const linearGain = fastExpDb(finalDbGain); // Convert to linear
                    result[offset + i] = data[offset + i] * linearGain;
                }
            } // End channel loop

            // Attach measurements
            result.measurements = {
                time: parameters.time,
                gainBoost: maxGainBoost
            };

            return result;
        `;
    }

    onMessage(message) {
        if (message.type === 'processBuffer') {
            const result = this.process(message);
            
            // Only update graphs if there's significant gain boost
            const GB_THRESHOLD = 0.05; // 0.05 dB threshold for considering gain boost significant
            if (this.canvas && this.gb > GB_THRESHOLD) {
                this.updateTransferGraph();
                this.updateBoostMeter();
            }
            
            return result;
        }
    }

    process(message) {
        if (!message?.measurements) return;

        // Use cached time constants for better performance
        if (!this._timeConstants) {
            this._timeConstants = {
                attackTime: 0.005,  // 5ms for fast attack
                releaseTime: 0.100  // 100ms for smooth release
            };
        }
        
        const time = performance.now() / 1000;
        const deltaTime = time - this.lastProcessTime;
        this.lastProcessTime = time;

        const targetGb = message.measurements.gainBoost || 0;
        const { attackTime, releaseTime } = this._timeConstants;
        
        // Fast path: if gain boost is very small, skip processing
        const absTargetGb = targetGb >= 0 ? targetGb : -targetGb;
        const absCurrentGb = this.gb >= 0 ? this.gb : -this.gb;
        if (absTargetGb < 0.01 && absCurrentGb < 0.01) {
            this.gb = 0;
            return;
        }
        
        // Smoothing calculation
        const attackFactor = deltaTime / attackTime;
        const releaseFactor = deltaTime / releaseTime;
        const smoothingFactor = targetGb > this.gb ?
            (attackFactor > 1 ? 1 : attackFactor) :
            (releaseFactor > 1 ? 1 : releaseFactor);

        this.gb += (targetGb - this.gb) * smoothingFactor;
        this.gb = this.gb < 0 ? 0 : this.gb;

        return;
    }

    setParameters(params) {
        let graphNeedsUpdate = false;
        if (params.th !== undefined) {
            this.th = this.parseFiniteNumber(params.th, -60, 0, this.th);
            graphNeedsUpdate = true;
        }
        if (params.rt !== undefined) {
            this.rt = this.parseFiniteNumber(params.rt, 0.05, 20, this.rt);
            graphNeedsUpdate = true;
        }
        if (params.at !== undefined) {
            this.at = this.parseFiniteNumber(params.at, 0.1, 100, this.at);
        }
        if (params.rl !== undefined) {
            this.rl = this.parseFiniteNumber(params.rl, 10, 1000, this.rl);
        }
        if (params.kn !== undefined) {
            this.kn = this.parseFiniteNumber(params.kn, 0, 12, this.kn);
            graphNeedsUpdate = true;
        }
        if (params.gn !== undefined) {
            this.gn = this.parseFiniteNumber(params.gn, -12, 12, this.gn);
            graphNeedsUpdate = true;
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }

        this.updateParameters();
        if (graphNeedsUpdate && this.canvas) {
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

        // Draw grid and labels at dB positions
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#666';
        ctx.font = '20px Arial';

        [-48, -36, -24, -12].forEach(db => {
            const x = ((db + 60) / 60) * width;
            const y = height - ((db + 60) / 60) * height;

            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();

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
            const inputDb = (i / width) * 60 - 60;
            const diff = inputDb - thresholdDb;
            let gainBoost = 0;
            
            // Expander logic: expand below threshold, no change above threshold
            if (diff <= -kneeDb / 2) {
                // Below threshold: apply expansion ratio
                // For expander: output = threshold + (input - threshold) * ratio
                // gainBoost = output - input = threshold + (input - threshold) * ratio - input
                // gainBoost = threshold - input + (input - threshold) * ratio
                // gainBoost = (threshold - input) + (input - threshold) * ratio
                // gainBoost = (input - threshold) * (ratio - 1)
                gainBoost = diff * (ratio - 1);
            } else if (diff >= kneeDb / 2) {
                // Above threshold: no change (1:1 ratio)
                gainBoost = 0;
            } else {
                // Within knee: smooth transition
                const t = (diff + kneeDb / 2) / kneeDb;
                const slope = (ratio - 1);
                const linearBelow = (-kneeDb / 2) * slope;
                gainBoost = linearBelow * (1 - t) * (1 - t);
            }
            
            const totalGain = gainBoost + gainDb; // Total gain before clamping
            // Clamp total gain to match actual audio processing: -60dB to +20dB
            const clampedTotalGain = Math.max(-60, Math.min(20, totalGain));
            const outputDb = inputDb + clampedTotalGain;
            const x = i;
            const y = ((outputDb + 60) / 60) * height;
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

    updateBoostMeter() {
        const canvas = this.canvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        const meterWidth = 32;

        // Clamp based on ratio: expansion (ratio > 1) or boost (ratio < 1)
        let clampedGb;
        if (this.rt > 1.0) {
            // Expansion mode: clamp to -60dB range
            clampedGb = Math.max(-60, this.gb);
        } else {
            // Boost mode: clamp to +20dB range
            clampedGb = Math.min(20, this.gb);
        }
        const boostHeight = Math.min(height, (Math.abs(clampedGb) / 60) * height);
        if (boostHeight > 0) {
            ctx.fillStyle = '#008000'; // Green color for boost (same as compressor)
            
            // Draw direction based on ratio: boost (ratio > 1) from bottom up, reduction (ratio < 1) from top down
            if (this.rt < 1.0) {
                // Boost: draw from bottom up (current behavior)
                ctx.fillRect(0, height - boostHeight, meterWidth, boostHeight);
            } else {
                // Reduction: draw from top down (same as compressor)
                ctx.fillRect(0, 0, meterWidth, boostHeight);
            }
        }
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'expander-plugin-ui plugin-parameter-ui';

        // Use inherited createParameterControl
        container.appendChild(this.createParameterControl('Threshold', -60, 0, 1, this.th, this.setTh.bind(this), 'dB'));
        container.appendChild(this.createLogarithmicParameterControl('Ratio', 0.05, 20, 0.01, this.rt, this.setRt.bind(this), '1:')); // Logarithmic scale for ratio
        container.appendChild(this.createParameterControl('Attack', 0.1, 100, 0.1, this.at, this.setAt.bind(this), 'ms'));
        container.appendChild(this.createParameterControl('Release', 1, 1000, 1, this.rl, this.setRl.bind(this), 'ms'));
        container.appendChild(this.createParameterControl('Knee', 0, 12, 1, this.kn, this.setKn.bind(this), 'dB'));
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
                    
                    this.updateBoostMeter();
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
        
        // Use a threshold to determine significant gain boost
        const GB_THRESHOLD = 0.05; // 0.05 dB threshold for considering gain boost significant
        
        // Check if there's significant gain boost
        const hasActiveBoost = this.gb > GB_THRESHOLD;
        
        // If there's significant gain boost, we should update
        if (hasActiveBoost) return true;
        
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
            gainBoost: this.gb
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
        this.gb = 0;
        this.lastProcessTime = performance.now() / 1000;
        super.cleanup();
    }
}

window.ExpanderPlugin = ExpanderPlugin;
