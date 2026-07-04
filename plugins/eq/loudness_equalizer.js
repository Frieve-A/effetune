class LoudnessEqualizerPlugin extends PluginBase {
    constructor() {
        super('Loudness Equalizer', 'Small volume playback frequency balance correction');

        // Initialize parameters with defaults
        this.sp = 65.0;  // Average SPL (dB)
        this.lg = 10.0;  // Low Gain (dB)
        this.lf = 180;   // Low Freq (Hz)
        this.lq = 0.6;  // Low Q
        this.hq = 0.6;  // High Q
        this.hg = 0.0;   // High Gain (dB)
        this.hf = 4000;  // High Freq (Hz)

        // Register processor function
        this.registerProcessor(`
            // Define constant for 2 * PI
            const TWO_PI = 6.283185307179586;
        
            // Early exit if processing is disabled
            if (!parameters.enabled) return data;
        
            const { sp, lg, lf, lq, hq, hg, hf, channelCount, blockSize } = parameters;
        
            // --- State Initialization & Coefficient Cache Check ---
            let needsRecalculation = false;
            // Initialize context or reset if channel count has changed
            if (!context.initialized || context.channelCount !== channelCount) {
                // console.log('Initializing/Resetting State for channels:', channelCount); // Debug
                context.filterStates = {
                    // Use fill(0) for clarity, map creates new objects for each channel state
                    low: new Array(channelCount).fill(0).map(() => ({ x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 })),
                    high: new Array(channelCount).fill(0).map(() => ({ x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }))
                };
                context.channelCount = channelCount; // Store current channel count
                context.initialized = true;
                needsRecalculation = true; // Force recalculation on init/resize
            }
        
            // Check if parameters relevant to coefficients have changed since last calculation
            if (!needsRecalculation && (
                context.cachedSp !== sp ||
                context.cachedLg !== lg || context.cachedLf !== lf || context.cachedLq !== lq ||
                context.cachedHg !== hg || context.cachedHf !== hf || context.cachedHq !== hq ||
                context.cachedSampleRate !== sampleRate
               ))
            {
                // console.log('Parameter change detected.'); // Debug
                needsRecalculation = true;
            }
        
            // --- Coefficient Calculation (only if needed) ---
            if (needsRecalculation) {
                // console.log('Recalculating coefficients...'); // Debug
                // Calculate gain multiplier (depends only on sp)
                const gainMultiplier = (85.0 - sp) / 25.0;
        
                // Ensure context object for coefficients exists
                context.c = context.c || {};
        
                // --- Low Shelf Coefficients ---
                const lowGain = lg * gainMultiplier;
                const A_low = Math.pow(10.0, lowGain / 40.0); // Amp factor
                // Avoid instability/NaN with non-positive Q; return bypass coefficients
                if (lq <= 0.0) {
                     console.warn("Low Shelf Q <= 0, filter unstable. Bypassing Low Shelf.");
                     context.c.lb0 = 1.0; context.c.lb1 = 0.0; context.c.lb2 = 0.0;
                     context.c.la1 = 0.0; context.c.la2 = 0.0;
                } else {
                    const w0_low = TWO_PI * lf / sampleRate;
                    const cos_w0_low = Math.cos(w0_low);
                    const sin_w0_low = Math.sin(w0_low); // Calculate sin once
                    const alpha_low = sin_w0_low / (2.0 * lq);
                    const two_sqrt_A_alpha_low = 2.0 * Math.sqrt(A_low) * alpha_low;
                    const A_plus_1 = A_low + 1.0;
                    const A_minus_1 = A_low - 1.0;
        
                    // Calculate biquad coefficients (Cookbook formulas)
                    const low_b0 = A_low * (A_plus_1 - A_minus_1 * cos_w0_low + two_sqrt_A_alpha_low);
                    const low_b1 = 2.0 * A_low * (A_minus_1 - A_plus_1 * cos_w0_low);
                    const low_b2 = A_low * (A_plus_1 - A_minus_1 * cos_w0_low - two_sqrt_A_alpha_low);
                    const low_a0 =         A_plus_1 + A_minus_1 * cos_w0_low + two_sqrt_A_alpha_low;
                    const low_a1 = -2.0 * (A_minus_1 + A_plus_1 * cos_w0_low);
                    const low_a2 =         A_plus_1 + A_minus_1 * cos_w0_low - two_sqrt_A_alpha_low;
        
                    // Normalize and cache low shelf coefficients
                    // Check for near-zero a0 to prevent division errors / instability
                    if (low_a0 < 1e-10 && low_a0 > -1e-10) { // Check magnitude instead of Math.abs
                         console.warn("Low shelf a0 coefficient is near zero, filter unstable. Bypassing Low Shelf.");
                         context.c.lb0 = 1.0; context.c.lb1 = 0.0; context.c.lb2 = 0.0;
                         context.c.la1 = 0.0; context.c.la2 = 0.0;
                    } else {
                        const inv_low_a0 = 1.0 / low_a0; // Calculate inverse once for normalization
                        context.c.lb0 = low_b0 * inv_low_a0;
                        context.c.lb1 = low_b1 * inv_low_a0;
                        context.c.lb2 = low_b2 * inv_low_a0;
                        context.c.la1 = low_a1 * inv_low_a0;
                        context.c.la2 = low_a2 * inv_low_a0;
                    }
                }
        
                // --- High Shelf Coefficients ---
                const highGain = hg * gainMultiplier;
                const A_high = Math.pow(10.0, highGain / 40.0); // Amp factor
                // Avoid instability/NaN with non-positive Q; return bypass coefficients
                if (hq <= 0.0) {
                     console.warn("High Shelf Q <= 0, filter unstable. Bypassing High Shelf.");
                     context.c.hb0 = 1.0; context.c.hb1 = 0.0; context.c.hb2 = 0.0;
                     context.c.ha1 = 0.0; context.c.ha2 = 0.0;
                } else {
                    const w0_high = TWO_PI * hf / sampleRate;
                    const cos_w0_high = Math.cos(w0_high);
                    const sin_w0_high = Math.sin(w0_high); // Calculate sin once
                    const alpha_high = sin_w0_high / (2.0 * hq);
                    const two_sqrt_A_alpha_high = 2.0 * Math.sqrt(A_high) * alpha_high;
                    const A_plus_1_h = A_high + 1.0;
                    const A_minus_1_h = A_high - 1.0;
        
                    // Calculate biquad coefficients (Cookbook formulas)
                    const high_b0 = A_high * (A_plus_1_h + A_minus_1_h * cos_w0_high + two_sqrt_A_alpha_high);
                    const high_b1 = -2.0 * A_high * (A_minus_1_h + A_plus_1_h * cos_w0_high);
                    const high_b2 = A_high * (A_plus_1_h + A_minus_1_h * cos_w0_high - two_sqrt_A_alpha_high);
                    const high_a0 =         A_plus_1_h - A_minus_1_h * cos_w0_high + two_sqrt_A_alpha_high;
                    const high_a1 = 2.0 * (A_minus_1_h - A_plus_1_h * cos_w0_high);
                    const high_a2 =         A_plus_1_h - A_minus_1_h * cos_w0_high - two_sqrt_A_alpha_high;
        
                    // Normalize and cache high shelf coefficients
                    // Check for near-zero a0 to prevent division errors / instability
                    if (high_a0 < 1e-10 && high_a0 > -1e-10) { // Check magnitude instead of Math.abs
                         console.warn("High shelf a0 coefficient is near zero, filter unstable. Bypassing High Shelf.");
                         context.c.hb0 = 1.0; context.c.hb1 = 0.0; context.c.hb2 = 0.0;
                         context.c.ha1 = 0.0; context.c.ha2 = 0.0;
                    } else {
                        const inv_high_a0 = 1.0 / high_a0; // Calculate inverse once for normalization
                        context.c.hb0 = high_b0 * inv_high_a0;
                        context.c.hb1 = high_b1 * inv_high_a0;
                        context.c.hb2 = high_b2 * inv_high_a0;
                        context.c.ha1 = high_a1 * inv_high_a0;
                        context.c.ha2 = high_a2 * inv_high_a0;
                    }
                }
        
                // Store parameters used for this calculation to check against next time
                context.cachedSp = sp;
                context.cachedLg = lg; context.cachedLf = lf; context.cachedLq = lq;
                context.cachedHg = hg; context.cachedHf = hf; context.cachedHq = hq;
                context.cachedSampleRate = sampleRate;
        
                // console.log('Coefficients recalculated and cached:', context.c); // Debug
            } // end needsRecalculation check
        
        
            // --- Audio Processing Loop ---
        
            // Retrieve cached coefficients into local variables for maximum performance inside loops
            // This avoids repeated property lookups (context.c.lb0 etc.)
            const lb0 = context.c.lb0; const lb1 = context.c.lb1; const lb2 = context.c.lb2;
            const la1 = context.c.la1; const la2 = context.c.la2;
            const hb0 = context.c.hb0; const hb1 = context.c.hb1; const hb2 = context.c.hb2;
            const ha1 = context.c.ha1; const ha2 = context.c.ha2;
        
            // Local references to state arrays (reduces property lookups in outer loop)
            const lowStates = context.filterStates.low;
            const highStates = context.filterStates.high;
        
            for (let ch = 0; ch < channelCount; ch++) {
                // Calculate offset once per channel
                const offset = ch * blockSize;
                // Calculate end index once per channel
                const end = offset + blockSize;
        
                // Get state objects for the current channel
                // It's generally faster to access local object variables than array elements repeatedly
                const currentLowState = lowStates[ch];
                const currentHighState = highStates[ch];
        
                // Optimization: Load state variables into local vars *before* the inner loop
                // This avoids repeated property lookups (e.g., currentLowState.x1) inside the tight loop
                let lx1 = currentLowState.x1; let lx2 = currentLowState.x2;
                let ly1 = currentLowState.y1; let ly2 = currentLowState.y2;
                let hx1 = currentHighState.x1; let hx2 = currentHighState.x2;
                let hy1 = currentHighState.y1; let hy2 = currentHighState.y2;
        
                // Process block for the current channel
                // Use direct index 'i' starting from offset for potentially clearer data access
                for (let i = offset; i < end; i++) {
                    const input = data[i]; // Cache input sample
        
                    // --- Process low shelf using local state vars ---
                    // Direct Form II Transposed structure calculation
                    const lowOutput = lb0 * input + lb1 * lx1 + lb2 * lx2 - la1 * ly1 - la2 * ly2;
        
                    // Update low shelf local state vars for next sample
                    lx2 = lx1;       // x[n-2] = x[n-1]
                    lx1 = input;     // x[n-1] = x[n]
                    ly2 = ly1;       // y[n-2] = y[n-1]
                    ly1 = lowOutput; // y[n-1] = y[n]
        
                    // --- Process high shelf using local state vars ---
                    // Input to high shelf is the output of the low shelf
                    // Direct Form II Transposed structure calculation
                    const highOutput = hb0 * lowOutput + hb1 * hx1 + hb2 * hx2 - ha1 * hy1 - ha2 * hy2;
        
                    // Update high shelf local state vars for next sample
                    hx2 = hx1;        // x[n-2] = x[n-1] (using lowOutput as input)
                    hx1 = lowOutput;  // x[n-1] = x[n]  (using lowOutput as input)
                    hy2 = hy1;        // y[n-2] = y[n-1]
                    hy1 = highOutput; // y[n-1] = y[n]
        
                    // Write final output back to the data array
                    data[i] = highOutput;
                }
        
                // Write back updated local state vars to the context object for the next block
                currentLowState.x1 = lx1; currentLowState.x2 = lx2;
                currentLowState.y1 = ly1; currentLowState.y2 = ly2;
                currentHighState.x1 = hx1; currentHighState.x2 = hx2;
                currentHighState.y1 = hy1; currentHighState.y2 = hy2;
            }
        
            // Return the modified data array
            return data;
        `);
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            sp: this.sp,  // Average SPL
            lg: this.lg,  // Low Gain
            lf: this.lf,  // Low Freq
            lq: this.lq,  // Low Q
            hq: this.hq,  // High Q
            hg: this.hg,  // High Gain
            hf: this.hf   // High Freq
        };
    }

    setParameters(params) {
        if (params.sp !== undefined) {
            const value = Number(params.sp);
            this.sp = value < 60.0 ? 60.0 : (value > 85.0 ? 85.0 : value);
        }
        if (params.lg !== undefined) {
            const value = Number(params.lg);
            this.lg = value < 0.0 ? 0.0 : (value > 15.0 ? 15.0 : value); // max gain changed to 15dB
        }
        if (params.lf !== undefined) {
            const value = Math.floor(Number(params.lf));
            this.lf = value < 100 ? 100 : (value > 300 ? 300 : value);
        }
        if (params.lq !== undefined) {
            const value = Number(params.lq);
            this.lq = value < 0.5 ? 0.5 : (value > 1.0 ? 1.0 : value);
        }
        if (params.hq !== undefined) {
            const value = Number(params.hq);
            this.hq = value < 0.5 ? 0.5 : (value > 1.0 ? 1.0 : value);
        }
        if (params.hg !== undefined) {
            const value = Number(params.hg);
            this.hg = value < 0.0 ? 0.0 : (value > 15.0 ? 15.0 : value); // max gain changed to 15dB
        }
        if (params.hf !== undefined) {
            const value = Math.floor(Number(params.hf));
            this.hf = value < 3000 ? 3000 : (value > 6000 ? 6000 : value);
        }
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'loudness-equalizer-plugin-ui plugin-parameter-ui';

        // Define canvas here so it's available for event handlers
        const { container: graphContainer, canvas } = this.createResponsiveGraph({
            maxWidth: 600,
            aspectRatio: '5 / 2',
            mobileAspectRatio: '2 / 1',
            className: 'loudness-equalizer-graph',
            onResize: ({ canvas }) => this.drawGraph(canvas)
        });
        graphContainer.style.margin = '10px auto';
        canvas.style.margin = '0 auto';

        // Helper function to create the onChange handler for controls
        const createOnChangeHandler = (setter) => {
            return (value) => {
                setter(value); // Call the original parameter setter
                this.drawGraph(canvas); // Redraw graph on change
            };
        };

        // Create parameter rows using createParameterControl
        container.appendChild(this.createParameterControl(
            'Average SPL', 60.0, 85.0, 0.1, this.sp,
            createOnChangeHandler(v => this.setParameters({ sp: v })), 'dB'
        ));
        container.appendChild(this.createParameterControl(
            'Low Freq', 100, 300, 1, this.lf,
            createOnChangeHandler(v => this.setParameters({ lf: v })), 'Hz'
        ));
        container.appendChild(this.createParameterControl(
            'Low Gain', 0.0, 15.0, 0.1, this.lg,
            createOnChangeHandler(v => this.setParameters({ lg: v })), 'dB'
        ));
        container.appendChild(this.createParameterControl(
            'Low Q', 0.5, 1.0, 0.01, this.lq,
            createOnChangeHandler(v => this.setParameters({ lq: v }))
        ));
        container.appendChild(this.createParameterControl(
            'High Freq', 3000, 6000, 10, this.hf,
            createOnChangeHandler(v => this.setParameters({ hf: v })), 'Hz'
        ));
        container.appendChild(this.createParameterControl(
            'High Gain', 0.0, 15.0, 0.1, this.hg,
            createOnChangeHandler(v => this.setParameters({ hg: v })), 'dB'
        ));
        container.appendChild(this.createParameterControl(
            'High Q', 0.5, 1.0, 0.01, this.hq,
            createOnChangeHandler(v => this.setParameters({ hq: v }))
        ));

        // Add graph container
        container.appendChild(graphContainer);

        this.drawGraph(canvas); // Initial draw
        return container;
    }

    drawGraph(canvas) {
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        const cssWidth = rect.width || canvas.clientWidth || canvas.width;
        const cssHeight = rect.height || canvas.clientHeight || canvas.height;
        const dpr = canvas.width / cssWidth || 1;
        const width = Math.max(1, Math.round(cssWidth));
        const height = Math.max(1, Math.round(cssHeight));
        const isMobileLayout = typeof document !== 'undefined' && document.body && document.body.classList.contains('layout-mobile');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        // Draw grid
        ctx.strokeStyle = '#444';
        ctx.lineWidth = isMobileLayout ? 1 : 0.5;
        ctx.font = '12px Arial';
        const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        freqs.forEach(freq => {
            const x = width * (Math.log10(freq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            if (freq > 20 && freq < 20000) {
                ctx.fillStyle = '#666';
                ctx.textAlign = 'center';
                ctx.fillText(freq >= 1000 ? `${freq/1000}k` : freq, x, height - 24);
            }
        });

        // Adjusted vertical axis: from -6dB to +18dB
        const dBs = [-6, 0, 6, 12, 18];
        dBs.forEach(db => {
            const y = height * (1 - (db + 6) / 24); // denominator changed from 30 to 24
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            if (db > -6 && db < 18) {
                ctx.fillStyle = '#666';
                ctx.textAlign = 'right';
                ctx.fillText(`${db}dB`, 48, y + 4);
            }
        });

        // Draw labels
        ctx.fillStyle = '#fff';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', width / 2, height - 5);
        ctx.save();
        ctx.translate(14, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Level (dB)', 0, 0);
        ctx.restore();

        // Use a fixed sample rate for visualization
        const sampleRate = 96000;

        // Calculate gain multiplier based on SPL difference
        const gainMultiplier = (85 - this.sp) / 25;

        // Compute low shelf coefficients (same as in processor)
        const lowGain = this.lg * gainMultiplier;
        const w0_low = 2 * Math.PI * this.lf / sampleRate;
        const A_low = Math.pow(10, lowGain / 40);
        const alpha_low = Math.sin(w0_low) / (2 * this.lq);
        const cos_w0_low = Math.cos(w0_low);
        const two_sqrt_A_alpha_low = 2 * Math.sqrt(A_low) * alpha_low;
        const low_b0 = A_low * ((A_low + 1) - (A_low - 1) * cos_w0_low + two_sqrt_A_alpha_low);
        const low_b1 = 2 * A_low * ((A_low - 1) - (A_low + 1) * cos_w0_low);
        const low_b2 = A_low * ((A_low + 1) - (A_low - 1) * cos_w0_low - two_sqrt_A_alpha_low);
        const low_a0 = (A_low + 1) + (A_low - 1) * cos_w0_low + two_sqrt_A_alpha_low;
        const low_a1 = -2 * ((A_low - 1) + (A_low + 1) * cos_w0_low);
        const low_a2 = (A_low + 1) + (A_low - 1) * cos_w0_low - two_sqrt_A_alpha_low;
        const low_b0_n = low_b0 / low_a0;
        const low_b1_n = low_b1 / low_a0;
        const low_b2_n = low_b2 / low_a0;
        const low_a1_n = low_a1 / low_a0;
        const low_a2_n = low_a2 / low_a0;

        // Compute high shelf coefficients (same as in processor)
        const highGain = this.hg * gainMultiplier;
        const w0_high = 2 * Math.PI * this.hf / sampleRate;
        const A_high = Math.pow(10, highGain / 40);
        const alpha_high = Math.sin(w0_high) / (2 * this.hq);
        const cos_w0_high = Math.cos(w0_high);
        const two_sqrt_A_alpha_high = 2 * Math.sqrt(A_high) * alpha_high;
        const high_b0 = A_high * ((A_high + 1) + (A_high - 1) * cos_w0_high + two_sqrt_A_alpha_high);
        const high_b1 = -2 * A_high * ((A_high - 1) + (A_high + 1) * cos_w0_high);
        const high_b2 = A_high * ((A_high + 1) + (A_high - 1) * cos_w0_high - two_sqrt_A_alpha_high);
        const high_a0 = (A_high + 1) - (A_high - 1) * cos_w0_high + two_sqrt_A_alpha_high;
        const high_a1 = 2 * ((A_high - 1) - (A_high + 1) * cos_w0_high);
        const high_a2 = (A_high + 1) - (A_high - 1) * cos_w0_high - two_sqrt_A_alpha_high;
        const high_b0_n = high_b0 / high_a0;
        const high_b1_n = high_b1 / high_a0;
        const high_b2_n = high_b2 / high_a0;
        const high_a1_n = high_a1 / high_a0;
        const high_a2_n = high_a2 / high_a0;

        // Draw frequency response curve using the actual filter transfer functions
        ctx.beginPath();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = isMobileLayout ? 2 : 1;
        for (let i = 0; i < width; i++) {
            // Calculate frequency on a logarithmic scale between 20Hz and 20kHz
            const freq = Math.pow(10, Math.log10(20) + (i / width) * (Math.log10(20000) - Math.log10(20)));
            const omega = 2 * Math.PI * freq / sampleRate;

            // Compute low shelf frequency response H_low = (b0 + b1*e^(-jω) + b2*e^(-j2ω)) / (1 + a1*e^(-jω) + a2*e^(-j2ω))
            const lowNumRe = low_b0_n + low_b1_n * Math.cos(omega) + low_b2_n * Math.cos(2 * omega);
            const lowNumIm = - low_b1_n * Math.sin(omega) - low_b2_n * Math.sin(2 * omega);
            const lowDenRe = 1 + low_a1_n * Math.cos(omega) + low_a2_n * Math.cos(2 * omega);
            const lowDenIm = - low_a1_n * Math.sin(omega) - low_a2_n * Math.sin(2 * omega);
            const lowNumMag = Math.sqrt(lowNumRe * lowNumRe + lowNumIm * lowNumIm);
            const lowDenMag = Math.sqrt(lowDenRe * lowDenRe + lowDenIm * lowDenIm);
            const H_low = lowNumMag / lowDenMag;

            // Compute high shelf frequency response H_high
            const highNumRe = high_b0_n + high_b1_n * Math.cos(omega) + high_b2_n * Math.cos(2 * omega);
            const highNumIm = - high_b1_n * Math.sin(omega) - high_b2_n * Math.sin(2 * omega);
            const highDenRe = 1 + high_a1_n * Math.cos(omega) + high_a2_n * Math.cos(2 * omega);
            const highDenIm = - high_a1_n * Math.sin(omega) - high_a2_n * Math.sin(2 * omega);
            const highNumMag = Math.sqrt(highNumRe * highNumRe + highNumIm * highNumIm);
            const highDenMag = Math.sqrt(highDenRe * highDenRe + highDenIm * highDenIm);
            const H_high = highNumMag / highDenMag;

            // Combined overall response (cascaded filters)
            const H_total = H_low * H_high;
            const dB = 20 * Math.log10(H_total);

            // Map dB to y coordinate: -6dB -> bottom, +18dB -> top
            const y = height * (1 - (dB + 6) / 24);

            if (i === 0) {
                ctx.moveTo(i, y);
            } else {
                ctx.lineTo(i, y);
            }
        }
        ctx.stroke();
    }
}

window.LoudnessEqualizerPlugin = LoudnessEqualizerPlugin;
