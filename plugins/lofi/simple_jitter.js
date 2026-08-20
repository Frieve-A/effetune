class SimpleJitterPlugin extends PluginBase {
    constructor() {
        super('Simple Jitter', 'Digital jitter simulation effect');
        
        // rj: RMS Jitter (formerly rmsJitter) - Default: 100 (100ns)
        this.rj = 100;

        // Register the audio processor
        this.registerProcessor(`
            // Early exit if disabled
            if (!parameters.enabled) return data;

            // --- Parameter & Context Destructuring ---
            const { channelCount, blockSize, sampleRate, rj: rmsJitterParam } = parameters; // Use descriptive names

            // --- Constants ---
            const MIN_JITTER_NS = 0.001;    // Minimum jitter in nanoseconds (1 picosecond)
            // const MAX_JITTER_NS = 10000000; // Maximum jitter (10ms) - Not used in original logic
            const NS_PER_SEC = 1e9;         // Nanoseconds per second
            const SQRT3 = 1.7320508075688772; // Precomputed Math.sqrt(3.0) for RMS normalization

            // --- Context Initialization & Reset ---
            // Calculate required buffer size based on 20ms and current sample rate
            // Use bitwise OR for flooring positive results (potentially faster than Math.ceil)
            const requiredBufferSize = (0.02 * sampleRate + 0.999) | 0;

            // Check if reset is needed (first init, sample rate change, channel count change)
            const needsReset = !context.initialized ||
                               context.bufferSize !== requiredBufferSize ||
                               context.sampleBuffer?.length !== channelCount;

            if (needsReset) {
                context.bufferSize = requiredBufferSize;
                context.sampleBuffer = new Array(channelCount);
                for (let ch = 0; ch < channelCount; ch++) {
                    // Allocate new Float32Array for each channel's buffer
                    context.sampleBuffer[ch] = new Float32Array(requiredBufferSize);
                    // Filling with 0 is implicit for new Float32Array, matching original intent
                }

                // Reset buffer position only on first initialization or if buffer size changes
                // Preserve position if only channel count changes but size remains the same
                if (!context.initialized || context.bufferSize !== requiredBufferSize) {
                    context.sampleBufferPos = 0;
                }
                 // Safety check: Ensure position is valid after potential changes
                if (context.sampleBufferPos >= requiredBufferSize || context.sampleBufferPos < 0 || !Number.isFinite(context.sampleBufferPos)) {
                     context.sampleBufferPos = 0;
                }

                context.initialized = true;
            }

            // --- Pre-calculation before Sample Loop ---
            const currentBufferSize = context.bufferSize; // Cache buffer size from context
            // Precompute conversion factor from nanoseconds to samples
            const nsToSamplesFactor = sampleRate / NS_PER_SEC;

            // Calculate RMS jitter in nanoseconds (logarithmic scale)
            // Clamp parameter to avoid potential issues with extreme values in Math.pow
            const floatRmsJitterParam = Math.fround(rmsJitterParam);
            const clampedRmsJitterParam = (floatRmsJitterParam < -200) ? -200 : (floatRmsJitterParam > 200 ? 200 : floatRmsJitterParam);
            const rmsJitterNs = MIN_JITTER_NS * Math.pow(10, clampedRmsJitterParam / 20.0);

            // Combine jitter scaling factors (RMS normalization * RMS value)
            const targetJitterScale = rmsJitterNs * SQRT3;
            const rampFrames = Math.max(1, Math.ceil(sampleRate * 0.005));
            if (context.currentJitterScale === undefined) {
                context.currentJitterScale = targetJitterScale;
                context.targetJitterScale = targetJitterScale;
                context.jitterRampRemaining = 0;
            } else if (context.targetJitterScale !== targetJitterScale) {
                context.targetJitterScale = targetJitterScale;
                context.jitterScaleStep = (targetJitterScale - context.currentJitterScale) / rampFrames;
                context.jitterRampRemaining = rampFrames;
            }

            // Cache context buffer position locally for modification within the loop
            let currentBufferPos = context.sampleBufferPos;

            // --- Sample Loop ---
            for (let i = 0; i < blockSize; i++) {
                if (context.jitterRampRemaining > 0) {
                    context.currentJitterScale += context.jitterScaleStep;
                    if (--context.jitterRampRemaining === 0) context.currentJitterScale = context.targetJitterScale;
                }
                // Generate random value [0, 1)
                const randomValue = Math.random();
                // Ensure positive value (though Math.random is always non-negative) - matching original code's structure
                const positiveRandom = (randomValue >= 0.0) ? randomValue : -randomValue;

                // Calculate jitter amount for this sample in nanoseconds
                const jitterNs = positiveRandom * context.currentJitterScale;
                // Convert jitter to samples
                const jitterSamples = jitterNs * nsToSamplesFactor;

                // Calculate delayed read position (floating point) including buffer wrap-around
                // Use the original modulo logic which handles potential negative results implicitly
                // Assuming '%' operator is reasonably efficient or unavoidable for float modulo
                const delayPosFloat = (currentBufferPos - jitterSamples + currentBufferSize) % currentBufferSize;

                // Calculate integer and fractional parts for interpolation
                // Use bitwise OR for floor as delayPosFloat is guaranteed non-negative after modulo
                const delayPosInt = delayPosFloat | 0;
                const delayPosFrac = delayPosFloat - delayPosInt; // Fractional part

                // Calculate index of the next sample for interpolation (circular wrap-around)
                let nextPos = delayPosInt + 1;
                // Use strict equality check for wrap-around (potentially faster)
                if (nextPos === currentBufferSize) {
                    nextPos = 0;
                }

                // --- Channel Loop ---
                for (let ch = 0; ch < channelCount; ch++) {
                    const buffer = context.sampleBuffer[ch]; // Cache buffer for this channel
                    // Calculate the index in the interleaved input/output data array
                    const dataIndex = ch * blockSize + i;

                    // Store current input sample into the circular buffer at the write position
                    const inputSample = data[dataIndex];
                    buffer[currentBufferPos] = inputSample;

                    // Perform linear interpolation using the calculated read positions
                    const sample1 = buffer[delayPosInt];
                    const sample2 = buffer[nextPos];
                    // Optimized interpolation formula: s1 + frac * (s2 - s1)
                    const interpolatedSample = sample1 + delayPosFrac * (sample2 - sample1);

                    // Write the interpolated (jittered) sample to the output data array
                    data[dataIndex] = interpolatedSample;
                } // End channel loop

                // Update buffer write position (circular wrap-around)
                currentBufferPos++;
                if (currentBufferPos === currentBufferSize) { // Use strict equality check
                    currentBufferPos = 0;
                }
            } // End sample loop

            // --- Update Context ---
            // Store the final buffer write position back into the context
            context.sampleBufferPos = currentBufferPos;

            // Return the modified data array
            return data;
        `);
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'simple-jitter-plugin-ui plugin-parameter-ui';

        // RMS Jitter parameter row
        const jitterRow = document.createElement('div');
        jitterRow.className = 'parameter-row';
        
        const jitterSliderId = `${this.id}-${this.name}-jitter-slider`;
        const jitterLabel = document.createElement('label');
        jitterLabel.textContent = 'RMS Jitter:';
        jitterLabel.htmlFor = jitterSliderId;
        
        const jitterSlider = document.createElement('input');
        jitterSlider.type = 'range';
        jitterSlider.id = jitterSliderId;
        jitterSlider.name = jitterSliderId;
        jitterSlider.min = '0';
        jitterSlider.max = '200';
        jitterSlider.step = '1';
        jitterSlider.value = this.rj;
        jitterSlider.autocomplete = "off";
        
        const jitterValue = document.createElement('span');
        jitterValue.className = 'parameter-value';
        jitterValue.textContent = this.getDisplayValue();

        jitterSlider.addEventListener('input', (e) => {
            this.setRj(parseFloat(e.target.value));
            jitterValue.textContent = this.getDisplayValue();
        });

        jitterRow.appendChild(jitterLabel);
        jitterRow.appendChild(jitterSlider);
        jitterRow.appendChild(jitterValue);

        container.appendChild(jitterRow);

        // Automation playback and preset recall change the model without touching the
        // DOM, so the slider this plugin builds by hand is refreshed here. A slider the
        // user is dragging is left alone, matching how syncUIControls() treats the
        // helper-built controls.
        this.registerUIRefresh(() => {
            if (this.isHeldByUser(jitterSlider)) return;
            jitterSlider.value = this.rj;
            window.uiManager?.refreshRangeFillStyling?.(jitterSlider);
            jitterValue.textContent = this.getDisplayValue();
        });

        return container;
    }

    getDisplayValue() {
        const MIN_JITTER_NS = 0.001; // 1ps
        const rmsJitterNs = MIN_JITTER_NS * Math.pow(10, this.rj / 20);
        
        // Display with appropriate unit
        if (rmsJitterNs < 1) {
            return (rmsJitterNs * 1000).toFixed(3) + ' ps';
        } else if (rmsJitterNs < 1000) {
            return rmsJitterNs.toFixed(3) + ' ns';
        } else if (rmsJitterNs < 1000000) {
            return (rmsJitterNs / 1000).toFixed(3) + ' μs';
        } else {
            return (rmsJitterNs / 1000000).toFixed(3) + ' ms';
        }
    }

    getParameters() {
        return {
            ...super.getParameters(),
            rj: this.rj
        };
    }

    setParameters(params) {
        if (params.rj !== undefined) {
            this.rj = params.rj < 0 ? 0 : (params.rj > 200 ? 200 : params.rj);
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }

        this.updateParameters();
    }

    // Set RMS Jitter value (0-200)
    setRj(value) {
        this.setParameters({ rj: value });
    }
}

// Register the plugin
window.SimpleJitterPlugin = SimpleJitterPlugin;
