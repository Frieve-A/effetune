class TremoloPlugin extends PluginBase {
    constructor() {
        super('Tremolo', 'Volume-based modulation effect');

        this.rt = 10.0;       // rt: Rate - Range: 0.1-50 Hz
        this.dp = 2.0;        // dp: Depth - Range: 0-12 dB
        this.rn = 6.0;        // rn: Randomness - Range: 0-96 dB
        this.rc = 200.0;      // rc: Randomness Cutoff - Range: 1-1000 Hz
        this.rs = -6.0;       // rs: Randomness Slope - Range: -12.0 to 0.0 dB (maps to Q)
        this.cp = 0;          // cp: Channel Phase - Range: -180-180 degrees
        this.cs = 100;        // cs: Channel Sync - Range: 0-100%

        // Register the audio processor
        this.registerProcessor(`
            // Processor entry point
            if (!parameters.enabled) return data; // Exit if disabled

            // Constants
            const TWO_PI = 6.283185307179586;
            const DEG_TO_RAD = 0.017453292519943295;
            const SQRT2 = 1.4142135623730951;
            const MIN_Q = 0.01;

            // Cache parameters locally for performance
            const sampleRate = parameters.sampleRate;
            const blockSize = parameters.blockSize;
            const channelCount = parameters.channelCount;
            const rate = parameters.rt;
            const depth = parameters.dp;
            const randomness = parameters.rn;
            const randomnessCutoff = parameters.rc;
            const randomnessSlope = parameters.rs;
            const channelPhase = parameters.cp;
            const channelSync = parameters.cs;

            // Initialize or ensure context state variables exist. Use Float64Array for numeric states.
            if (context.phase === undefined) context.phase = 0.0;
            if (context.common_x1 === undefined) context.common_x1 = 0.0;
            if (context.common_x2 === undefined) context.common_x2 = 0.0;
            // Ensure channel state arrays are Float64Array and sized correctly. Reinitialize if needed.
            if (context.ch_x1 === undefined || context.ch_x1.length !== channelCount || !(context.ch_x1 instanceof Float64Array)) {
                context.ch_x1 = new Float64Array(channelCount);
            }
            if (context.ch_x2 === undefined || context.ch_x2.length !== channelCount || !(context.ch_x2 instanceof Float64Array)) {
                context.ch_x2 = new Float64Array(channelCount);
            }

            // --- Biquad LPF Coefficients Calculation ---
            // Calculate Q based on slope parameter, using 10**x operator for potential speedup.
            const calculatedQ = (10**((randomnessSlope + 6.0) / 6.0)) * (1.0 / SQRT2);
            const Q = Math.max(MIN_Q, calculatedQ); // Ensure Q is stable

            const fc = randomnessCutoff;
            const fs = sampleRate;
            // Initialize coefficients to pass-through state (b0=1, others=0)
            let norm_b0 = 1.0, norm_b1 = 0.0, norm_b2 = 0.0, norm_a1 = 0.0, norm_a2 = 0.0;

            // Calculate actual filter coefficients if cutoff frequency is valid (0 < fc < fs/2)
            if (fc > 0.0 && fc < fs * 0.5) {
                const omega = TWO_PI * fc / fs;
                const cosOmega = Math.cos(omega); // Calculate once
                const alpha = Math.sin(omega) / (2.0 * Q); // Calculate once

                const a0 = 1.0 + alpha;
                // Check for potential division by zero or near-zero for stability
                if (alpha > 1e-9 && a0 > 1e-9) { // Use small epsilon
                    const a0_inv = 1.0 / a0; // Calculate inverse denominator once
                    const oneMinusCosOmega = 1.0 - cosOmega;

                    norm_b0 = (oneMinusCosOmega * 0.5) * a0_inv;
                    norm_b1 = oneMinusCosOmega * a0_inv;
                    norm_b2 = norm_b0; // LPF: b2 equals b0
                    norm_a1 = (-2.0 * cosOmega) * a0_inv;
                    norm_a2 = (1.0 - alpha) * a0_inv;
                } // else: Coefficients remain in pass-through state
            } // else (fc <= 0 or fc >= fs/2): Coefficients remain in pass-through state

            // --- Pre-calculate Loop Invariants ---
            // Calculate values that don't change within the main processing loop
            const phaseIncrement = TWO_PI * rate / sampleRate;
            const channelPhaseRad = channelPhase * DEG_TO_RAD;
            const syncRatio = channelSync * 0.01;
            const invSyncRatio = 1.0 - syncRatio; // Calculate complementary ratio
            const negDepth = -depth;
            const negRandomnessX2 = -randomness * 2.0; // Pre-calculate factor
            const inv20 = 0.05; // Pre-calculate 1.0 / 20.0 for dB-like to linear conversion

            // Load state variables from context into local variables for faster access in the loop
            let phase = context.phase;
            let common_x1 = context.common_x1;
            let common_x2 = context.common_x2;
            // Get direct references to the Float64Array state buffers
            const ch_x1 = context.ch_x1;
            const ch_x2 = context.ch_x2;

            // --- Main Processing Loop (Iterates over each sample in the block) ---
            for (let i = 0; i < blockSize; ++i) {

                // --- Update Common Phase ---
                phase += phaseIncrement;
                // Wrap phase within [0, 2*PI) using a simple check (often faster than modulo)
                if (phase >= TWO_PI) {
                    phase -= TWO_PI;
                }

                // --- Generate and Filter Common Noise ---
                const noise = Math.random() - 0.5; // White noise [-0.5, 0.5]
                // Apply Biquad LPF using Direct Form II Transposed structure for common noise
                const filteredCommonNoise = norm_b0 * noise + common_x1;
                common_x1 = norm_b1 * noise - norm_a1 * filteredCommonNoise + common_x2;
                common_x2 = norm_b2 * noise - norm_a2 * filteredCommonNoise;

                // --- Process Each Channel ---
                for (let ch = 0; ch < channelCount; ++ch) {
                    const offset = ch * blockSize; // Calculate index offset for the current channel in the data buffer

                    // Calculate per-channel phase, applying channel offset
                    let currentChannelPhase = phase + ch * channelPhaseRad;
                    // Wrap channel phase robustly (handles multiple wraps if necessary)
                    // Note: Simple if (p >= 2PI) p -= 2PI; might suffice if phase increments are small
                    currentChannelPhase = currentChannelPhase - TWO_PI * Math.floor(currentChannelPhase / TWO_PI);

                    // --- Generate and Filter Channel Noise ---
                    const channelNoise = Math.random() - 0.5; // White noise [-0.5, 0.5]
                    // Apply Biquad LPF using Direct Form II Transposed for channel-specific noise
                    const x1_ch = ch_x1[ch]; // Read previous state
                    const x2_ch = ch_x2[ch]; // Read previous state
                    const filteredChannelNoise = norm_b0 * channelNoise + x1_ch;
                    // Update state arrays directly (references context arrays)
                    ch_x1[ch] = norm_b1 * channelNoise - norm_a1 * filteredChannelNoise + x2_ch;
                    ch_x2[ch] = norm_b2 * channelNoise - norm_a2 * filteredChannelNoise;

                    // --- Blend Common and Channel Noise ---
                    // Combine common and channel-specific filtered noise based on sync ratio
                    const finalFilteredNoise = syncRatio * filteredCommonNoise + invSyncRatio * filteredChannelNoise;

                    // --- Calculate Gain ---
                    // Base modulation uses a flipped sine wave shifted to [0, 1] range
                    const baseModulation = (1.0 - Math.sin(currentChannelPhase)) * 0.5;
                    // Noise contribution affects the modulation depth
                    const noiseContribution = finalFilteredNoise * negRandomnessX2;
                    // Combine base modulation and noise, scaled by depth/randomness (in a pseudo-dB scale)
                    const totalModulationDB = baseModulation * negDepth + noiseContribution;
                    // Convert the dB-like value to linear gain using 10**(x/20) equivalent
                    const gain = 10**(totalModulationDB * inv20);

                    // --- Apply Gain ---
                    // Modulate the input audio sample by the calculated gain
                    data[offset + i] *= gain;
                }
            }

            // --- Store Updated State ---
            // Write the final state values back to the context object for the next processing block
            context.phase = phase;
            context.common_x1 = common_x1;
            context.common_x2 = common_x2;
            // context.ch_x1 and context.ch_x2 were modified in-place via references

            // Return the modified audio data buffer
            return data;
        `);
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'tremolo-plugin-ui plugin-parameter-ui';

        // Add parameter controls using the base class method
        container.appendChild(this.createParameterControl('Rate', 0.1, 50, 0.1, this.rt, this.setRt.bind(this), 'Hz'));
        container.appendChild(this.createParameterControl('Depth', 0, 12, 0.1, this.dp, this.setDp.bind(this), 'dB'));
        container.appendChild(this.createParameterControl('Ch Phase', -180, 180, 1, this.cp, this.setCp.bind(this), 'Deg.'));
        container.appendChild(this.createParameterControl('Randomness', 0, 96, 0.1, this.rn, this.setRn.bind(this), 'dB'));
        container.appendChild(this.createParameterControl('Randomness Cutoff', 1, 1000, 1, this.rc, this.setRc.bind(this), 'Hz'));
        container.appendChild(this.createParameterControl('Randomness Slope', -12.0, 0.0, 0.1, this.rs, this.setRs.bind(this), 'dB'));
        container.appendChild(this.createParameterControl('Ch Sync', 0, 100, 1, this.cs, this.setCs.bind(this), '%'));


        return container;
    }

    getParameters() {
        return {
            ...super.getParameters(),
            rt: this.rt,
            dp: this.dp,
            rn: this.rn,
            rc: this.rc,
            rs: this.rs,
            cp: this.cp,
            cs: this.cs
        };
    }

    setParameters(params) {
        if (params.rt !== undefined) {
            this.rt = this.parseFiniteNumber(params.rt, 0.1, 50, this.rt);
        }
        if (params.dp !== undefined) {
            this.dp = this.parseFiniteNumber(params.dp, 0, 12, this.dp);
        }
        if (params.rn !== undefined) {
            this.rn = this.parseFiniteNumber(params.rn, 0, 96, this.rn);
        }
        if (params.rc !== undefined) {
            this.rc = this.parseFiniteNumber(params.rc, 1, 1000, this.rc);
        }
        if (params.rs !== undefined) {
            this.rs = this.parseFiniteNumber(params.rs, -12.0, 0.0, this.rs);
        }
        if (params.cp !== undefined) {
            this.cp = this.parseFiniteNumber(params.cp, -180, 180, this.cp);
        }
        if (params.cs !== undefined) {
            this.cs = this.parseFiniteNumber(params.cs, 0, 100, this.cs);
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }

        this.updateParameters();
    }

    // Set Rate (0.1-50 Hz)
    setRt(value) {
        this.setParameters({ rt: value });
    }

    // Set Depth (0-12 dB)
    setDp(value) {
        this.setParameters({ dp: value });
    }

    // Set Randomness (0-96 dB)
    setRn(value) {
        this.setParameters({ rn: value });
    }

    // Set Randomness Cutoff (1-1000 Hz)
    setRc(value) {
        this.setParameters({ rc: value });
    }

    // Set Randomness Slope (-12.0 to 0.0 dB)
    setRs(value) {
        this.setParameters({ rs: value });
    }

    // Set Channel Phase (-180-180 degrees)
    setCp(value) {
        this.setParameters({ cp: value });
    }

    // Set Channel Sync (0-100%)
    setCs(value) {
        this.setParameters({ cs: value });
    }
}

// Register the plugin
window.TremoloPlugin = TremoloPlugin;
