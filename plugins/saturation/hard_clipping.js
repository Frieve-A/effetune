class HardClippingPlugin extends PluginBase {
    constructor() {
        super('Hard Clipping', 'Digital hard clipping effect with threshold and mode control');
        this.th = -18;    // th: Threshold (-60 to 0 dB)
        this.md = 'both'; // md: Mode ('both', 'positive', 'negative')

        // Register processor function with 4x oversampling and additional one-pole IIR smoothing
        this.registerProcessor(`
            // Early exit if disabled
            if (!parameters.enabled) return data;

            // --- Parameter Destructuring & Constant Calculation ---
            const {
                th: threshold,      // Threshold in dB (-60 to 0)
                md: mode,           // Mode: 'both', 'positive', 'negative'
                channelCount,
                blockSize
            } = parameters;

            // Convert dB threshold to linear gain (do this once)
            // Avoid Math.pow if threshold is 0 dB (thresholdLinear = 1.0)
            const thresholdLinear = (threshold === 0) ? 1.0 : Math.pow(10, threshold / 20);
            // Pre-calculate negative threshold for efficiency
            const negThreshold = -thresholdLinear;

            // Oversampling factor (fixed at 4x)
            const OS = 4;
            const osBlockSize = OS * blockSize; // Oversampled block size

            // One-pole IIR filter coefficient and its complement
            const lpCoeff = 0.3; // Smoothing factor (0 to 1)
            const lpCoeff1 = 1.0 - lpCoeff; // Pre-calculate (1 - coeff)

            // --- Context Initialization & Buffer Management ---
            // Check if context needs initialization or buffer resizing
            const needsReset = !context.osBuffer || context.osBuffer.length !== channelCount ||
                               context.osBuffer[0].length !== osBlockSize ||
                               !context.lpPrev || context.lpPrev.length !== channelCount ||
                               !context.interpolationPrev || context.interpolationPrev.length !== channelCount;

            if (needsReset) {
                // Allocate/Reallocate oversampling buffers
                context.osBuffer = new Array(channelCount);
                for (let ch = 0; ch < channelCount; ch++) {
                    context.osBuffer[ch] = new Float32Array(osBlockSize);
                }
                // Allocate/Reallocate filter state only if necessary
                if (!context.lpPrev || context.lpPrev.length !== channelCount) {
                    context.lpPrev = new Array(channelCount).fill(0.0); // Initialize with 0.0
                }
                if (!context.interpolationPrev || context.interpolationPrev.length !== channelCount) {
                    context.interpolationPrev = new Array(channelCount).fill(0.0);
                }
                // Note: Existing filter states in lpPrev are preserved if only osBuffer was resized.
            }

            // --- Main Processing Loop (Per Channel) ---
            for (let ch = 0; ch < channelCount; ch++) {
                const offset = ch * blockSize; // Input/Output offset for this channel
                // Cache context arrays/values for faster access within the loop
                const os = context.osBuffer[ch]; // Oversampling buffer for this channel
                let lpPrev = context.lpPrev[ch];   // IIR filter state (use let for update)
                let interpolationPrev = context.interpolationPrev[ch];

                // --- 1. Upsampling (Linear Interpolation) ---
                // Process input samples and fill the oversampling buffer 'os'
                // Interpolate from the preceding input sample so block boundaries do not affect the stream.
                for (let j = 0; j < blockSize; j++) {
                    const x0 = interpolationPrev;
                    const x1 = data[offset + j];
                    const delta = x1 - x0;
                    const osBase = OS * j; // Base index in oversampling buffer

                    // Perform 4x linear interpolation
                    os[osBase    ] = x0;
                    os[osBase + 1] = x0 + 0.25 * delta;
                    os[osBase + 2] = x0 + 0.50 * delta; // Use 0.50 for clarity
                    os[osBase + 3] = x0 + 0.75 * delta;
                    interpolationPrev = x1;
                }

                // --- 2. Hard Clipping (Oversampled Domain) ---
                // Apply clipping based on the selected mode.
                // Branching on 'mode' outside the inner loop is more efficient.
                if (mode === 'both') {
                    for (let i = 0; i < osBlockSize; i++) {
                        const s = os[i];
                        // Use if/else if (faster than Math.min/max per requirement)
                        if (s > thresholdLinear) {
                            os[i] = thresholdLinear;
                        } else if (s < negThreshold) {
                            os[i] = negThreshold;
                        }
                        // else: sample is within threshold, no change needed os[i] = s;
                    }
                } else if (mode === 'positive') {
                    for (let i = 0; i < osBlockSize; i++) {
                        const s = os[i];
                        if (s > thresholdLinear) {
                            os[i] = thresholdLinear;
                        }
                    }
                } else { // Assume mode === 'negative'
                    for (let i = 0; i < osBlockSize; i++) {
                        const s = os[i];
                        if (s < negThreshold) {
                            os[i] = negThreshold;
                        }
                    }
                }
                // Note: If 'mode' could be invalid, add a default case or error handling.

                // --- 3. Downsampling (FIR + IIR Filtering & Decimation) ---
                // Apply FIR and IIR filters, then write one sample back to the original data buffer for every OS samples processed.
                for (let j = 0; j < blockSize; j++) {
                    const osBase = OS * j; // Base index in oversampling buffer for the current output sample

                    // Simple FIR low-pass filter coefficients: [0.125, 0.375, 0.375, 0.125]
                    // This specific FIR filter averages 4 samples with weighting.
                    const firOut = os[osBase    ] * 0.125 +
                                 os[osBase + 1] * 0.375 +
                                 os[osBase + 2] * 0.375 +
                                 os[osBase + 3] * 0.125;

                    // Additional one-pole IIR low-pass filter for smoothing / further aliasing reduction
                    // Use pre-calculated (1.0 - lpCoeff) -> lpCoeff1
                    const filtered = lpCoeff * firOut + lpCoeff1 * lpPrev;
                    lpPrev = filtered; // Update the local filter state for the next sample

                    // Write the final downsampled and filtered sample back to the original buffer
                    data[offset + j] = filtered;
                }

                // --- Update Context State ---
                // Store the final IIR filter state back into the context for the next block
                context.lpPrev[ch] = lpPrev;
                context.interpolationPrev[ch] = interpolationPrev;
            }

            // Return the modified data buffer
            return data;
        `);
    }

    // Set parameters
    setParameters(params) {
        let graphNeedsUpdate = false;

        if (params.th !== undefined) {
            this.th = this.parseFiniteNumber(params.th, -60, 0, this.th);
            graphNeedsUpdate = true;
        }
        if (params.md !== undefined) {
            this.md = this.isAllowedEnum(params.md, ['both', 'positive', 'negative'], this.md);
            graphNeedsUpdate = true;
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }

        this.updateParameters();
        if (graphNeedsUpdate) {
            this.updateTransferGraph();
        }
    }

    // Set threshold level (-60 to 0 dB)
    setTh(value) {
        this.setParameters({ th: value });
    }

    // Set clipping mode ('both', 'positive', 'negative')
    setMd(value) {
        this.setParameters({ md: value });
    }

    getParameters() {
        return {
            type: this.constructor.name,
            th: this.th,
            md: this.md,
            enabled: this.enabled
        };
    }

    updateTransferGraph() {
        const canvas = this.canvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Draw grid
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        
        // Vertical grid lines
        for (let x = 0; x <= width; x += width / 4) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        
        // Horizontal grid lines
        for (let y = 0; y <= height; y += height / 4) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Draw in/out labels
        ctx.fillStyle = '#fff';
        ctx.font = '28px Arial';
        ctx.textAlign = 'center';
        
        // Draw "in" label at bottom
        ctx.fillText('in', width / 2, height - 5);
        
        // Draw "out" label on left side, rotated
        ctx.save();
        ctx.translate(20, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('out', 0, 0);
        ctx.restore();

        // Draw -6dB labels
        ctx.fillStyle = '#666';
        ctx.font = '20px Arial';

        // Input axis labels
        ctx.fillText('-6dB', width * 0.25, height - 5);  // Left
        ctx.fillText('-6dB', width * 0.75, height - 5);  // Right

        // Output axis labels
        ctx.save();
        ctx.translate(20, height * 0.25);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('-6dB', 0, 0);  // Top
        ctx.restore();

        ctx.save();
        ctx.translate(20, height * 0.75);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('-6dB', 0, 0);  // Bottom
        ctx.restore();

        // Draw transfer function
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const thresholdLinear = Math.pow(10, this.th / 20);
        
        for (let i = 0; i < width; i++) {
            const x = (i / width) * 2 - 1; // Map to [-1, 1]
            let y = x;
            
            // Apply clipping based on mode
            if (this.md === 'both') {
                if (x > thresholdLinear) {
                    y = thresholdLinear;
                } else if (x < -thresholdLinear) {
                    y = -thresholdLinear;
                }
            } else if (this.md === 'positive' && x > thresholdLinear) {
                y = thresholdLinear;
            } else if (this.md === 'negative' && x < -thresholdLinear) {
                y = -thresholdLinear;
            }
            
            // Map y from [-1, 1] to canvas coordinates
            const canvasY = ((1 - y) / 2) * height;
            
            if (i === 0) {
                ctx.moveTo(i, canvasY);
            } else {
                ctx.lineTo(i, canvasY);
            }
        }
        ctx.stroke();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'hard-clipping-plugin-ui plugin-parameter-ui';

        // Use base helper for Threshold control
        const thresholdRow = this.createParameterControl(
            'Threshold', -60, 0, 0.1, this.th,
            this.setTh.bind(this), 'dB'
        );
        container.appendChild(thresholdRow);

        // Mode radio buttons (keep original implementation)
        const modeLabel = document.createElement('label');
        modeLabel.textContent = 'Mode:';
        const modeGroup = document.createElement('div');
        modeGroup.className = 'radio-group';

        const modes = [
            { value: 'both', label: 'Both Sides' },
            { value: 'positive', label: 'Positive Only' },
            { value: 'negative', label: 'Negative Only' }
        ];

        modes.forEach(mode => {
            const radioId = `${this.id}-${this.name}-mode-${mode.value}`;
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `${this.id}-${this.name}-mode`;
            radio.id = radioId;
            radio.value = mode.value;
            radio.checked = this.md === mode.value;
            radio.autocomplete = "off";
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    this.setMd(mode.value);
                }
            });

            const label = document.createElement('label');
            label.htmlFor = radioId;
            label.appendChild(radio);
            label.appendChild(document.createTextNode(mode.label));
            modeGroup.appendChild(label);
        });
        
        // Mode parameter row
        const modeRow = document.createElement('div');
        modeRow.className = 'parameter-row';
        modeRow.appendChild(modeLabel);
        modeRow.appendChild(modeGroup);
        container.appendChild(modeRow);
        
        // Transfer function graph (keep original implementation)
        const graphContainer = document.createElement('div');
        graphContainer.style.position = 'relative';
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        canvas.style.width = '200px';
        canvas.style.height = '200px';
        canvas.style.backgroundColor = '#222';
        this.canvas = canvas;
        this.updateTransferGraph(); // Initial draw
        graphContainer.appendChild(canvas);
        container.appendChild(graphContainer);

        return container;
    }
}

// Register the plugin globally
window.HardClippingPlugin = HardClippingPlugin;
