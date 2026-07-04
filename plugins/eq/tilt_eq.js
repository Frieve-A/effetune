class TiltEQPlugin extends PluginBase {
    static DEFAULTS = Object.freeze({
        f0: 6.91, // exp(6.91) ~= 1.0 kHz
        sl: 0.0
    });

    static processorFunction = `
// --- Constants ---
const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;

// Early exit if processing is disabled
if (!parameters.enabled) return data;

// --- Parameter & Context Caching ---
const { channelCount, blockSize, sampleRate } = parameters;
const f0 = Math.exp(parameters.f0); // Convert exponent to actual frequency (Hz)
const slopeDbOct = parameters.sl;

// Skip processing if slope is essentially zero
if (Math.abs(slopeDbOct) < 0.01) return data;

// --- State Initialization & Management ---
// Initialize context only once or if channel count or filter parameters change.
const needsInit = !context.initialized ||
                    context.lastChannelCount !== channelCount ||
                    context.lastF0 !== parameters.f0 || // Compare against the raw parameter
                    context.lastSlope !== slopeDbOct;

if (needsInit) {
    // Calculate filter coefficients for shelving filters

    // Normalized frequency (0 to PI)
    const omega = TWO_PI * f0 / sampleRate;
    const cosOmega = Math.cos(omega);
    const sinOmega = Math.sin(omega);

    // Create filter states if not exists or if channel count changed
    if (!context.filterState || context.lastChannelCount !== channelCount) {
        context.filterState = {
            xl1: new Float32Array(channelCount), // Use Float32Array for potentially better performance
            xl2: new Float32Array(channelCount),
            yl1: new Float32Array(channelCount),
            yl2: new Float32Array(channelCount),
            xh1: new Float32Array(channelCount),
            xh2: new Float32Array(channelCount),
            yh1: new Float32Array(channelCount),
            yh2: new Float32Array(channelCount)
        };
        // Note: Float32Array initialization automatically fills with 0.0
    }

    // Calculate shelf filter coefficients
    const lowShelfGain = -2 * slopeDbOct;
    const highShelfGain = 2 * slopeDbOct;

    // --- Low Shelf coefficients ---
    const Al = Math.pow(10, lowShelfGain / 40); // sqrt(linear gain)
    const sqrtAl = Math.sqrt(Al); // Pre-calculate sqrt(Al)
    // alpha depends on A (gain) and S (slope parameter, implicitly 0.5 here)
    // S=0.5 results in (1/0.5 - 1) = 1
    const alphaL = sinOmega * 0.5 * Math.sqrt((Al + 1 / Al) * 1.0 + 2.0); // Use 1.0 directly
    const commonFactorL1 = (Al + 1);
    const commonFactorL2 = (Al - 1);
    const commonFactorL3 = 2 * sqrtAl * alphaL;
    const commonFactorL4 = commonFactorL2 * cosOmega;
    const commonFactorL5 = commonFactorL1 * cosOmega;

    const b0l = Al * (commonFactorL1 - commonFactorL4 + commonFactorL3);
    const b1l = 2 * Al * (commonFactorL2 - commonFactorL5);
    const b2l = Al * (commonFactorL1 - commonFactorL4 - commonFactorL3);
    const a0l =       (commonFactorL1 + commonFactorL4 + commonFactorL3); // Denominator
    const a1l = -2 * (commonFactorL2 + commonFactorL5);
    const a2l =       (commonFactorL1 + commonFactorL4 - commonFactorL3);

    // Normalize Low Shelf coefficients by 1/a0l
    const invA0l = 1.0 / a0l;
    context.lowShelfCoefs = {
        b0: b0l * invA0l,
        b1: b1l * invA0l,
        b2: b2l * invA0l,
        a1: a1l * invA0l,
        a2: a2l * invA0l
    };

    // --- High Shelf coefficients ---
    const Ah = Math.pow(10, highShelfGain / 40); // sqrt(linear gain)
    const sqrtAh = Math.sqrt(Ah); // Pre-calculate sqrt(Ah)
    // Re-calculate alpha for high shelf gain Ah, assuming the same S=0.5
    const alphaH = sinOmega * 0.5 * Math.sqrt((Ah + 1 / Ah) * 1.0 + 2.0);
    const commonFactorH1 = (Ah + 1);
    const commonFactorH2 = (Ah - 1);
    const commonFactorH3 = 2 * sqrtAh * alphaH;
    const commonFactorH4 = commonFactorH2 * cosOmega;
    const commonFactorH5 = commonFactorH1 * cosOmega;

    // High Shelf formulas differ slightly from Low Shelf (sign changes related to cosOmega)
    const b0h = Ah * (commonFactorH1 + commonFactorH4 + commonFactorH3);
    const b1h = -2 * Ah * (commonFactorH2 + commonFactorH5);
    const b2h = Ah * (commonFactorH1 + commonFactorH4 - commonFactorH3);
    const a0h =       (commonFactorH1 - commonFactorH4 + commonFactorH3); // Denominator
    const a1h =  2 * (commonFactorH2 - commonFactorH5);
    const a2h =       (commonFactorH1 - commonFactorH4 - commonFactorH3);

    // Normalize High Shelf coefficients by 1/a0h
    const invA0h = 1.0 / a0h;
    context.highShelfCoefs = {
        b0: b0h * invA0h,
        b1: b1h * invA0h,
        b2: b2h * invA0h,
        a1: a1h * invA0h,
        a2: a2h * invA0h
    };

    // Update context tracking variables
    context.lastChannelCount = channelCount;
    context.lastF0 = parameters.f0;
    context.lastSlope = slopeDbOct;
    context.initialized = true;
}

// --- Audio Processing ---
// Determine start and end channels for processing loop
const startCh = 0; // Always start from channel 0
const endCh = channelCount; // Process all available channels

// Get filter coefficients and state (already cached in context)
const lcf = context.lowShelfCoefs;
const hcf = context.highShelfCoefs;
const state = context.filterState;

// Process samples block by block, channel by channel
for (let ch = startCh; ch < endCh; ch++) {
    const offset = ch * blockSize; // Calculate base offset for this channel once

    // Get filter states for this channel from context state arrays
    let xl1 = state.xl1[ch], xl2 = state.xl2[ch], yl1 = state.yl1[ch], yl2 = state.yl2[ch];
    let xh1 = state.xh1[ch], xh2 = state.xh2[ch], yh1 = state.yh1[ch], yh2 = state.yh2[ch];

    // Cache coefficients locally for the inner loop
    const lb0 = lcf.b0, lb1 = lcf.b1, lb2 = lcf.b2, la1 = lcf.a1, la2 = lcf.a2;
    const hb0 = hcf.b0, hb1 = hcf.b1, hb2 = hcf.b2, ha1 = hcf.a1, ha2 = hcf.a2;

    // Process each sample in the block
    for (let i = 0; i < blockSize; i++) {
        const dataIndex = offset + i;
        const input = data[dataIndex]; // Current input sample

        // Apply low shelf filter (Direct Form I)
        // y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
        let lowShelfOutput = lb0 * input + lb1 * xl1 + lb2 * xl2 - la1 * yl1 - la2 * yl2;

        // Update low shelf state (input and output history)
        xl2 = xl1;
        xl1 = input;
        yl2 = yl1;
        yl1 = lowShelfOutput; // Store intermediate output

        // Apply high shelf filter to the output of low shelf (Direct Form I)
        let highShelfOutput = hb0 * lowShelfOutput + hb1 * xh1 + hb2 * xh2 - ha1 * yh1 - ha2 * yh2;

        // Update high shelf state (input and output history)
        xh2 = xh1;
        xh1 = lowShelfOutput; // Input to high shelf is output from low shelf
        yh2 = yh1;
        yh1 = highShelfOutput;

        // Write final output back to buffer
        data[dataIndex] = highShelfOutput;
    }

    // Save filter states back to context state arrays for the next block
    state.xl1[ch] = xl1; state.xl2[ch] = xl2; state.yl1[ch] = yl1; state.yl2[ch] = yl2;
    state.xh1[ch] = xh1; state.xh2[ch] = xh2; state.yh1[ch] = yh1; state.yh2[ch] = yh2;
}

return data; // Return the modified buffer
`;

    constructor() {
        super('Tilt EQ', 'Frequency tilt equalizer');

        // Initialize parameters
        this.f0 = TiltEQPlugin.DEFAULTS.f0;
        this.sl = TiltEQPlugin.DEFAULTS.sl;

        // Register processor function
        this.registerProcessor(TiltEQPlugin.processorFunction);
    }

    // Set pivot frequency (3.0 to 9.9)
    setPivotFreq(value) {
        if (typeof value === 'number') {
            this.f0 = Math.max(3.0, Math.min(9.9, value));
            this.updateParameters();
        }
    }

    // Set slope (-12.0 to +12.0 dB/oct)
    setSlope(value) {
        if (typeof value === 'number') {
            this.sl = Math.max(-12.0, Math.min(12.0, value));
            this.updateParameters();
        }
    }

    // Reset to default values
    reset() {
        this.setPivotFreq(TiltEQPlugin.DEFAULTS.f0);
        this.setSlope(TiltEQPlugin.DEFAULTS.sl);
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            f0: this.f0,
            sl: this.sl
        };
    }

    setParameters(params) {
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }

        if (params.f0 !== undefined) {
            this.setPivotFreq(params.f0);
        }

        if (params.sl !== undefined) {
            this.setSlope(params.sl);
        }

        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'tilt-eq-plugin-ui plugin-parameter-ui';

        // Parameter controls container - Keep original structure
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'controls-container';

        // -- Manual Pivot Frequency Control with Hz Input --
        const pivotRow = document.createElement('div');
        pivotRow.className = 'parameter-row';

        const pivotLogSliderId = `${this.id}-${this.name}-pivot-log-slider`;
        const pivotHzValueId = `${this.id}-${this.name}-pivot-hz-value`;

        const pivotLabel = document.createElement('label');
        pivotLabel.textContent = 'Pivot Freq (Hz):'; // Label updated
        pivotLabel.htmlFor = pivotLogSliderId; // Associate with slider for clicking

        const pivotLogSlider = document.createElement('input');
        pivotLogSlider.type = 'range';
        pivotLogSlider.id = pivotLogSliderId;
        pivotLogSlider.name = pivotLogSliderId;
        pivotLogSlider.min = 3.0;
        pivotLogSlider.max = 9.9;
        pivotLogSlider.step = 0.01;
        pivotLogSlider.value = this.f0; // Slider uses log value
        pivotLogSlider.autocomplete = "off";

        const pivotHzInput = document.createElement('input');
        pivotHzInput.type = 'number';
        pivotHzInput.id = pivotHzValueId;
        pivotHzInput.name = pivotHzValueId;
        pivotHzInput.min = 20; // Hz range approx exp(3.0)
        pivotHzInput.max = 20000; // Hz range approx exp(9.9)
        pivotHzInput.step = 1;
        pivotHzInput.value = Math.round(Math.exp(this.f0)); // Input shows Hz value
        pivotHzInput.autocomplete = "off";

        const { container: graphContainer, canvas } = this.createResponsiveGraph({
            maxWidth: 600,
            aspectRatio: '5 / 2',
            mobileAspectRatio: '2 / 1',
            className: 'tilt-eq-graph-container',
            onResize: ({ canvas }) => this.drawGraph(canvas)
        });
        graphContainer.style.margin = '10px auto';
        canvas.style.margin = '0 auto';

        // Slider changes log value, updates Hz input
        pivotLogSlider.addEventListener('input', (e) => {
            const logValue = parseFloat(e.target.value);
            this.setPivotFreq(logValue); // Update internal log value
            pivotHzInput.value = Math.round(Math.exp(logValue)); // Update Hz display
            this.drawGraph(canvas); // Update graph
        });

        // Number input accepts Hz, updates log value and slider
        const updatePivotFromHz = (target) => {
            const hzValue = parseFloat(target.value) || 20; // Default to min Hz if invalid
            const minHz = 20;
            const maxHz = 20000;
            const clampedHz = Math.max(minHz, Math.min(maxHz, hzValue));

            const logValue = Math.log(clampedHz);
            const clampedLog = Math.max(3.0, Math.min(9.9, logValue)); // Clamp log value as well

            this.setPivotFreq(clampedLog); // Update internal log value
            pivotLogSlider.value = clampedLog; // Update slider position
            target.value = Math.round(Math.exp(clampedLog)); // Update Hz display to potentially clamped value
            this.drawGraph(canvas); // Update graph
        };

        pivotHzInput.addEventListener('change', (e) => { // Use change or blur to finalize
            updatePivotFromHz(e.target);
        });
         pivotHzInput.addEventListener('keydown', (e) => {
             if (e.key === 'Enter') {
                 updatePivotFromHz(e.target);
                 e.preventDefault();
             }
         });

        pivotRow.appendChild(pivotLabel);
        pivotRow.appendChild(pivotLogSlider);
        pivotRow.appendChild(pivotHzInput);
        controlsContainer.appendChild(pivotRow);
        // -- End Manual Pivot Frequency Control --

        // Slope control using createParameterControl
        const slopeSetter = (value) => {
            this.setSlope(value);
            this.drawGraph(canvas); // Update graph
        };
        controlsContainer.appendChild(this.createParameterControl('Slope', -12.0, 12.0, 0.1, this.sl, slopeSetter, 'dB/oct'));

        // Reset button - Keep original structure and class, append to graphContainer
        const resetButton = document.createElement('button');
        resetButton.className = 'eq-reset-button';
        resetButton.textContent = 'Reset';
        resetButton.addEventListener('click', () => {
            this.reset(); // Resets internal values (this.f0, this.sl)

            // Update Pivot controls (manual)
            pivotLogSlider.value = this.f0;
            pivotHzInput.value = Math.round(Math.exp(this.f0));

            // Update Slope controls (from createParameterControl)
            const slopeRow = controlsContainer.querySelectorAll('.parameter-row')[1]; // Second control
            if (slopeRow) {
                const slopeElements = slopeRow.querySelectorAll('input');
                slopeElements[0].value = this.sl; // Slider
                slopeElements[1].value = this.sl; // Number input
            }

            this.drawGraph(canvas);
        });
        graphContainer.appendChild(resetButton);

        // Add elements to container IN ORIGINAL ORDER
        container.appendChild(controlsContainer);
        container.appendChild(graphContainer);

        // Initial graph draw
        this.drawGraph(canvas);

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

        // Clear canvas
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        // Draw grid
        ctx.strokeStyle = '#444';
        ctx.lineWidth = isMobileLayout ? 1 : 0.5;
        ctx.font = '12px Arial';

        // Vertical grid lines (frequency)
        const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        freqs.forEach(freq => {
            const x = width * (Math.log10(freq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            // Frequency labels
            if (freq !== 20 && freq !== 20000) {
                ctx.fillStyle = '#666';
                ctx.textAlign = 'center';
                ctx.fillText(freq >= 1000 ? `${freq/1000}k` : freq, x, height - 24);
            }
        });

        // Horizontal grid lines (dB)
        const dBs = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
        dBs.forEach(db => {
            const y = height * (1 - (db + 24) / 48);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();

            // dB labels
            if (db !== -24 && db !== 24) {
                ctx.fillStyle = '#666';
                ctx.textAlign = 'right';
                ctx.fillText(`${db}dB`, 48, y + 4);
            }
        });

        // Draw axis labels
        ctx.fillStyle = '#fff';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';

        // Draw "Frequency (Hz)" label
        ctx.fillText('Frequency (Hz)', width/2, height - 5);

        // Draw "Level (dB)" label
        ctx.save();
        ctx.translate(14, height/2);
        ctx.rotate(-Math.PI/2);
        ctx.fillText('Level (dB)', 0, 0);
        ctx.restore();

        // Calculate and draw frequency response using the same algorithm as the audio processor
        ctx.beginPath();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = isMobileLayout ? 2 : 1;

        const pivotFreq = Math.exp(this.f0);
        const slopeDbOct = this.sl;
        const sampleRate = 96000; // Standard sample rate assumption for visualization

        // Skip drawing if slope is essentially zero
        if (Math.abs(slopeDbOct) < 0.01) {
            // Draw flat line at 0dB
            const y0dB = height * (1 - (0 + 24) / 48);
            ctx.beginPath();
            ctx.moveTo(0, y0dB);
            ctx.lineTo(width, y0dB);
            ctx.stroke();
        } else {
            // Calculate shelving filter coefficients (same as in processor)
            const omega = 2 * Math.PI * pivotFreq / sampleRate;
            const cosOmega = Math.cos(omega);
            const sinOmega = Math.sin(omega);

            const lowShelfGain = -2 * slopeDbOct;
            const highShelfGain = 2 * slopeDbOct;

            // Low Shelf filter coefficients
            const Al = Math.pow(10, lowShelfGain / 40);
            const sqrtAl = Math.sqrt(Al);
            const alphaL = sinOmega * 0.5 * Math.sqrt((Al + 1 / Al) * 1.0 + 2.0);
            const commonFactorL1 = (Al + 1);
            const commonFactorL2 = (Al - 1);
            const commonFactorL3 = 2 * sqrtAl * alphaL;
            const commonFactorL4 = commonFactorL2 * cosOmega;
            const commonFactorL5 = commonFactorL1 * cosOmega;
            const b0l = Al * (commonFactorL1 - commonFactorL4 + commonFactorL3);
            const b1l = 2 * Al * (commonFactorL2 - commonFactorL5);
            const b2l = Al * (commonFactorL1 - commonFactorL4 - commonFactorL3);
            const a0l =       (commonFactorL1 + commonFactorL4 + commonFactorL3);
            const a1l = -2 * (commonFactorL2 + commonFactorL5);
            const a2l =       (commonFactorL1 + commonFactorL4 - commonFactorL3);
            const invA0l = 1.0 / a0l;
            const lb0 = b0l * invA0l, lb1 = b1l * invA0l, lb2 = b2l * invA0l;
            const la1 = a1l * invA0l, la2 = a2l * invA0l;

            // High Shelf filter coefficients
            const Ah = Math.pow(10, highShelfGain / 40);
            const sqrtAh = Math.sqrt(Ah);
            const alphaH = sinOmega * 0.5 * Math.sqrt((Ah + 1 / Ah) * 1.0 + 2.0);
            const commonFactorH1 = (Ah + 1);
            const commonFactorH2 = (Ah - 1);
            const commonFactorH3 = 2 * sqrtAh * alphaH;
            const commonFactorH4 = commonFactorH2 * cosOmega;
            const commonFactorH5 = commonFactorH1 * cosOmega;
            const b0h = Ah * (commonFactorH1 + commonFactorH4 + commonFactorH3);
            const b1h = -2 * Ah * (commonFactorH2 + commonFactorH5);
            const b2h = Ah * (commonFactorH1 + commonFactorH4 - commonFactorH3);
            const a0h =       (commonFactorH1 - commonFactorH4 + commonFactorH3);
            const a1h =  2 * (commonFactorH2 - commonFactorH5);
            const a2h =       (commonFactorH1 - commonFactorH4 - commonFactorH3);
            const invA0h = 1.0 / a0h;
            const hb0 = b0h * invA0h, hb1 = b1h * invA0h, hb2 = b2h * invA0h;
            const ha1 = a1h * invA0h, ha2 = a2h * invA0h;


            // For each pixel in the canvas width, calculate the frequency response
            for (let i = 0; i < width; i++) {
                const freq = Math.pow(10, Math.log10(20) + (i / width) * (Math.log10(20000) - Math.log10(20)));

                // Calculate z = e^(jw) for this frequency
                const w = 2 * Math.PI * freq / sampleRate;
                const cosW = Math.cos(w);
                const sinW = Math.sin(w);
                const cos2W = Math.cos(2 * w); // More efficient than cos(2*w)
                const sin2W = Math.sin(2 * w); // More efficient than sin(2*w)

                // --- Low shelf response calculation H_l(z) = B_l(z) / A_l(z) ---
                const lnumRe = lb0 + lb1 * cosW + lb2 * cos2W;
                const lnumIm =     - lb1 * sinW - lb2 * sin2W; // Imaginary part uses negative sine terms for z^-k
                const ldenRe = 1 + la1 * cosW + la2 * cos2W;
                const ldenIm =     - la1 * sinW - la2 * sin2W;

                // Magnitude squared |H_l(z)|^2 = |B_l(z)|^2 / |A_l(z)|^2
                const lnumMagSq = lnumRe * lnumRe + lnumIm * lnumIm;
                const ldenMagSq = ldenRe * ldenRe + ldenIm * ldenIm;
                const lmagSq = (ldenMagSq === 0) ? 0 : lnumMagSq / ldenMagSq; // Avoid division by zero

                // --- High shelf response calculation H_h(z) = B_h(z) / A_h(z) ---
                const hnumRe = hb0 + hb1 * cosW + hb2 * cos2W;
                const hnumIm =     - hb1 * sinW - hb2 * sin2W;
                const hdenRe = 1 + ha1 * cosW + ha2 * cos2W;
                const hdenIm =     - ha1 * sinW - ha2 * sin2W;

                // Magnitude squared |H_h(z)|^2 = |B_h(z)|^2 / |A_h(z)|^2
                const hnumMagSq = hnumRe * hnumRe + hnumIm * hnumIm;
                const hdenMagSq = hdenRe * hdenRe + hdenIm * hdenIm;
                const hmagSq = (hdenMagSq === 0) ? 0 : hnumMagSq / hdenMagSq; // Avoid division by zero

                // Total magnitude squared |H(z)|^2 = |H_l(z)|^2 * |H_h(z)|^2
                const totalMagSq = lmagSq * hmagSq;

                // Convert total magnitude to dB: 10 * log10(|H(z)|^2) = 20 * log10(|H(z)|)
                // Add a small epsilon to prevent log10(0)
                const combinedDb = 10 * Math.log10(totalMagSq + 1e-18); // Use 10*log10 for magnitude squared

                // Map response to canvas height
                const y = height * (1 - (combinedDb + 24) / 48); // Clamp to avoid extreme values?
                const clampedY = Math.max(0, Math.min(height, y)); // Clamp y to canvas bounds

                if (i === 0) {
                    ctx.moveTo(i, clampedY);
                } else {
                    ctx.lineTo(i, clampedY);
                }
            }
            ctx.stroke();
        }

        // Draw pivot frequency marker
        const pivotX = width * (Math.log10(pivotFreq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
        const pivotY = height * (1 - (0 + 24) / 48); // 0dB point

        ctx.fillStyle = '#ffff00';
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Register plugin
if (typeof window !== 'undefined') {
    window.TiltEQPlugin = TiltEQPlugin;
}
