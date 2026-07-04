class FifteenBandGEQPlugin extends PluginBase {
    static BANDS = [
        { freq: 25, name: '25 Hz' },
        { freq: 40, name: '40 Hz' },
        { freq: 63, name: '63 Hz' },
        { freq: 100, name: '100 Hz' },
        { freq: 160, name: '160 Hz' },
        { freq: 250, name: '250 Hz' },
        { freq: 400, name: '400 Hz' },
        { freq: 630, name: '630 Hz' },
        { freq: 1000, name: '1.0 kHz' },
        { freq: 1600, name: '1.6 kHz' },
        { freq: 2500, name: '2.5 kHz' },
        { freq: 4000, name: '4.0 kHz' },
        { freq: 6300, name: '6.3 kHz' },
        { freq: 10000, name: '10 kHz' },
        { freq: 16000, name: '16 kHz' }
    ];

    static processorFunction = `
// --- Constants ---
const NUM_BANDS = 15;
const GAIN_BYPASS_THRESHOLD = 0.01; // Threshold below which gain is considered zero for bypass
const A0_THRESHOLD = 1e-8;          // Denominator threshold to prevent division by zero/instability
const Q_FACTOR = 2.1;               // Fixed Q factor for all bands
const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
// Fixed band frequencies (more efficient than recreating array each call)
const FREQUENCIES = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];

// Early exit if processing is disabled
if (!parameters.enabled) return data;

// --- Parameter & Context Caching ---
const { channelCount, blockSize, sampleRate } = parameters;
// Pre-calculate for coefficient calculations
const twoPiTimesSrInv = TWO_PI / sampleRate;

// --- State Initialization & Management ---
// Initialize context only once or if channel count changes.
if (!context.initialized || context.lastChannelCount !== channelCount) {
    context.filterStates = new Array(NUM_BANDS);
    context.coefficients = new Array(NUM_BANDS); // Will store {b0, b1, b2, a1, a2} or null (for bypass)
    context.previousGains = new Array(NUM_BANDS).fill(NaN); // Use NaN to force initial calculation
    for (let i = 0; i < NUM_BANDS; i++) {
        // Use Array.fill(0.0) for clarity with floating point numbers
        context.filterStates[i] = {
            x1: new Array(channelCount).fill(0.0), x2: new Array(channelCount).fill(0.0),
            y1: new Array(channelCount).fill(0.0), y2: new Array(channelCount).fill(0.0)
        };
        // Initialize coefficients as null to ensure calculation on first run
        context.coefficients[i] = null;
    }
    context.lastChannelCount = channelCount;
    context.initialized = true;
}

// Cache context arrays
const coefficients = context.coefficients;
const filterStates = context.filterStates;
const previousGains = context.previousGains;

// --- Coefficient Calculation ---
// Update coefficients only for bands where the gain parameter has changed.
let coeffsNeedUpdate = false; // Flag if any coefficient was updated
for (let i = 0; i < NUM_BANDS; i++) {
    const currentGain = parameters['b' + i];

    // Check if gain changed (using !== handles NaN comparison correctly for first run)
    if (currentGain !== previousGains[i]) {
        coeffsNeedUpdate = true; // Mark that at least one calculation is needed
        previousGains[i] = currentGain; // Store the new gain value regardless of bypass

        // Check for bypass condition (gain effectively zero)
        const gainAbs = currentGain < 0 ? -currentGain : currentGain; // Optimized Math.abs
        if (gainAbs < GAIN_BYPASS_THRESHOLD) {
            coefficients[i] = null; // Set to null to signal bypass in processing loop
            continue; // Skip calculation for this bypassed band
        }

        // --- Calculate Peaking Filter Coefficients ---
        // Formula derived from RBJ Audio EQ Cookbook, adapted for A = sqrt(LinearGain)
        const A = Math.sqrt(Math.pow(10, 0.05 * currentGain)); // A = sqrt(10^(G/20)) = sqrt(10^(G/10 * 0.5)) = (10^(G/10))^0.25 ? No, original was A=sqrt(10^(G/20)). Let's recalculate. 10^(G/20) -> sqrt is 10^(G/40). Original code used sqrt(linearGain) where linearGain = 10^(G/20). So A = sqrt(10^(G/20)) is correct.
        // A = Math.pow(10, 0.025 * currentGain); // 10^(G/40) - This seems the correct interpretation for A in RBJ when gain G is in dB for peaking filter

        const freq = FREQUENCIES[i];
        const w0 = freq * twoPiTimesSrInv; // Calculate angular frequency

        // Clamp w0 slightly away from 0 and PI to avoid trig issues
        const clampedW0 = w0 < 1e-6 ? 1e-6 : (w0 > PI - 1e-6 ? PI - 1e-6 : w0);
        const cosw0 = Math.cos(clampedW0);
        const sinw0 = Math.sin(clampedW0);
        // Ensure Q_FACTOR is positive if it were a parameter
        const alpha = sinw0 / (2 * Q_FACTOR);

        const alphaMulA = alpha * A;
        const alphaDivA = alpha / A; // Ensure A is not zero (checked by gain threshold indirectly)
        const neg2CosW0 = -2 * cosw0; // Pre-calculate common term

        // Calculate raw coefficients (b's and a's from cookbook notation)
        const b0_raw = 1 + alphaMulA;
        const b1_raw = neg2CosW0;
        const b2_raw = 1 - alphaMulA;
        const a0_raw = 1 + alphaDivA;
        const a1_raw = neg2CosW0;
        const a2_raw = 1 - alphaDivA;

        // --- Normalize Coefficients ---
        const a0_abs = a0_raw < 0 ? -a0_raw : a0_raw;
        if (a0_abs < A0_THRESHOLD) {
            // Filter is potentially unstable or identity, treat as bypass
            coefficients[i] = null;
        } else {
            // Normalize using multiplication by inverse for potential speedup
            const invA0 = 1.0 / a0_raw;
            coefficients[i] = {
                b0: b0_raw * invA0,
                b1: b1_raw * invA0,
                b2: b2_raw * invA0,
                // Store a1/a2 such that the difference equation uses subtraction:
                // y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
                // RBJ a1, a2 usually have signs matching this form already.
                a1: a1_raw * invA0,
                a2: a2_raw * invA0
            };
        }
    }
}

// --- Audio Processing ---
// Determine start and end channels for processing loop
const startCh = 0; // Always start from channel 0
const endCh = channelCount; // Process all available channels


// Process samples block by block, channel by channel
for (let ch = startCh; ch < endCh; ch++) {
    const offset = ch * blockSize; // Calculate base offset for this channel once

    // Iterate through each filter band
    for (let bandIndex = 0; bandIndex < NUM_BANDS; bandIndex++) {
        const coef = coefficients[bandIndex]; // Get pre-calculated coefficients

        // Skip this band if it's bypassed (null coefficients)
        if (coef === null) {
            continue;
        }

        // Cache coefficients and state reference for the inner loop
        const b0 = coef.b0; const b1 = coef.b1; const b2 = coef.b2;
        const a1 = coef.a1; const a2 = coef.a2;
        const state = filterStates[bandIndex];

        // Load state specific to this channel into local variables (avoids repeated lookups)
        let x1 = state.x1[ch]; let x2 = state.x2[ch];
        let y1 = state.y1[ch]; let y2 = state.y2[ch];

        // Process each sample in the block for the current band and channel
        for (let i = 0; i < blockSize; i++) {
            const dataIndex = offset + i;
            const x_n = data[dataIndex]; // Current input sample for this band

            // Apply the 2nd order IIR difference equation using local state
            const y_n = b0 * x_n + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

            // Update local state variables efficiently
            x2 = x1; x1 = x_n;
            y2 = y1; y1 = y_n;

            // Write the processed sample back to the main buffer
            // This output becomes the input for the next band in the cascade
            data[dataIndex] = y_n;
        }

        // Store the updated local state variables back to the context state arrays for this channel
        state.x1[ch] = x1; state.x2[ch] = x2;
        state.y1[ch] = y1; state.y2[ch] = y2;
    } // End loop over bands
} // End loop over channels

return data; // Return the modified buffer
`;

    constructor() {
        super('15Band GEQ', '15-band graphic equalizer');
        
        // Initialize band gains (all 0 dB by default)
        for (let i = 0; i < 15; i++) {
            this['b' + i] = 0;  // b0-b14: Band 0-14 gains (formerly band0-band14) - Range: -12 to +12 dB
        }
        
        this.registerProcessor(FifteenBandGEQPlugin.processorFunction);
    }

    // Set band gain (-12 to +12 dB)
    setBand(index, value) {
        this['b' + index] = value;
        this.updateParameters();
    }

    // Reset all bands to default values
    reset() {
        for (let i = 0; i < 15; i++) {
            this.setBand(i, 0);
        }
        this.setUIValues();
    }

    getParameters() {
        const params = {
            type: this.constructor.name,
            enabled: this.enabled
        };
        
        // Add all band parameters
        for (let i = 0; i < 15; i++) {
            params['b' + i] = this['b' + i];
        }
        
        return params;
    }

    setParameters(params) {
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        
        // Update band parameters
        for (let i = 0; i < 15; i++) {
            if (params['b' + i] !== undefined) {
                this['b' + i] = params['b' + i];
            }
        }
        
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'fifteen-band-geq-plugin-ui plugin-parameter-ui';

        // Create sliders container
        const slidersContainer = document.createElement('div');
        slidersContainer.className = 'sliders-container';

        // Store references to sliders and value displays for reset functionality
        const sliders = [];
        const valueDisplays = [];

        // Create sliders for each band
        FifteenBandGEQPlugin.BANDS.forEach((band, index) => {
            const sliderContainer = document.createElement('div');
            sliderContainer.className = 'slider-container';

            // Frequency label
            const freqLabel = document.createElement('label');
            freqLabel.className = 'freq-label';
            freqLabel.textContent = band.name;
            const sliderId = `${this.id}-${this.name}-band-${index}-slider`;
            freqLabel.htmlFor = sliderId;

            // Vertical slider
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'vertical-slider';
            slider.id = sliderId;
            slider.name = sliderId;
            slider.min = -12;
            slider.max = 12;
            slider.step = 0.1;
            slider.value = this['b' + index];
            slider.autocomplete = "off";
            sliders.push(slider);

            // Value display
            const valueDisplay = document.createElement('div');
            valueDisplay.className = 'value-display';
            valueDisplay.textContent = this['b' + index].toFixed(1) + ' dB';
            valueDisplays.push(valueDisplay);

            // Event listeners
            slider.addEventListener('input', (e) => {
                this.setBand(index, parseFloat(e.target.value));
                valueDisplay.textContent = this['b' + index].toFixed(1) + ' dB';
                this.drawGraph(canvas);
            });

            sliderContainer.appendChild(freqLabel);
            sliderContainer.appendChild(slider);
            sliderContainer.appendChild(valueDisplay);
            slidersContainer.appendChild(sliderContainer);
        });

        // Graph container
        const { container: graphContainer, canvas } = this.createResponsiveGraph({
            maxWidth: 600,
            aspectRatio: '5 / 2',
            mobileAspectRatio: '2 / 1',
            className: 'fifteen-band-geq-graph-container',
            onResize: ({ canvas }) => this.drawGraph(canvas)
        });
        graphContainer.style.margin = '10px auto';
        canvas.style.margin = '0 auto';
        // Store references to DOM elements for later updates
        this.container = container;
        this.graphCanvas = canvas;
        this.sliders = sliders;
        this.valueDisplays = valueDisplays;

        // Reset button
        const resetButton = document.createElement('button');
        resetButton.className = 'eq-reset-button';
        resetButton.textContent = 'Reset';
        resetButton.addEventListener('click', () => {
            this.reset();
            // Update all sliders and value displays
            for (let i = 0; i < 15; i++) {
                sliders[i].value = this['b' + i];
                valueDisplays[i].textContent = this['b' + i].toFixed(1) + ' dB';
            }
            this.drawGraph(canvas);
        });
        graphContainer.appendChild(resetButton);

        // Add all elements to container
        container.appendChild(slidersContainer);
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

        // ---------- constants ----------
        const SR = (this.audioContext && this.audioContext.sampleRate) || 48000;
        const Q  = 2.1;
        const MIN_GAIN_DB = 0.01;               // ≈0 dB threshold ⇒ bypass
    
        // ---------- helpers ----------
        const biquadMag = (f, fc, g) => {
            if (Math.abs(g) < MIN_GAIN_DB) return 0;          // bypass = 0 dB
    
            const A     = Math.pow(10, g / 40);               // RBJ: A = 10^(G/40)
            const w0    = 2 * Math.PI * fc / SR;
            const cosw0 = Math.cos(w0);
            const sinw0 = Math.sin(w0);
            const alpha = sinw0 / (2 * Q);
    
            // un-normalised coeffs
            const b0 = 1 + alpha * A;
            const b1 = -2 * cosw0;
            const b2 = 1 - alpha * A;
            const a0 = 1 + alpha / A;
            const a1 = -2 * cosw0;
            const a2 = 1 - alpha / A;
    
            // normalise
            const bz0 = b0 / a0, bz1 = b1 / a0, bz2 = b2 / a0;
            const az1 = a1 / a0, az2 = a2 / a0;
    
            const w   = 2 * Math.PI * f / SR;
            const cw  = Math.cos(w), sw = Math.sin(w);
    
            // |H(e^jw)|^2  (real arithmetic, no complex lib needed)
            const numRe = bz0 + bz1 * cw + bz2 * (2 * cw * cw - 1);
            const numIm = bz1 * sw + bz2 * 2 * cw * sw;
            const denRe = 1   + az1 * cw + az2 * (2 * cw * cw - 1);
            const denIm = az1 * sw + az2 * 2 * cw * sw;
    
            return 10 * Math.log10((numRe * numRe + numIm * numIm) /
                                   (denRe * denRe + denIm * denIm));
        };
    
        // ---------- clear ----------
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
    
        // ---------- grid ----------
        ctx.strokeStyle = '#444';
        ctx.lineWidth   = isMobileLayout ? 1 : 0.5;
    
        const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        freqs.forEach(f => {
            const x = width * (Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        });
    
        const dBs = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
        dBs.forEach(db => {
            const y = height * (1 - (db + 24) / 48);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        });
    
        // ---------- response ----------
        ctx.beginPath();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth   = isMobileLayout ? 2 : 1;
    
        for (let xPix = 0; xPix < width; xPix++) {
            const f = Math.pow(10,
                      Math.log10(20) + (xPix / width) * (Math.log10(20000) - Math.log10(20)));
    
            let sum = 0;
            for (let i = 0; i < 15; i++) {
                const g  = this['b' + i];
                const fc = FifteenBandGEQPlugin.BANDS[i].freq;
                sum += biquadMag(f, fc, g);
            }
    
            const yPix = height * (1 - (sum + 24) / 48);
            if (xPix === 0) ctx.moveTo(xPix, yPix);
            else             ctx.lineTo(xPix, yPix);
        }
        ctx.stroke();
    }
   
    setUIValues() {
        if (!this.container) return;
        
        // Update sliders and value displays directly using stored references
        for (let i = 0; i < 15; i++) {
            if (this.sliders && this.sliders[i]) {
                this.sliders[i].value = this['b' + i];
            }
            if (this.valueDisplays && this.valueDisplays[i]) {
                this.valueDisplays[i].textContent = this['b' + i].toFixed(1) + ' dB';
            }
        }

        // Redraw the graph using the stored canvas reference
        if (this.graphCanvas) {
            this.drawGraph(this.graphCanvas);
        }
    }
}

// Register plugin
if (typeof window !== 'undefined') {
    window.FifteenBandGEQPlugin = FifteenBandGEQPlugin;
}
