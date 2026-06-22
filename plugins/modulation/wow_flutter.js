class WowFlutterPlugin extends PluginBase {
    constructor() {
        super('Wow Flutter', 'Time-based modulation effect');

        this.rt = 0.5;        // rt: Rate - Range: 0.1-20 Hz
        this.dp = 6.0;        // dp: Depth - Range: 0-40 ms
        this.rn = 10.0;       // rn: Randomness - Range: 0-40 ms
        this.rc = 5.0;        // rc: Randomness Cutoff - Range: 0.1-20 Hz
        this.rs = -6.0;       // rs: Randomness Slope - Range: -12.0 to 0.0 dB (maps to Q)
        this.cp = 0;          // cp: Channel Phase - Range: -180-180 degrees
        this.cs = 100;        // cs: Channel Sync - Range: 0-100%

        // Register the audio processor
        this.registerProcessor(`
            // Processor entry point
            if (!parameters.enabled) return data; // Exit if disabled

            // --- Parameters ---
            // Destructure parameters for efficient access within the processor scope
            const {
                sampleRate, channelCount, blockSize,
                rt: rate,            // LFO Rate (Hz)
                dp: depth,           // LFO Depth (ms)
                rn: randomness,      // Randomness Amount (ms)
                rc: randomnessCutoff,// Randomness Filter Cutoff (Hz)
                rs: randomnessSlope, // Randomness Filter Slope (-12.0 to 0.0)
                cp: channelPhase,    // Phase offset between channels (degrees)
                cs: channelSync      // Sync between common/channel noise (0-100)
            } = parameters;

            // --- Constants & Pre-calculated Coefficients ---
            // Define constants and pre-calculate values used repeatedly to avoid redundant computations
            const maxBufferSizeRaw = Math.ceil(0.1 * sampleRate); // Max delay buffer size (100ms worth of samples)
            const MAX_BUFFER_SIZE = maxBufferSizeRaw > 0 ? maxBufferSizeRaw : 1;
            const TWO_PI = 6.283185307179586; // Math.PI * 2
            const DEG_TO_RAD = 0.017453292519943295; // Math.PI / 180
            const SQRT2 = 1.4142135623730951;
            const MIN_Q = 0.01; // Minimum Q for Biquad filter stability

            // Pre-calculate loop-invariant values derived from parameters
            const phaseIncrement = TWO_PI * rate / sampleRate;
            const channelPhaseRad = channelPhase * DEG_TO_RAD;
            const syncRatio = channelSync * 0.01; // Convert sync percentage to a ratio [0, 1]
            const oneMinusSyncRatio = 1.0 - syncRatio; // Complementary ratio for noise blending
            const delayMsToSamplesMultiplier = sampleRate * 0.001; // Factor to convert ms to samples

            // --- Context Initialization ---
            // Initialize context variables if they are undefined using nullish coalescing operator (??)
            // Use Float32Array for numeric states where appropriate (matching typical audio data types)
            context.phase = context.phase ?? 0.0;
            context.sampleBufferPos = context.sampleBufferPos ?? 0;
            context.common_x1 = context.common_x1 ?? 0.0; // Biquad state 1 for common noise
            context.common_x2 = context.common_x2 ?? 0.0; // Biquad state 2 for common noise
            // Ensure channel-specific Biquad state arrays are Float32Array and correctly sized
            if (!context.ch_x1 || context.ch_x1.length !== channelCount || !(context.ch_x1 instanceof Float32Array)) {
                context.ch_x1 = new Float32Array(channelCount); // Default value is 0.0
            }
            if (!context.ch_x2 || context.ch_x2.length !== channelCount || !(context.ch_x2 instanceof Float32Array)) {
                context.ch_x2 = new Float32Array(channelCount); // Default value is 0.0
            }

            // Initialize sample delay buffers when the routing or sample-rate derived length changes.
            if (!context.sampleBuffer ||
                context.sampleBuffer.length !== channelCount ||
                context.sampleRate !== sampleRate ||
                context.sampleBufferSize !== MAX_BUFFER_SIZE) {
                context.sampleBuffer = new Array(channelCount);
                for (let ch = 0; ch < channelCount; ++ch) {
                    // Use Float32Array for storing audio samples in the delay line
                    context.sampleBuffer[ch] = new Float32Array(MAX_BUFFER_SIZE); // Default value is 0.0
                }
                context.phase = 0.0;
                context.sampleBufferPos = 0;
                context.common_x1 = 0.0;
                context.common_x2 = 0.0;
                context.ch_x1.fill(0.0);
                context.ch_x2.fill(0.0);
                context.sampleRate = sampleRate;
                context.sampleBufferSize = MAX_BUFFER_SIZE;
                context.initialized = true;
            }

            // --- Calculate Biquad LPF Coefficients ---
            // Calculate filter Q value based on the randomnessSlope parameter using 10**x operator
            const calculatedQ = (10**((randomnessSlope + 6.0) / 6.0)) * (1.0 / SQRT2);
            const Q = calculatedQ < MIN_Q ? MIN_Q : calculatedQ; // Clamp Q to ensure minimum stability

            const fc = randomnessCutoff;
            const fs = sampleRate;
            // Initialize coefficients to a pass-through state (b0=1, others=0)
            let norm_b0 = 1.0, norm_b1 = 0.0, norm_b2 = 0.0, norm_a1 = 0.0, norm_a2 = 0.0;

            // Calculate actual LPF coefficients if the cutoff frequency is within the valid range (0 < fc < fs/2)
            if (fc > 0.0 && fc < fs * 0.5) {
                const omega = TWO_PI * fc / fs;
                const cosOmega = Math.cos(omega); // Pre-calculate cos(omega)
                const alpha = Math.sin(omega) / (2.0 * Q); // Calculate alpha term
                const a0 = 1.0 + alpha; // Denominator term

                // Check for stability (avoid division by zero or near-zero) before calculating coefficients
                if (alpha > 1e-9 && a0 > 1e-9) { // Use a small epsilon for robustness
                    const a0_inv = 1.0 / a0; // Calculate inverse denominator once
                    const oneMinusCosOmega = 1.0 - cosOmega; // Calculate difference once
                    norm_b0 = (oneMinusCosOmega * 0.5) * a0_inv;
                    norm_b1 = oneMinusCosOmega * a0_inv;
                    norm_b2 = norm_b0; // For LPF, b2 equals b0
                    norm_a1 = (-2.0 * cosOmega) * a0_inv;
                    norm_a2 = (1.0 - alpha) * a0_inv;
                } // else: Coefficients remain in the initial pass-through state
            } else if (fc <= 0.0) {
                // If filter is effectively bypassed (cutoff at 0Hz), reset filter states to zero
                // This prevents stale state values from affecting the signal if the filter is re-enabled later
                context.common_x1 = 0.0; context.common_x2 = 0.0;
                context.ch_x1.fill(0.0); context.ch_x2.fill(0.0);
            } // else (fc >= fs/2): Coefficients remain pass-through due to potential instability or aliasing


            // --- Local State Variables ---
            // Load state from context into local variables for faster access within the main loop
            let currentPhase = context.phase;
            let bufferPos = context.sampleBufferPos;
            const sampleBuffers = context.sampleBuffer; // Reference to the array of Float32Arrays (delay lines)
            // Cache Biquad state variables locally
            let common_x1 = context.common_x1;
            let common_x2 = context.common_x2;
            const ch_x1 = context.ch_x1; // Reference to the Float32Array for channel state 1
            const ch_x2 = context.ch_x2; // Reference to the Float32Array for channel state 2

            // --- Main Processing Loop (Iterates over each sample in the block) ---
            for (let i = 0; i < blockSize; ++i) {

                // Update base LFO phase and wrap it within [0, 2*PI)
                currentPhase += phaseIncrement;
                if (currentPhase >= TWO_PI) {
                    currentPhase -= TWO_PI;
                }

                // Generate and filter the common noise component using the Biquad LPF
                const commonNoise = Math.random() - 0.5; // Generate white noise [-0.5, 0.5]
                // Apply filter using Direct Form II Transposed structure (efficient for state updates)
                const filteredCommonNoise = norm_b0 * commonNoise + common_x1;
                common_x1 = norm_b1 * commonNoise - norm_a1 * filteredCommonNoise + common_x2; // Update state 1
                common_x2 = norm_b2 * commonNoise - norm_a2 * filteredCommonNoise; // Update state 2

                // --- Channel Loop (Process each audio channel independently) ---
                for (let ch = 0; ch < channelCount; ++ch) {
                    const buffer = sampleBuffers[ch]; // Get the delay buffer for the current channel
                    const offset = ch * blockSize; // Calculate index offset for input/output data buffer

                    // Store the current input sample into the circular delay buffer at the write position
                    buffer[bufferPos] = data[offset + i];

                    // Calculate the channel-specific phase by adding the channel offset
                    let currentChannelPhase = currentPhase + ch * channelPhaseRad;
                    // Wrap the channel phase robustly to handle potential large offsets or increments
                    currentChannelPhase = currentChannelPhase - TWO_PI * Math.floor(currentChannelPhase / TWO_PI);

                    // Generate and filter the channel-specific noise component
                    const channelNoise = Math.random() - 0.5; // Generate white noise [-0.5, 0.5]
                    // Apply Biquad LPF using Direct Form II Transposed, accessing channel-specific states
                    const x1_ch = ch_x1[ch]; // Read state 1 for this channel
                    const x2_ch = ch_x2[ch]; // Read state 2 for this channel
                    const filteredChannelNoise = norm_b0 * channelNoise + x1_ch;
                    ch_x1[ch] = norm_b1 * channelNoise - norm_a1 * filteredChannelNoise + x2_ch; // Update state 1
                    ch_x2[ch] = norm_b2 * channelNoise - norm_a2 * filteredChannelNoise; // Update state 2

                    // Blend the common and channel-specific filtered noise based on the syncRatio
                    // Shift the blended noise range from [-0.5, 0.5] to [0, 1] for delay calculation
                    const filteredNoise = syncRatio * filteredCommonNoise + oneMinusSyncRatio * filteredChannelNoise + 0.5;

                    // --- Calculate Delay Time ---
                    // Base delay modulated by the LFO (sine wave shifted and scaled to [0, 1])
                    const baseDelay = (1.0 - Math.sin(currentChannelPhase)) * 0.5;
                    // Noise contribution to the delay, scaled by the randomness parameter
                    const noiseContribution = filteredNoise * randomness; // Noise [0, 1] -> contribution [0, randomness] ms
                    // Calculate the total delay in milliseconds, scaled by depth and randomness
                    const totalDelayMs = baseDelay * depth + noiseContribution;

                    // --- Apply Delay ---
                    // Convert total delay from milliseconds to fractional samples
                    const delaySamples = totalDelayMs * delayMsToSamplesMultiplier;

                    // Calculate the read position in the circular buffer by subtracting the delay
                    const readPos = bufferPos - delaySamples;

                    // Wrap the read position correctly within the buffer bounds [0, MAX_BUFFER_SIZE)
                    // This handles both positive and negative wrap-around efficiently.
                    let wrappedReadPos = readPos % MAX_BUFFER_SIZE;
                    if (wrappedReadPos < 0) {
                        wrappedReadPos += MAX_BUFFER_SIZE; // Ensure positive index if modulo result is negative
                    }

                    // Calculate integer and fractional parts for linear interpolation
                    const readPosInt = Math.floor(wrappedReadPos); // Integer part gives the index of the first sample
                    const readPosFrac = wrappedReadPos - readPosInt; // Fractional part gives the interpolation weight

                    // Determine the index of the next sample, handling wrap-around at the buffer end
                    let nextPos = readPosInt + 1;
                    if (nextPos >= MAX_BUFFER_SIZE) {
                        nextPos = 0; // Wrap around to the start of the buffer
                    }

                    // Perform linear interpolation between the two nearest samples in the delay buffer
                    const sample1 = buffer[readPosInt];    // Sample at the integer index
                    const sample2 = buffer[nextPos];      // Sample at the next index
                    const interpolatedSample = sample1 + readPosFrac * (sample2 - sample1); // Interpolated value

                    // Write the interpolated (delayed) sample to the output data buffer
                    data[offset + i] = interpolatedSample;
                }

                // Increment the circular buffer write position for the next sample
                bufferPos++;
                // Wrap the write position around if it reaches the end of the buffer
                if (bufferPos >= MAX_BUFFER_SIZE) {
                    bufferPos = 0;
                }
            }

            // --- Update Context State ---
            // Store the final state values back into the context object for the next processing block
            context.phase = currentPhase;
            context.sampleBufferPos = bufferPos;
            context.common_x1 = common_x1; // Store updated common Biquad state 1
            context.common_x2 = common_x2; // Store updated common Biquad state 2
            // Channel-specific Biquad states (context.ch_x1, context.ch_x2) were updated in-place via array references

            // Return the modified output data buffer
            return data;
        `);
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'wow-flutter-plugin-ui plugin-parameter-ui';

        // Add parameter controls using the base class helper
        container.appendChild(this.createParameterControl('Rate', 0.1, 20, 0.1, this.rt, this.setRt.bind(this), 'Hz'));
        container.appendChild(this.createParameterControl('Depth', 0, 40, 0.1, this.dp, this.setDp.bind(this), 'ms'));
        container.appendChild(this.createParameterControl('Ch Phase', -180, 180, 1, this.cp, this.setCp.bind(this), 'Deg.'));
        container.appendChild(this.createParameterControl('Randomness', 0, 40, 0.1, this.rn, this.setRn.bind(this), 'ms'));
        container.appendChild(this.createParameterControl('Randomness Cutoff', 0.1, 20, 0.1, this.rc, this.setRc.bind(this), 'Hz'));
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
            rs: this.rs, // Include new parameter rs
            cp: this.cp,
            cs: this.cs
        };
    }

    setParameters(params) {
        if (params.rt !== undefined) {
            this.rt = this.parseFiniteNumber(params.rt, 0.1, 20, this.rt);
        }
        if (params.dp !== undefined) {
            this.dp = this.parseFiniteNumber(params.dp, 0, 40, this.dp);
        }
        if (params.rn !== undefined) {
            this.rn = this.parseFiniteNumber(params.rn, 0, 40, this.rn);
        }
        if (params.rc !== undefined) {
            this.rc = this.parseFiniteNumber(params.rc, 0.1, 20, this.rc);
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

    // Set Rate (0.1-20 Hz)
    setRt(value) {
        this.setParameters({ rt: value });
    }

    // Set Depth (0-40 ms)
    setDp(value) {
        this.setParameters({ dp: value });
    }

    // Set Randomness (0-40 ms)
    setRn(value) {
        this.setParameters({ rn: value });
    }

    // Set Randomness Cutoff (0.1-20 Hz)
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
window.WowFlutterPlugin = WowFlutterPlugin;
