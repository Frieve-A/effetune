class ToneControlPlugin extends PluginBase {
    static processorFunction = `
    // Early exit if processing is disabled
    if (!parameters.enabled) return data;

    // Extract parameters into local constants for potentially faster access
    const { bs, md, tr, channelCount, blockSize, sampleRate } = parameters;

    // --- Constants ---
    const PI = 3.141592653589793;
    const TWO_PI = 6.283185307179586;
    const SQRT2 = 1.4142135623730951;
    const GAIN_THRESHOLD = 1e-6; // Threshold to determine if gain is effectively non-zero

    // --- State Initialization & Management ---
    // Initialize or reset filter states if it's the first run or channel count changed.
    // States store previous inputs (x1, x2) and outputs (y1, y2) for each band.
    if (!context.initialized || context.lastChannelCount !== channelCount) {
        const numChannels = channelCount; // Use local variable for clarity
        // Use Array.fill(0) to match original code's behavior exactly.
        // Renamed state variables for better readability (e.g., bass_x1).
        context.filterStates = {
            bass_x1: new Array(numChannels).fill(0), bass_x2: new Array(numChannels).fill(0),
            bass_y1: new Array(numChannels).fill(0), bass_y2: new Array(numChannels).fill(0),
            mid_x1: new Array(numChannels).fill(0), mid_x2: new Array(numChannels).fill(0),
            mid_y1: new Array(numChannels).fill(0), mid_y2: new Array(numChannels).fill(0),
            treble_x1: new Array(numChannels).fill(0), treble_x2: new Array(numChannels).fill(0),
            treble_y1: new Array(numChannels).fill(0), treble_y2: new Array(numChannels).fill(0)
        };
        context.lastChannelCount = numChannels;
        context.initialized = true;
    }

    const states = context.filterStates; // Cache context's state object
    const sr = sampleRate; // Local alias for sample rate

    // --- Coefficient Calculation ---
    // Coefficients are calculated in every block to strictly match the original code's behavior.

    // Determine if each filter band needs processing based on gain threshold
    // Optimized Math.abs check using direct comparison
    const bassActive = bs > GAIN_THRESHOLD || bs < -GAIN_THRESHOLD;
    const midActive = md > GAIN_THRESHOLD || md < -GAIN_THRESHOLD;
    const trebleActive = tr > GAIN_THRESHOLD || tr < -GAIN_THRESHOLD;

    // Declare coefficient variables with defaults (pass-through)
    let bassB0 = 1.0, bassB1 = 0.0, bassB2 = 0.0, bassA1 = 0.0, bassA2 = 0.0;
    let midB0 = 1.0, midB1 = 0.0, midB2 = 0.0, midA1 = 0.0, midA2 = 0.0;
    let trebleB0 = 1.0, trebleB1 = 0.0, trebleB2 = 0.0, trebleA1 = 0.0, trebleA2 = 0.0;

    // --- Low Shelf (Bass) Coefficients ---
    // Calculated only if the bass gain is significant
    if (bassActive) {
        const A = Math.pow(10, 0.025 * bs); // Optimized gain conversion: 10^(G/40)
        const omega = TWO_PI * 100 / sr;    // Fixed cutoff frequency: 100 Hz
        const cosw = Math.cos(omega);
        const sinw = Math.sin(omega);
        // S=1 shelving filter slope parameter leads to sqrt(2) term
        const alpha = sinw * 0.5 * SQRT2;
        const sqrtA = Math.sqrt(A); // Calculate sqrt(A) once
        const twoSqrtAAlpha = 2 * sqrtA * alpha;
        const A_plus_1 = A + 1;
        const A_minus_1 = A - 1;

        // RBJ Cookbook Low Shelf coefficients
        const commonTerm1 = A_plus_1 - A_minus_1 * cosw;
        const commonTerm2 = A_plus_1 + A_minus_1 * cosw;

        const b0_tmp = A * (commonTerm1 + twoSqrtAAlpha);
        const b1_tmp = 2 * A * (A_minus_1 - A_plus_1 * cosw);
        const b2_tmp = A * (commonTerm1 - twoSqrtAAlpha);
        const a0_tmp = commonTerm2 + twoSqrtAAlpha;
        const a1_tmp = -2 * (A_minus_1 + A_plus_1 * cosw);
        const a2_tmp = commonTerm2 - twoSqrtAAlpha;

        // Normalize coefficients by dividing by a0_tmp
        // Use multiplication by the inverse for potential speed improvement
        const invA0 = 1.0 / a0_tmp;
        bassB0 = b0_tmp * invA0;
        bassB1 = b1_tmp * invA0;
        bassB2 = b2_tmp * invA0;
        bassA1 = a1_tmp * invA0; // Corresponds to -a1 in the difference equation
        bassA2 = a2_tmp * invA0; // Corresponds to -a2 in the difference equation
    }

    // --- Peaking EQ (Mid) Coefficients ---
    // Calculated only if the mid gain is significant
    if (midActive) {
        const A = Math.pow(10, 0.025 * md); // Optimized gain conversion: 10^(G/40)
        const omega = TWO_PI * 1000 / sr;   // Fixed center frequency: 1000 Hz
        const cosw = Math.cos(omega);
        const sinw = Math.sin(omega);
        const Q = 0.7;                      // Fixed Q factor
        const alpha = sinw / (2 * Q);

        // RBJ Cookbook Peaking EQ coefficients
        const alphaMulA = alpha * A;
        const alphaDivA = alpha / A;
        const neg2CosW = -2 * cosw; // Pre-calculate common term

        const b0_tmp = 1 + alphaMulA;
        const b1_tmp = neg2CosW;
        const b2_tmp = 1 - alphaMulA;
        const a0_tmp = 1 + alphaDivA;
        const a1_tmp = neg2CosW;
        const a2_tmp = 1 - alphaDivA;

        // Normalize coefficients
        const invA0 = 1.0 / a0_tmp;
        midB0 = b0_tmp * invA0;
        midB1 = b1_tmp * invA0;
        midB2 = b2_tmp * invA0;
        midA1 = a1_tmp * invA0;
        midA2 = a2_tmp * invA0;
    }

    // --- High Shelf (Treble) Coefficients ---
    // Calculated only if the treble gain is significant
    if (trebleActive) {
        const A = Math.pow(10, 0.025 * tr); // Optimized gain conversion: 10^(G/40)
        const omega = TWO_PI * 10000 / sr;  // Fixed cutoff frequency: 10000 Hz
        const cosw = Math.cos(omega);
        const sinw = Math.sin(omega);
        // S=1 shelving filter slope parameter
        const alpha = sinw * 0.5 * SQRT2;
        const sqrtA = Math.sqrt(A);
        const twoSqrtAAlpha = 2 * sqrtA * alpha;
        const A_plus_1 = A + 1;
        const A_minus_1 = A - 1;

        // RBJ Cookbook High Shelf coefficients
        const commonTerm1 = A_plus_1 + A_minus_1 * cosw;
        const commonTerm2 = A_plus_1 - A_minus_1 * cosw;

        const b0_tmp = A * (commonTerm1 + twoSqrtAAlpha);
        const b1_tmp = -2 * A * (A_minus_1 + A_plus_1 * cosw);
        const b2_tmp = A * (commonTerm1 - twoSqrtAAlpha);
        const a0_tmp = commonTerm2 + twoSqrtAAlpha;
        const a1_tmp = 2 * (A_minus_1 - A_plus_1 * cosw);
        const a2_tmp = commonTerm2 - twoSqrtAAlpha;

        // Normalize coefficients
        const invA0 = 1.0 / a0_tmp;
        trebleB0 = b0_tmp * invA0;
        trebleB1 = b1_tmp * invA0;
        trebleB2 = b2_tmp * invA0;
        trebleA1 = a1_tmp * invA0;
        trebleA2 = a2_tmp * invA0;
    }

    // --- Process Audio ---
    // Process samples block by block, channel by channel
    for (let ch = 0; ch < channelCount; ch++) {
        const offset = ch * blockSize;

        // Cache references to state arrays for the current channel for faster access inside inner loop
        const b_x1 = states.bass_x1; const b_x2 = states.bass_x2;
        const b_y1 = states.bass_y1; const b_y2 = states.bass_y2;
        const m_x1 = states.mid_x1;  const m_x2 = states.mid_x2;
        const m_y1 = states.mid_y1;  const m_y2 = states.mid_y2;
        const t_x1 = states.treble_x1; const t_x2 = states.treble_x2;
        const t_y1 = states.treble_y1; const t_y2 = states.treble_y2;

        // Process each sample in the current block for the current channel
        for (let i = 0; i < blockSize; i++) {
            const idx = offset + i; // Direct index into the data buffer
            let sample = data[idx]; // Current sample value

            // Apply Bass filter (Low Shelf) if active
            if (bassActive) {
                const x_n = sample; // Input for this filter stage
                // Retrieve previous state values for this channel
                const x1 = b_x1[ch]; const x2 = b_x2[ch];
                const y1 = b_y1[ch]; const y2 = b_y2[ch];
                // Apply the 2nd order IIR difference equation:
                // y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
                const y_n = bassB0 * x_n + bassB1 * x1 + bassB2 * x2 - bassA1 * y1 - bassA2 * y2;
                // Update state arrays for the next sample calculation
                b_x2[ch] = x1; b_x1[ch] = x_n;
                b_y2[ch] = y1; b_y1[ch] = y_n;
                sample = y_n; // Output of this stage is input to the next
            }

            // Apply Mid filter (Peaking) if active
            if (midActive) {
                const x_n = sample;
                const x1 = m_x1[ch]; const x2 = m_x2[ch];
                const y1 = m_y1[ch]; const y2 = m_y2[ch];
                const y_n = midB0 * x_n + midB1 * x1 + midB2 * x2 - midA1 * y1 - midA2 * y2;
                m_x2[ch] = x1; m_x1[ch] = x_n;
                m_y2[ch] = y1; m_y1[ch] = y_n;
                sample = y_n;
            }

            // Apply Treble filter (High Shelf) if active
            if (trebleActive) {
                const x_n = sample;
                const x1 = t_x1[ch]; const x2 = t_x2[ch];
                const y1 = t_y1[ch]; const y2 = t_y2[ch];
                const y_n = trebleB0 * x_n + trebleB1 * x1 + trebleB2 * x2 - trebleA1 * y1 - trebleA2 * y2;
                t_x2[ch] = x1; t_x1[ch] = x_n;
                t_y2[ch] = y1; t_y1[ch] = y_n;
                sample = y_n;
            }

            // Write the final processed sample back to the data buffer
            data[idx] = sample;
        }
    }

    return data; // Return the modified buffer
    `;

    constructor() {
        super('Tone Control', 'Three-band tone control with bass, mid, and treble adjustment');
        
        // Initialize parameters
        this.bs = 0;
        this.md = 0;
        this.tr = 0;
        this.enabled = true;
        
        // Register processor function
        this.registerProcessor(ToneControlPlugin.processorFunction);
    }

    // Parameter setters
    setBass(value) {
        const parsedValue = typeof value === 'number' ? value : parseFloat(value);
        this.bs = parsedValue < -24 ? -24 : (parsedValue > 24 ? 24 : parsedValue);
        this.updateParameters();
    }

    setMid(value) {
        const parsedValue = typeof value === 'number' ? value : parseFloat(value);
        this.md = parsedValue < -24 ? -24 : (parsedValue > 24 ? 24 : parsedValue);
        this.updateParameters();
    }

    setTreble(value) {
        const parsedValue = typeof value === 'number' ? value : parseFloat(value);
        this.tr = parsedValue < -24 ? -24 : (parsedValue > 24 ? 24 : parsedValue);
        this.updateParameters();
    }

    // Reset all parameters to defaults
    reset() {
        this.setBass(0);
        this.setMid(0);
        this.setTreble(0);
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            bs: this.bs,
            md: this.md,
            tr: this.tr
        };
    }

    setParameters(params) {
        if (params.enabled !== undefined) this.enabled = params.enabled;
        if (params.bs !== undefined) this.setBass(params.bs);
        if (params.md !== undefined) this.setMid(params.md);
        if (params.tr !== undefined) this.setTreble(params.tr);
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        // Keep original class structure unless standardizing is desired
        container.className = 'tone-control-plugin-ui plugin-parameter-ui';

        const { container: graphContainer, canvas } = this.createGraphContainer({
            maxWidth: 600,
            canvasWidth: 1200,
            canvasHeight: 480,
            className: 'tone-control-graph-container'
        });

        // Create parameter controls using createParameterControl
        const bassSetter = (value) => {
            this.setBass(value);
            this.drawGraph(canvas); // Update graph
        };
        container.appendChild(this.createParameterControl('Bass', -24, 24, 0.1, this.bs, bassSetter, 'dB'));

        const midSetter = (value) => {
            this.setMid(value);
            this.drawGraph(canvas); // Update graph
        };
        container.appendChild(this.createParameterControl('Mid', -24, 24, 0.1, this.md, midSetter, 'dB'));

        const trebleSetter = (value) => {
            this.setTreble(value);
            this.drawGraph(canvas); // Update graph
        };
        container.appendChild(this.createParameterControl('Treble', -24, 24, 0.1, this.tr, trebleSetter, 'dB'));

        // Reset button - Keep original structure and class, append to graphContainer
        const resetButton = document.createElement('button');
        resetButton.className = 'eq-reset-button';
        resetButton.textContent = 'Reset';
        resetButton.addEventListener('click', () => {
            this.reset();
            // Update controls created by createParameterControl
            const paramRows = container.querySelectorAll('.parameter-row');
            if (paramRows.length >= 3) { // Check based on Bass, Mid, Treble order
                 const bassRowElements = paramRows[0].querySelectorAll('input');
                 bassRowElements[0].value = this.bs; // Slider
                 bassRowElements[1].value = this.bs; // Number input
                 const midRowElements = paramRows[1].querySelectorAll('input');
                 midRowElements[0].value = this.md; // Slider
                 midRowElements[1].value = this.md; // Number input
                 const trebleRowElements = paramRows[2].querySelectorAll('input');
                 trebleRowElements[0].value = this.tr; // Slider
                 trebleRowElements[1].value = this.tr; // Number input
            }
            this.drawGraph(canvas);
        });
        graphContainer.appendChild(resetButton);

        // Add graph container (which includes reset button) to the main container
        // This follows the original order where graph/reset were appended last
        container.appendChild(graphContainer);

        // Initial graph draw
        this.drawGraph(canvas);

        return container;
    }

    drawGraph(canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const sr = 44100; // Standard sample rate

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw grid (vertical: frequency, horizontal: dB)
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;

        const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        freqs.forEach(freq => {
            const x = width * (Math.log10(freq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            if (freq !== 20 && freq !== 20000) {
                ctx.fillStyle = '#666';
                ctx.font = '20px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(freq >= 1000 ? (freq/1000) + 'k' : freq, x, height - 40);
            }
        });

        const dBs = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
        dBs.forEach(db => {
            const y = height * (1 - (db + 24) / 48);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            if (db !== -24 && db !== 24) {
                ctx.fillStyle = '#666';
                ctx.font = '20px Arial';
                ctx.textAlign = 'right';
                ctx.fillText(db + 'dB', 80, y + 6);
            }
        });

        // Draw axis labels
        ctx.fillStyle = '#fff';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', width/2, height - 5);
        ctx.save();
        ctx.translate(20, height/2);
        ctx.rotate(-Math.PI/2);
        ctx.fillText('Level (dB)', 0, 0);
        ctx.restore();

        // Draw frequency response curve
        ctx.beginPath();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;

        // Helper function: compute second-order IIR frequency response using z-transform
        function computeResponse(b0, b1, b2, a1, a2, w) {
            const cosw = Math.cos(w), sinw = Math.sin(w);
            // z^-1 = cos(w) - j*sin(w), z^-2 = cos(2w) - j*sin(2w)
            const numRe = b0 + b1 * cosw + b2 * Math.cos(2*w);
            const numIm = 0 - b1 * sinw - b2 * Math.sin(2*w);
            const denRe = 1 + a1 * cosw + a2 * Math.cos(2*w);
            const denIm = 0 - a1 * sinw - a2 * Math.sin(2*w);
            const numMag = Math.sqrt(numRe*numRe + numIm*numIm);
            const denMag = Math.sqrt(denRe*denRe + denIm*denIm);
            return numMag / denMag;
        }
        
        for (let i = 0; i < width; i++) {
            // Map frequency logarithmically from 20Hz to 20kHz
            const freq = Math.pow(10, Math.log10(20) + (i/width)*(Math.log10(20000)-Math.log10(20)));
            const w = 2 * Math.PI * freq / sr;
            
            // Low Shelf response
            let A_b = Math.pow(10, this.bs / 40);
            let omega_b = 2 * Math.PI * 100 / sr;
            let cosw_b = Math.cos(omega_b);
            let sinw_b = Math.sin(omega_b);
            let alpha_b = sinw_b / 2 * Math.sqrt(2);
            let b0_b = A_b * ((A_b + 1) - (A_b - 1)*cosw_b + 2*Math.sqrt(A_b)*alpha_b);
            let b1_b = 2 * A_b * ((A_b - 1) - (A_b + 1)*cosw_b);
            let b2_b = A_b * ((A_b + 1) - (A_b - 1)*cosw_b - 2*Math.sqrt(A_b)*alpha_b);
            let a0_b = (A_b + 1) + (A_b - 1)*cosw_b + 2*Math.sqrt(A_b)*alpha_b;
            let a1_b = -2 * ((A_b - 1) + (A_b + 1)*cosw_b);
            let a2_b = (A_b + 1) + (A_b - 1)*cosw_b - 2*Math.sqrt(A_b)*alpha_b;
            b0_b /= a0_b; b1_b /= a0_b; b2_b /= a0_b;
            a1_b /= a0_b; a2_b /= a0_b;
            const H_b = (this.bs !== 0) ? computeResponse(b0_b, b1_b, b2_b, a1_b, a2_b, w) : 1;
            
            // Mid Peaking response with Q = 0.7
            let A_m = Math.pow(10, this.md / 40);
            let omega_m = 2 * Math.PI * 1000 / sr;
            let cosw_m = Math.cos(omega_m);
            let sinw_m = Math.sin(omega_m);
            // Set Q to 0.7 for mid band
            let Q_m = 0.7;
            let alpha_m = sinw_m / (2 * Q_m);
            let b0_m = 1 + alpha_m * A_m;
            let b1_m = -2 * cosw_m;
            let b2_m = 1 - alpha_m * A_m;
            let a0_m = 1 + alpha_m / A_m;
            let a1_m = -2 * cosw_m;
            let a2_m = 1 - alpha_m / A_m;
            b0_m /= a0_m; b1_m /= a0_m; b2_m /= a0_m;
            a1_m /= a0_m; a2_m /= a0_m;
            const H_m = (this.md !== 0) ? computeResponse(b0_m, b1_m, b2_m, a1_m, a2_m, w) : 1;
            
            // High Shelf response
            let A_t = Math.pow(10, this.tr / 40);
            let omega_t = 2 * Math.PI * 10000 / sr;
            let cosw_t = Math.cos(omega_t);
            let sinw_t = Math.sin(omega_t);
            let alpha_t = sinw_t / 2 * Math.sqrt(2);
            let b0_t = A_t * ((A_t + 1) + (A_t - 1)*cosw_t + 2*Math.sqrt(A_t)*alpha_t);
            let b1_t = -2 * A_t * ((A_t - 1) + (A_t + 1)*cosw_t);
            let b2_t = A_t * ((A_t + 1) + (A_t - 1)*cosw_t - 2*Math.sqrt(A_t)*alpha_t);
            let a0_t = (A_t + 1) - (A_t - 1)*cosw_t + 2*Math.sqrt(A_t)*alpha_t;
            let a1_t = 2 * ((A_t - 1) - (A_t + 1)*cosw_t);
            let a2_t = (A_t + 1) - (A_t - 1)*cosw_t - 2*Math.sqrt(A_t)*alpha_t;
            b0_t /= a0_t; b1_t /= a0_t; b2_t /= a0_t;
            a1_t /= a0_t; a2_t /= a0_t;
            const H_t = (this.tr !== 0) ? computeResponse(b0_t, b1_t, b2_t, a1_t, a2_t, w) : 1;
            
            const H_total = H_b * H_m * H_t;
            const dB = 20 * Math.log10(H_total);
            const yPos = height * (1 - (dB + 24) / 48);
            
            if (i === 0) {
                ctx.moveTo(i, yPos);
            } else {
                ctx.lineTo(i, yPos);
            }
        }
        ctx.stroke();
    }
}

// Register plugin in browser environment
if (typeof window !== 'undefined') {
    window.ToneControlPlugin = ToneControlPlugin;
}
