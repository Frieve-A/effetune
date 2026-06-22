class AutoLevelerPlugin extends PluginBase {
    constructor() {
        super('Auto Leveler', 'Automatic level control based on LUFS measurement');

        // Initialize parameters with default values
        this.tg = -18.0;  // tg: Target LUFS (-36.0 to 0.0 dB)
        this.tw = 3000;   // tw: Time Window (1000 to 10000 ms)
        this.mg = 0.0;    // mg: Max Gain (0.0 to 12.0 dB)
        this.ng = -12.0;  // ng: Min Gain (-36.0 to 0.0 dB)
        this.at = 50;     // at: Attack Time (1 to 1000 ms)
        this.rt = 5000;   // rt: Release Time (10 to 10000 ms)
        this.gt = -60;    // gt: Noise Gate (-96 to -24 dB)

        // Internal state
        this.currentGain = 1.0;
        this.lastProcessTime = performance.now() / 1000;

        // Graph state
        this.canvas = null;
        this.canvasCtx = null;
        this.boundEventListeners = new Map();
        this.animationFrameId = null;

        // LUFS history buffers (1024 points) initialized with NaN so that no initial bottom line is drawn
        this.inputLufsBuffer = new Float32Array(1024).fill(NaN);
        this.outputLufsBuffer = new Float32Array(1024).fill(NaN);
        this.secondMarkers = [];
        this.prevTime = null;

        this.observer = null;

        this.registerProcessor(`
            // Audio Processor
            const BLOCK_SIZE = parameters.blockSize;
            const CHANNEL_COUNT = parameters.channelCount;
            const SAMPLE_RATE = parameters.sampleRate;

            // Skip processing if disabled
            if (!parameters.enabled) {
                // Return the input data directly
                return data;
            }

            const windowSamplesRaw = Math.floor((parameters.tw / 1000) * SAMPLE_RATE);
            const windowSamples = windowSamplesRaw > 0 ? windowSamplesRaw : 1;

            // Initialize or reset context state if needed
            if (!context.initialized ||
                context.sampleRate !== SAMPLE_RATE ||
                context.channelCount !== CHANNEL_COUNT ||
                context.blockSize !== BLOCK_SIZE ||
                context.windowSamples !== windowSamples) {
                context.buffer = new Float32Array(windowSamples);
                context.bufferIndex = 0;
                context.bufferFilled = false;
                context.sampleRate = SAMPLE_RATE;
                context.channelCount = CHANNEL_COUNT;
                context.blockSize = BLOCK_SIZE;
                context.windowSamples = windowSamples;
                context.sum = 0;
                context.currentGain = 1.0;
                // K-weighting filter state
                context.kfilter = {
                    pre: { x1: 0, x2: 0, y1: 0, y2: 0 },
                    shelf: { x1: 0, x2: 0, y1: 0, y2: 0 }
                };
                context.monoBuffer = new Float32Array(BLOCK_SIZE);
                context.weightedBuffer = new Float32Array(BLOCK_SIZE);
                context.initialized = true;
                context.lastLufs = -144;
                context.lastOutputLufs = -144;
                // Pre-compute linear thresholds
                context.noiseGateLinear = Math.pow(10, parameters.gt / 10);
                context.targetLufsLinear = Math.pow(10, parameters.tg / 10);
            }

            // Per-block processing
            const noiseGateLinear = Math.pow(10, parameters.gt / 10);
            const targetLufsLinear = Math.pow(10, parameters.tg / 10);
            const attackSamplesRaw = (parameters.at * SAMPLE_RATE) / 1000;
            const attackSamples = attackSamplesRaw < 1 ? 1 : attackSamplesRaw;
            const releaseSamplesRaw = (parameters.rt * SAMPLE_RATE) / 1000;
            const releaseSamples = releaseSamplesRaw < 1 ? 1 : releaseSamplesRaw;
            // Calculate (1 - coeff) only once
            const attackCoeff = Math.exp(-Math.LN2 / attackSamples);
            const releaseCoeff = Math.exp(-Math.LN2 / releaseSamples);
            const attackCoeffInv = 1.0 - attackCoeff;
            const releaseCoeffInv = 1.0 - releaseCoeff;
            const maxGainLinear = Math.pow(10, parameters.mg / 20);
            const minGainLinear = Math.pow(10, parameters.ng / 20);

            // Define K-weighting filter coefficients
            // Pre-filter (high-pass filter)
            const preB0 = 1.0, preB1 = -2.0, preB2 = 1.0;
            const preA1 = -1.99004745483398, preA2 = 0.99007225036621;
            // Shelf filter (high-frequency boost)
            const shelfB0 = 1.53512485958697, shelfB1 = -2.69169618940638, shelfB2 = 1.19839281085285;
            const shelfA1 = -1.69065929318241, shelfA2 = 0.73248077421585;

            // Get references to context arrays/state
            const monoBuffer = context.monoBuffer;
            const weightedBuffer = context.weightedBuffer;
            const kFilterPreState = context.kfilter.pre;
            const kFilterShelfState = context.kfilter.shelf;
            const lufsBuffer = context.buffer;

            // Step 1: Create mono mix
            monoBuffer.fill(0); // Clear buffer first
            if (CHANNEL_COUNT > 0) {
                const scale = 1.0 / CHANNEL_COUNT;
                for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
                    const offset = ch * BLOCK_SIZE;
                    if (scale === 1.0) { // Single channel case
                        for (let i = 0; i < BLOCK_SIZE; i++) {
                            monoBuffer[i] += data[offset + i];
                        }
                    } else {
                        for (let i = 0; i < BLOCK_SIZE; i++) {
                            monoBuffer[i] += data[offset + i] * scale;
                        }
                    }
                }
            }
            // If CHANNEL_COUNT === 0, monoBuffer remains 0.

            // Step 2: Apply K-weighting filters

            function processBlockBiquad(input, output, state, b0, b1, b2, a1, a2) {
                const len = input.length; // BLOCK_SIZE

                // Use local variables for state
                let x1 = state.x1, x2 = state.x2, y1 = state.y1, y2 = state.y2;

                // Process in chunks of 4 samples (Loop unrolling)
                const mainLoopEnd = len - (len % 4);
                let i = 0;
                for (; i < mainLoopEnd; i += 4) {
                    // Sample 1
                    let x0 = input[i];
                    let y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
                    output[i] = y0;

                    // Sample 2 (using updated state from Sample 1)
                    let x_1 = input[i + 1]; // Use x_ notation to avoid shadowing
                    let y_1 = b0 * x_1 + b1 * x0 + b2 * x1 - a1 * y0 - a2 * y1;
                    output[i + 1] = y_1;

                    // Sample 3 (using updated state from Sample 2)
                    let x_2 = input[i + 2];
                    let y_2 = b0 * x_2 + b1 * x_1 + b2 * x0 - a1 * y_1 - a2 * y0;
                    output[i + 2] = y_2;

                    // Sample 4 (using updated state from Sample 3)
                    let x_3 = input[i + 3];
                    let y_3 = b0 * x_3 + b1 * x_2 + b2 * x_1 - a1 * y_2 - a2 * y_1;
                    output[i + 3] = y_3;

                    // Update state variables for the next iteration (based on Sample 4)
                    x2 = x_2; x1 = x_3; y2 = y_2; y1 = y_3;
                }

                // Handle remaining samples (0 to 3 samples)
                for (; i < len; i++) {
                    const x = input[i];
                    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
                    x2 = x1; x1 = x; y2 = y1; y1 = y; // Update state
                    output[i] = y;
                }

                // Save state back to the object
                state.x1 = x1; state.x2 = x2; state.y1 = y1; state.y2 = y2;
            }

            // Apply K-weighting filters in sequence using the function
            processBlockBiquad(monoBuffer, weightedBuffer, kFilterPreState, preB0, preB1, preB2, preA1, preA2);
            processBlockBiquad(weightedBuffer, weightedBuffer, kFilterShelfState, shelfB0, shelfB1, shelfB2, shelfA1, shelfA2);

            // Step 3 & 4: LUFS Update
            let sumChange = 0;
            const startBufferIndex = context.bufferIndex;
            let bufferFilled = context.bufferFilled; // Cache locally

            for (let i = 0; i < BLOCK_SIZE; i++) {
                const weightedSample = weightedBuffer[i];
                const weightedSquare = weightedSample * weightedSample;

                // Determine the index in the circular buffer to update
                const bufferIndexToUpdate = (startBufferIndex + i) % windowSamples;

                // Update sum: subtract old value, add new value
                sumChange -= lufsBuffer[bufferIndexToUpdate];
                sumChange += weightedSquare;

                // Store the new squared value in the buffer
                lufsBuffer[bufferIndexToUpdate] = weightedSquare;
            }

            // Update context sum and buffer index *after* the loop
            let currentSum = context.sum + sumChange;
            context.sum = currentSum;
            const endBufferIndex = (startBufferIndex + BLOCK_SIZE) % windowSamples;
            context.bufferIndex = endBufferIndex;

            // Update bufferFilled status - check if wrap-around occurred during this block
            if (!bufferFilled && BLOCK_SIZE > 0 && endBufferIndex <= startBufferIndex) {
                 // If end index is <= start index (and we processed > 0 samples), we must have wrapped.
                 // Note: <= covers the case where blockSize is an exact multiple of windowSamples.
                 bufferFilled = true;
                 context.bufferFilled = true; // Update context state
            }

            // Calculate current LUFS (linear and dB)
            let currentLufsLinear = 0; // Use local var
            // Use the locally cached bufferFilled status
            const validSamples = bufferFilled ? windowSamples : endBufferIndex; // Use endBufferIndex for count if not filled
            if (validSamples > 0 && currentSum > 0) {
                currentLufsLinear = currentSum / validSamples; // Use updated sum
            } else if (currentSum <= 0) {
                // Handle non-positive sum edge case explicitly if needed, otherwise it remains 0
                currentLufsLinear = 0; // Or a very small positive number if log10 needs it? Original implies 0 is okay.
            }

            // Convert to dB LUFS for measurement output later
            let currentLUFS = -144; // Default/minimum value
            if (currentLufsLinear > 0) {
                 // LUFS = 10 * log10(mean square) - 0.691
                 currentLUFS = 10 * Math.log10(currentLufsLinear) - 0.691;
            }
            context.lastLufs = currentLUFS; // Store potentially clamped LUFS


            // Step 5: Calculate target gain
            let targetGainLinear; // Use local var
            // Compare against the pre-calculated noiseGateLinear
            if (currentLufsLinear < noiseGateLinear || currentLufsLinear <= 0) {
                targetGainLinear = 1.0; // Below noise gate threshold, no gain change
            } else {
                // In linear domain: targetGain = sqrt(targetLevel / currentLevel)
                targetGainLinear = Math.sqrt(targetLufsLinear / currentLufsLinear);
            }

            // Apply min/max gain limits - Use local pre-calculated limits
            // Apply min/max gain limits
            targetGainLinear = targetGainLinear > maxGainLinear ? maxGainLinear :
                              (targetGainLinear < minGainLinear ? minGainLinear : targetGainLinear);


            // Step 6 & 7: Gain Smoothing and Application

            const result = new Float32Array(data.length); // Allocate output buffer
            let currentGain = context.currentGain; // Get initial gain for the block

            // Process sample by sample, applying smoothed gain to all channels
            for (let i = 0; i < BLOCK_SIZE; i++) {
                // Determine smoothing coefficient (attack or release)
                const useAttack = targetGainLinear < currentGain;
                const coeff = useAttack ? attackCoeff : releaseCoeff;
                const coeffInv = useAttack ? attackCoeffInv : releaseCoeffInv;

                // Calculate smoothed gain for this sample
                currentGain = currentGain * coeff + targetGainLinear * coeffInv;

                // Apply this gain to all channels for the current sample
                for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
                    const offset = ch * BLOCK_SIZE;
                    result[offset + i] = data[offset + i] * currentGain;
                }
            }

            // Store the final gain value for the next block's starting point
            context.currentGain = currentGain;

            // Compute output LUFS for measurement only (using the *final* gain of the block)
            // This matches the original's calculation method.
            let outputLufs = -144; // Default/minimum
            // Use the dB LUFS calculated earlier (currentLUFS)
            if (currentLUFS > -144 && currentGain > 0) { // Check if input LUFS was valid & gain is positive
                 // Output LUFS = Input LUFS (dB) + Gain (dB)
                 outputLufs = currentLUFS + 20 * Math.log10(currentGain);
                 // Clamp to minimum - match original check
                 if (outputLufs < -144) {
                    outputLufs = -144;
                 }
            } else if (currentLUFS <= -144) {
                 // If input LUFS was at minimum, output LUFS is also minimum
                 outputLufs = -144;
            }
            context.lastOutputLufs = outputLufs;


            // --- Final Step: Attach Measurements ---
            // Use the locally determined 'validSamples' count for the check
            if (validSamples > 0) {
                result.measurements = {
                    inputLufs: context.lastLufs,    // Use the value stored in context
                    outputLufs: context.lastOutputLufs, // Use the value stored in context
                    time: time // 'time' is assumed available in this scope (processor input)
                };
            }

            return result;
        `);
    }

    onMessage(message) {
        if (message.type === 'processBuffer' && message.measurements) {
            // Shift history buffers
            this.inputLufsBuffer.copyWithin(0, 1);
            this.outputLufsBuffer.copyWithin(0, 1);

            // Shift marker positions
            this.secondMarkers = this.secondMarkers.map(v => v - 1).filter(v => v >= 0);

            const t = message.measurements.time;
            if (this.prevTime !== null && !Number.isNaN(t) && Math.floor(this.prevTime) !== Math.floor(t)) {
                this.secondMarkers.push(this.inputLufsBuffer.length - 1);
            }
            this.prevTime = t;

            // Store LUFS values
            this.inputLufsBuffer[this.inputLufsBuffer.length - 1] = message.measurements.inputLufs;
            this.outputLufsBuffer[this.outputLufsBuffer.length - 1] = message.measurements.outputLufs;
        }
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            tg: this.tg,
            tw: this.tw,
            mg: this.mg,
            ng: this.ng,
            at: this.at,
            rt: this.rt,
            gt: this.gt
        };
    }

    setParameters(params) {
        if (params.tg !== undefined) {
            this.tg = this.parseFiniteNumber(params.tg, -36.0, 0.0, this.tg);
        }
        if (params.tw !== undefined) {
            this.tw = this.parseFiniteNumber(params.tw, 1000, 10000, this.tw);
        }
        if (params.mg !== undefined) {
            this.mg = this.parseFiniteNumber(params.mg, 0.0, 12.0, this.mg);
        }
        if (params.ng !== undefined) {
            this.ng = this.parseFiniteNumber(params.ng, -36.0, 0.0, this.ng);
        }
        if (params.at !== undefined) {
            this.at = this.parseFiniteNumber(params.at, 1, 1000, this.at);
        }
        if (params.rt !== undefined) {
            this.rt = this.parseFiniteNumber(params.rt, 10, 10000, this.rt);
        }
        if (params.gt !== undefined) {
            this.gt = this.parseFiniteNumber(params.gt, -96, -24, this.gt);
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        this.updateParameters();
    }

    // Individual parameter setters
    setTg(value) { this.setParameters({ tg: value }); }
    setTw(value) { this.setParameters({ tw: value }); }
    setMg(value) { this.setParameters({ mg: value }); }
    setNg(value) { this.setParameters({ ng: value }); }
    setAt(value) { this.setParameters({ at: value }); }
    setRt(value) { this.setParameters({ rt: value }); }
    setGt(value) { this.setParameters({ gt: value }); }

    handleIntersect(entries) {
        entries.forEach(entry => {
            this.isVisible = entry.isIntersecting;
            if (this.isVisible) {
                this.startAnimation();
            } else {
                this.stopAnimation();
            }
        });
    }

    startAnimation() {
        if (!this.enabled || !this._sectionEnabled) return;
        if (this.animationFrameId) return;

        const animate = () => {
            if (!this.isVisible) {
                this.stopAnimation();
                return;
            }
            this.drawGraph();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        animate();
    }

    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    drawGraph() {
        if (!this.canvasCtx) return;
        const ctx = this.canvasCtx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        // Draw grid lines and labels
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.textAlign = 'right';
        ctx.font = '24px Arial';
        ctx.fillStyle = '#ccc';

        // Draw horizontal grid lines (6dB steps from -42dB to -6dB)
        for (let db = -42; db <= -6; db += 6) {
            const y = height * (1 - (db + 48) / 48);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            ctx.fillText(`${db}`, 160, y + 12);
        }

        // Draw axis labels
        ctx.save();
        ctx.font = '28px Arial';
        ctx.translate(40, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('LUFS (dB)', 0, 0);
        ctx.restore();

        ctx.textAlign = 'center';
        ctx.fillText('Time', width / 2, height - 10);

        // Draw 1-second markers
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2;
        for (const idx of this.secondMarkers) {
            const x = width * idx / this.inputLufsBuffer.length;
            ctx.beginPath();
            ctx.moveTo(x, height - 16);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Draw LUFS history; skip segments with NaN values
        const drawLufs = (buffer, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < buffer.length; i++) {
                const value = buffer[i];
                if (isNaN(value)) continue;
                const x = width * i / buffer.length;
                const y = height * (1 - (value + 48) / 48);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
            if (started) {
                ctx.stroke();
            }
        };

        // Draw input LUFS (green)
        drawLufs(this.inputLufsBuffer, '#00ff00');
        // Draw output (After Auto Leveler) LUFS (white)
        drawLufs(this.outputLufsBuffer, '#ffffff');
        
        // Display current LUFS level as white text
        const currentOutputLufs = this.outputLufsBuffer[this.outputLufsBuffer.length - 1];
        if (!isNaN(currentOutputLufs)) {
            const clamped = currentOutputLufs > 0 ? 0 : (currentOutputLufs < -48 ? -48 : currentOutputLufs);
            const x = width - 20; // Position near the right edge
            const y = height * (1 - (clamped + 48) / 48) - 20; // Position above the line
            
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'right';
            ctx.font = '25px Arial';
            ctx.fillText(currentOutputLufs.toFixed(1) + ' dB', x, y);
        }
    }

    createUI() {
        if (this.observer) {
            this.observer.disconnect();
        }
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        // Create parameter rows
        container.appendChild(this.createParameterControl('Target LUFS', -36, 0, 0.1, this.tg, (value) => this.setParameters({ tg: value }), 'dB'));
        container.appendChild(this.createParameterControl('Time Window', 1000, 10000, 10, this.tw, (value) => this.setParameters({ tw: value }), 'ms'));
        container.appendChild(this.createParameterControl('Max Gain', 0, 12, 0.1, this.mg, (value) => this.setParameters({ mg: value }), 'dB'));
        container.appendChild(this.createParameterControl('Min Gain', -36, 0, 0.1, this.ng, (value) => this.setParameters({ ng: value }), 'dB'));
        container.appendChild(this.createParameterControl('Attack Time', 1, 1000, 1, this.at, (value) => this.setParameters({ at: value }), 'ms'));
        container.appendChild(this.createParameterControl('Release Time', 10, 10000, 10, this.rt, (value) => this.setParameters({ rt: value }), 'ms'));
        container.appendChild(this.createParameterControl('Noise Gate', -96, -24, 1, this.gt, (value) => this.setParameters({ gt: value }), 'dB'));

        // Create graph container
        const graphContainer = document.createElement('div');
        graphContainer.className = 'auto-leveler-graph';
        
        // Create canvas with same resolution as spectrogram
        this.canvas = document.createElement('canvas');
        this.canvas.width = 2048;
        this.canvas.height = 300;
        graphContainer.appendChild(this.canvas);

        // Initialize canvas context
        this.canvasCtx = this.canvas.getContext('2d');
        
        container.appendChild(graphContainer);
        
        if (this.observer == null) {
            this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
        }
        this.observer.observe(this.canvas);

        return container;
    }

    cleanup() {
        this.currentGain = 1.0;
        this.lastProcessTime = performance.now() / 1000;

        // Cancel animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Remove event listeners
        for (const [element, listener] of this.boundEventListeners) {
            element.removeEventListener('input', listener);
            element.removeEventListener('change', listener);
        }
        this.boundEventListeners.clear();

        // Release canvas resources
        if (this.canvas) {
            this.canvas.width = 0;
            this.canvas.height = 0;
            this.canvas = null;
        }
        this.canvasCtx = null;

        // Reset buffers to NaN so that initial graph is blank
        this.inputLufsBuffer.fill(NaN);
        this.outputLufsBuffer.fill(NaN);
        this.secondMarkers = [];
        this.prevTime = null;

        super.cleanup();
    }
}

window.AutoLevelerPlugin = AutoLevelerPlugin;
