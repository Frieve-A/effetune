class MultibandSaturationPlugin extends PluginBase {
    constructor() {
        super('Multiband Saturation', '3-band saturation effect');

        // Crossover frequencies
        this.f1 = 200;  // Low-Mid crossover
        this.f2 = 4000; // Mid-High crossover

        // Band parameters (3 bands with default values)
        this.bands = [
            { dr: 1.5, bs: 0.1, mx: 100, gn: 0 }, // Low
            { dr: 1.5, bs: 0.1, mx: 100, gn: 0 }, // Mid
            { dr: 1.5, bs: 0.1, mx: 100, gn: 0 }  // High
        ];

        this.selectedBand = 0;

        this.registerProcessor(this.getProcessorCode());
    }

    getProcessorCode() {
        // NOTE: This code runs in an AudioWorkletGlobalScope,
        // different from the main thread's window context.
        // Avoid using window, document, etc.
        // Math, Float32Array, etc. are available.
    
        return `
            // Cache frequently used parameters for faster access
            const pEnabled = parameters.enabled;
            if (!pEnabled) return data; // Early exit if disabled
    
            // Create a result buffer. It starts as a copy of the input data.
            let result = data; // Use input data directly
    
            const pSampleRate = parameters.sampleRate;
            const pChannelCount = parameters.channelCount;
            const pBlockSize = parameters.blockSize;
            // Ensure frequencies are always treated as an array of two elements
            const pFrequencies = [parameters.f1 || 0, parameters.f2 || 0]; 
            const pBands = parameters.bands; // Cache bands array reference
    
            // Check if filter states need to be reset (more efficiently)
            const currentConfig = context.filterConfig;
            const needsReset = !context.filterStates || // States don't exist
                             !currentConfig ||           // Config doesn't exist
                             currentConfig.sampleRate !== pSampleRate ||
                             currentConfig.channelCount !== pChannelCount ||
                             !currentConfig.frequencies || // Frequencies array missing in config
                             currentConfig.frequencies.length !== 2 || // Length mismatch
                             currentConfig.frequencies[0] !== pFrequencies[0] || // Direct frequency comparison
                             currentConfig.frequencies[1] !== pFrequencies[1];
    
            if (needsReset) {
                const dcOffset = 1e-25; // Small epsilon for DC blocking initialization
    
                // Function to create initial state for one channel (no Float32Arrays needed here)
                const createChannelFilterState = () => ({
                    stage1: { x1: dcOffset, x2: -dcOffset, y1: dcOffset, y2: -dcOffset },
                    stage2: { x1: dcOffset, x2: -dcOffset, y1: dcOffset, y2: -dcOffset }
                });
    
                // Initialize filter states (Array of states per channel)
                // Structure: filterStates.[lowpass|highpass][filterIndex][channelIndex]
                context.filterStates = {
                    lowpass: Array.from({ length: 2 }, () =>
                        Array.from({ length: pChannelCount }, createChannelFilterState)
                    ),
                    highpass: Array.from({ length: 2 }, () =>
                        Array.from({ length: pChannelCount }, createChannelFilterState)
                    )
                };
    
                // Store the configuration that led to this state reset
                context.filterConfig = {
                    sampleRate: pSampleRate,
                    frequencies: pFrequencies.slice(), // Store a copy
                    channelCount: pChannelCount
                };
    
                // Apply a short fade-in (crossfade) to prevent clicks on reset
                const fadeLength = Math.floor(pSampleRate * 0.005);
                context.fadeIn = {
                    counter: 0,
                    // Fade length: 5ms or block size, whichever is smaller
                    length: fadeLength > pBlockSize ? pBlockSize : fadeLength
                };
                
                // Clear cached filters forcing recalculation
                context.cachedFilters = null; 
            }
    
            // --- Filter Coefficient Calculation ---
            // Calculate coefficients only if they haven't been cached for the current config
            // Strict Linkwitz-Riley implementation: Butterworth_2 cascaded twice (LR4, -24dB/oct)
            if (!context.cachedFilters) {
                const sampleRateHalf = pSampleRate * 0.5;
                context.cachedFilters = new Array(2);
                const minFreq = 20.0; // Minimum reasonable frequency
                const maxFreq = sampleRateHalf - 1.0; // Nyquist - margin
    
                // Q factor for 2nd order Butterworth filter
                const Q = 1.0 / (2.0 * Math.sin(Math.PI / 4.0)); // Q = 1/(2*sin(π/4)) = 1/√2
    
                for (let i = 0; i < 2; i++) {
                    // Clamp frequency robustly, ensure it's within valid range
                    const rawFreq = pFrequencies[i];
                    const freq = rawFreq < minFreq ? minFreq : (rawFreq > maxFreq ? maxFreq : rawFreq);
                    
                    // Prewarp frequency (matching channel_divider.js implementation)
                    const K = 2.0 * pSampleRate;
                    const warped = 2.0 * pSampleRate * Math.tan(Math.PI * freq / pSampleRate);
                    const Om = warped;
                    const K2 = K * K;
                    const Om2 = Om * Om;
                    const K2Q = K2 * Q;
                    const Om2Q = Om2 * Q;
                    const a0 = K2Q + K * Om + Om2Q;
                    const a1 = -2.0 * K2Q + 2.0 * Om2Q;
                    const a2 = K2Q - K * Om + Om2Q;
    
                    // Lowpass coefficients (2nd order Butterworth)
                    const b0_lp = Om2Q / a0;
                    const b1_lp = (2.0 * Om2Q) / a0;
                    const b2_lp = Om2Q / a0;
                    const a1_lp = a1 / a0;
                    const a2_lp = a2 / a0;
                    
                    // Highpass coefficients (2nd order Butterworth)
                    const b0_hp = K2Q / a0;
                    const b1_hp = (-2.0 * K2Q) / a0;
                    const b2_hp = K2Q / a0;
                    const a1_hp = a1 / a0;
                    const a2_hp = a2 / a0;
    
                    // Store coefficients for cascaded application (LR4 = Butterworth_2 cascaded twice)
                    context.cachedFilters[i] = {
                        lowpass:  { b0: b0_lp, b1: b1_lp, b2: b2_lp, a1: a1_lp, a2: a2_lp },
                        highpass: { b0: b0_hp, b1: b1_hp, b2: b2_hp, a1: a1_hp, a2: a2_hp }
                    };
                }
            }
            // --- End Filter Coefficient Calculation ---
    
    
            // --- Biquad Filter Application Function (Optimized) ---
            // Applies a cascaded (2 stages) biquad filter using Transposed Direct Form II.
            // stateArray: Array containing state objects for each channel.
            function applyFilterBlock(input, output, coeffs, stateArray, ch, blockSize) {
                // Retrieve the state object for the current channel
                const state = stateArray[ch]; 
                const s1 = state.stage1; // State for the first stage
                const s2 = state.stage2; // State for the second stage
    
                // Cache coefficients locally for faster access inside the loop
                const b0 = coeffs.b0, b1 = coeffs.b1, b2 = coeffs.b2;
                const a1 = coeffs.a1, a2 = coeffs.a2;
                
                // Local variables for filter state registers (critical for performance)
                // These hold the state between samples within the block.
                let s1_x1 = s1.x1, s1_x2 = s1.x2, s1_y1 = s1.y1, s1_y2 = s1.y2;
                let s2_x1 = s2.x1, s2_x2 = s2.x2, s2_y1 = s2.y1, s2_y2 = s2.y2;
                
                // Process the block with loop unrolling (4 samples at a time) for speed.
                // Assumes blockSize is reasonably large.
                const blockSizeMod4 = blockSize - (blockSize % 4); // Equivalent to blockSize & ~3
                let i = 0;
                
                // Unrolled loop: Process 4 samples per iteration
                for (; i < blockSizeMod4; i += 4) {
                    // --- Sample 1 ---
                    let x0_1 = input[i]; 
                    let y1_1 = b0 * x0_1 + b1 * s1_x1 + b2 * s1_x2 - a1 * s1_y1 - a2 * s1_y2;
                    s1_x2 = s1_x1; s1_x1 = x0_1; s1_y2 = s1_y1; s1_y1 = y1_1; // Update stage 1 state
                    let y2_1 = b0 * y1_1 + b1 * s2_x1 + b2 * s2_x2 - a1 * s2_y1 - a2 * s2_y2;
                    s2_x2 = s2_x1; s2_x1 = y1_1; s2_y2 = s2_y1; s2_y1 = y2_1; // Update stage 2 state
                    output[i] = y2_1;
    
                    // --- Sample 2 ---
                    let x0_2 = input[i + 1];
                    let y1_2 = b0 * x0_2 + b1 * s1_x1 + b2 * s1_x2 - a1 * s1_y1 - a2 * s1_y2;
                    s1_x2 = s1_x1; s1_x1 = x0_2; s1_y2 = s1_y1; s1_y1 = y1_2;
                    let y2_2 = b0 * y1_2 + b1 * s2_x1 + b2 * s2_x2 - a1 * s2_y1 - a2 * s2_y2;
                    s2_x2 = s2_x1; s2_x1 = y1_2; s2_y2 = s2_y1; s2_y1 = y2_2;
                    output[i + 1] = y2_2;
    
                    // --- Sample 3 ---
                    let x0_3 = input[i + 2];
                    let y1_3 = b0 * x0_3 + b1 * s1_x1 + b2 * s1_x2 - a1 * s1_y1 - a2 * s1_y2;
                    s1_x2 = s1_x1; s1_x1 = x0_3; s1_y2 = s1_y1; s1_y1 = y1_3;
                    let y2_3 = b0 * y1_3 + b1 * s2_x1 + b2 * s2_x2 - a1 * s2_y1 - a2 * s2_y2;
                    s2_x2 = s2_x1; s2_x1 = y1_3; s2_y2 = s2_y1; s2_y1 = y2_3;
                    output[i + 2] = y2_3;
    
                    // --- Sample 4 ---
                    let x0_4 = input[i + 3];
                    let y1_4 = b0 * x0_4 + b1 * s1_x1 + b2 * s1_x2 - a1 * s1_y1 - a2 * s1_y2;
                    s1_x2 = s1_x1; s1_x1 = x0_4; s1_y2 = s1_y1; s1_y1 = y1_4;
                    let y2_4 = b0 * y1_4 + b1 * s2_x1 + b2 * s2_x2 - a1 * s2_y1 - a2 * s2_y2;
                    s2_x2 = s2_x1; s2_x1 = y1_4; s2_y2 = s2_y1; s2_y1 = y2_4;
                    output[i + 3] = y2_4;
                }
                
                // Handle remaining samples (if blockSize is not a multiple of 4)
                for (; i < blockSize; i++) {
                    const x0 = input[i];
                    const y1 = b0 * x0 + b1 * s1_x1 + b2 * s1_x2 - a1 * s1_y1 - a2 * s1_y2;
                    s1_x2 = s1_x1; s1_x1 = x0; s1_y2 = s1_y1; s1_y1 = y1;
                    
                    const y2 = b0 * y1 + b1 * s2_x1 + b2 * s2_x2 - a1 * s2_y1 - a2 * s2_y2;
                    s2_x2 = s2_x1; s2_x1 = y1; s2_y2 = s2_y1; s2_y1 = y2;
                    
                    output[i] = y2;
                }
                
                // IMPORTANT: Update the filter state in the context object for the next block processing.
                // Copy the final local state values back to the state object.
                s1.x1 = s1_x1; s1.x2 = s1_x2; s1.y1 = s1_y1; s1.y2 = s1_y2;
                s2.x1 = s2_x1; s2.x2 = s2_x2; s2.y1 = s2_y1; s2.y2 = s2_y2;
            }
            // --- End Biquad Filter Application Function ---
    
    
            // --- Buffer Management ---
            // Ensure band signal buffers (using a pooled Float32Array) exist and have the correct size.
            // This avoids reallocation in every process call.
            const requiredPoolSize = pChannelCount * 3 * pBlockSize; // 3 bands per channel
            if (!context.arrayPool || context.arrayPool.length !== requiredPoolSize) {
                context.arrayPool = new Float32Array(requiredPoolSize);
                // Recreate the views (subarrays) into the pool
                context.bandSignals = Array.from({ length: pChannelCount }, (_, ch) => 
                    Array.from({ length: 3 }, (_, band) => {
                        const offset = (ch * 3 + band) * pBlockSize;
                        return context.arrayPool.subarray(offset, offset + pBlockSize);
                    })
                );
            }
    
            // Ensure temporary buffers for intermediate filter results exist and have the correct block size.
            if (!context.tempBuffers || context.tempBuffers[0].length !== pBlockSize) {
                context.tempBuffers = [
                    new Float32Array(pBlockSize),
                    new Float32Array(pBlockSize)
                ];
            }
            // --- End Buffer Management ---
    
    
            // --- Main Processing Loop (Per Channel) ---
            // Cache frequently accessed context properties before the loop
            const bandSignals = context.bandSignals;
            const filterStates = context.filterStates; // Contains lowpass/highpass states
            const cachedFilters = context.cachedFilters; // Contains coefficients
            const tempBuffers = context.tempBuffers;
            const fadeInState = context.fadeIn; // Cache fade-in state object reference
            const fadeStartCounter = fadeInState ? fadeInState.counter : 0;
            const fadeLen = fadeInState ? fadeInState.length : 0;
            const fadeActive = fadeInState && fadeStartCounter < fadeLen;
    
            for (let ch = 0; ch < pChannelCount; ch++) {
                const channelOffset = ch * pBlockSize; // Starting index for this channel in the main buffer
                const channelBandSignals = bandSignals[ch]; // Subarrays for [low, mid, high] bands for this channel
                
                // Use temporary buffers for intermediate results to avoid extra allocations
                const inputBuffer = tempBuffers[0]; // For storing the initial channel data
                const hp1Buffer = tempBuffers[1];   // For storing the output of the first highpass filter
    
                // 1. Extract channel data efficiently using subarray view and set method
                inputBuffer.set(data.subarray(channelOffset, channelOffset + pBlockSize));
                
                // 2. --- Filtering Stages ---
                // Apply Linkwitz-Riley crossovers using the optimized filter function.
                
                // Band 0 (Low): Apply first lowpass filter directly to input. Output to channelBandSignals[0].
                applyFilterBlock(inputBuffer, channelBandSignals[0], cachedFilters[0].lowpass, filterStates.lowpass[0], ch, pBlockSize);
                
                // Calculate the first highpass branch. Output to hp1Buffer.
                applyFilterBlock(inputBuffer, hp1Buffer, cachedFilters[0].highpass, filterStates.highpass[0], ch, pBlockSize);
                
                // Band 1 (Mid): Apply second lowpass filter to the highpass result (hp1Buffer). Output to channelBandSignals[1].
                applyFilterBlock(hp1Buffer, channelBandSignals[1], cachedFilters[1].lowpass, filterStates.lowpass[1], ch, pBlockSize);
                
                // Band 2 (High): Apply second highpass filter to the highpass result (hp1Buffer). Output to channelBandSignals[2].
                applyFilterBlock(hp1Buffer, channelBandSignals[2], cachedFilters[1].highpass, filterStates.highpass[1], ch, pBlockSize);
                
                // 3. --- Saturation per Band ---
                for (let band = 0; band < 3; band++) {
                    // Cache band-specific parameters locally for the inner loop
                    const bandParams = pBands[band];
                    const dr = bandParams.dr;             // Drive
                    const bs = bandParams.bs;             // Bias
                    const mixRatio = bandParams.mx / 100.0; // Mix (0.0 to 1.0)
                    // Use exponentiation operator (**) for potentially better performance/readability
                    const gainLinear = 10.0**(bandParams.gn / 20.0); 
                    const biasOffset = Math.tanh(dr * bs); // Pre-calculate tanh offset due to bias
                    const oneMinusMix = 1.0 - mixRatio;   // Pre-calculate (1 - mix) for wet/dry mixing
    
                    const bandSignalBuffer = channelBandSignals[band]; // Get the Float32Array for the current band
                    
                    // Process saturation with loop unrolling (4 samples at a time)
                    const blockSizeMod4 = pBlockSize - (pBlockSize % 4);
                    let i = 0;
    
                    // Unrolled loop for saturation
                    for (; i < blockSizeMod4; i += 4) {
                        // Sample 1
                        let dry1 = bandSignalBuffer[i];
                        let wet1 = Math.tanh(dr * (dry1 + bs)) - biasOffset; // Apply drive, bias, tanh, and offset correction
                        bandSignalBuffer[i] = (dry1 * oneMinusMix + wet1 * mixRatio) * gainLinear; // Mix and apply gain
                        
                        // Sample 2
                        let dry2 = bandSignalBuffer[i+1];
                        let wet2 = Math.tanh(dr * (dry2 + bs)) - biasOffset;
                        bandSignalBuffer[i+1] = (dry2 * oneMinusMix + wet2 * mixRatio) * gainLinear;
                        
                        // Sample 3
                        let dry3 = bandSignalBuffer[i+2];
                        let wet3 = Math.tanh(dr * (dry3 + bs)) - biasOffset;
                        bandSignalBuffer[i+2] = (dry3 * oneMinusMix + wet3 * mixRatio) * gainLinear;
                        
                        // Sample 4
                        let dry4 = bandSignalBuffer[i+3];
                        let wet4 = Math.tanh(dr * (dry4 + bs)) - biasOffset;
                        bandSignalBuffer[i+3] = (dry4 * oneMinusMix + wet4 * mixRatio) * gainLinear;
                    }
                    
                    // Handle remaining samples (if pBlockSize is not a multiple of 4)
                    for (; i < pBlockSize; i++) {
                        const dry = bandSignalBuffer[i];
                        const wet = Math.tanh(dr * (dry + bs)) - biasOffset;
                        bandSignalBuffer[i] = (dry * oneMinusMix + wet * mixRatio) * gainLinear;
                    }
                } // End band saturation loop
                
                // 4. --- Sum Bands and Apply Fade-in ---
                // Combine the processed bands back into the final result buffer for this channel.
                const lowBand = channelBandSignals[0];
                const midBand = channelBandSignals[1];
                const highBand = channelBandSignals[2];
    
                // Check if fade-in is active (only happens right after reset)
                if (fadeActive) {
                    let fadeCounter = fadeStartCounter;
                    let i = 0;
                    for (; i < pBlockSize && fadeCounter < fadeLen; i++, fadeCounter++) {
                        const summedSample = lowBand[i] + midBand[i] + highBand[i];
                        const fadeGain = fadeCounter / fadeLen; 
                        result[channelOffset + i] = summedSample * fadeGain; 
                    }
                    for (; i < pBlockSize; i++) {
                         result[channelOffset + i] = lowBand[i] + midBand[i] + highBand[i];
                    }
                } else {
                    // Standard case: Sum all bands without fade-in
                    for (let i = 0; i < pBlockSize; i++) {
                        result[channelOffset + i] = lowBand[i] + midBand[i] + highBand[i];
                    }
                }
            } // End channel loop
            if (fadeActive) {
                const fadeNextCounter = fadeStartCounter + pBlockSize;
                fadeInState.counter = fadeNextCounter >= fadeLen ? fadeLen : fadeNextCounter;
                if (fadeInState.counter >= fadeLen) {
                    context.fadeIn = null;
                }
            } else if (fadeInState) {
                context.fadeIn = null;
            }
            // --- End Main Processing Loop ---
    
            // Return the buffer containing the processed audio data
            return result;
        `;
    }

    _normalizeCrossoverFrequencies() {
        let f1 = this.f1;
        f1 = f1 < 20 ? 20 : (f1 > 2000 ? 2000 : f1);

        let f2 = this.f2;
        const minF2 = f1 > 200 ? f1 : 200;
        f2 = f2 < minF2 ? minF2 : (f2 > 20000 ? 20000 : f2);

        this.f1 = f1;
        this.f2 = f2;
    }

    _syncCrossoverControls() {
        if (typeof document === 'undefined' || !this.instanceId) return;
        const values = [this.f1, this.f2];
        for (let i = 0; i < values.length; i++) {
            const freqNum = i + 1;
            const slider = document.getElementById(`${this.instanceId}-freq${freqNum}-slider`);
            const input = document.getElementById(`${this.instanceId}-freq${freqNum}-input`);
            if (slider) slider.value = values[i];
            if (input) input.value = values[i];
        }
    }

    setParameters(params) {
        let graphNeedsUpdate = false;
        let crossoverChanged = false;

        // Update crossover frequencies and normalize the full chain afterward.
        if (params.f1 !== undefined) {
            this.f1 = this.parseFiniteNumber(params.f1, 20, 2000, this.f1);
            crossoverChanged = true;
        }
        if (params.f2 !== undefined) {
            this.f2 = this.parseFiniteNumber(params.f2, 200, 20000, this.f2);
            crossoverChanged = true;
        }
        if (crossoverChanged) {
            this._normalizeCrossoverFrequencies();
            this._syncCrossoverControls();
            graphNeedsUpdate = true;
        }

        // Update band parameters if provided as an array
        if (Array.isArray(params.bands)) {
            params.bands.forEach((bandParams, i) => {
                if (i < 3) {
                    const band = this.bands[i];
                    if (bandParams.dr !== undefined) {
                        const drValue = bandParams.dr;
                        band.dr = drValue < 0 ? 0 : (drValue > 10 ? 10 : drValue);
                    }
                    if (bandParams.bs !== undefined) {
                        const bsValue = bandParams.bs;
                        band.bs = bsValue < -0.3 ? -0.3 : (bsValue > 0.3 ? 0.3 : bsValue);
                    }
                    if (bandParams.mx !== undefined) {
                        const mxValue = bandParams.mx;
                        band.mx = mxValue < 0 ? 0 : (mxValue > 100 ? 100 : mxValue);
                    }
                    if (bandParams.gn !== undefined) {
                        const gnValue = bandParams.gn;
                        band.gn = gnValue < -18 ? -18 : (gnValue > 18 ? 18 : gnValue);
                    }
                }
            });
            graphNeedsUpdate = true;
        } else if (params.band !== undefined) {
            const band = this.bands[params.band];
            if (!band) return;
            if (params.dr !== undefined) {
                const drValue = params.dr;
                band.dr = drValue < 0 ? 0 : (drValue > 10 ? 10 : drValue);
                graphNeedsUpdate = true;
            }
            if (params.bs !== undefined) {
                const bsValue = params.bs;
                band.bs = bsValue < -0.3 ? -0.3 : (bsValue > 0.3 ? 0.3 : bsValue);
                graphNeedsUpdate = true;
            }
            if (params.mx !== undefined) {
                const mxValue = params.mx;
                band.mx = mxValue < 0 ? 0 : (mxValue > 100 ? 100 : mxValue);
                graphNeedsUpdate = true;
            }
            if (params.gn !== undefined) {
                const gnValue = params.gn;
                band.gn = gnValue < -18 ? -18 : (gnValue > 18 ? 18 : gnValue);
                graphNeedsUpdate = true;
            }
        }

        if (params.enabled !== undefined) this.enabled = params.enabled;

        this.updateParameters();
        if (graphNeedsUpdate) this.updateTransferGraphs();
    }

    // Frequency slider setters
    setF1(value) { this.setParameters({ f1: value }); }
    setF2(value) { this.setParameters({ f2: value }); }

    // Band parameter setters
    setDr(value) { this.setParameters({ band: this.selectedBand, dr: value }); }
    setBs(value) { this.setParameters({ band: this.selectedBand, bs: value }); }
    setMx(value) { this.setParameters({ band: this.selectedBand, mx: value }); }
    setGn(value) { this.setParameters({ band: this.selectedBand, gn: value }); }

    getParameters() {
        return {
            type: this.constructor.name,
            f1: this.f1,
            f2: this.f2,
            bands: this.bands.map(b => ({
                dr: b.dr,
                bs: b.bs,
                mx: b.mx,
                gn: b.gn
            })),
            enabled: this.enabled
        };
    }

    updateTransferGraphs() {
        const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
        if (!container) return;

        if (!this.canvases) {
            this.canvases = Array.from(container.querySelectorAll('.mbs-band-graph canvas'));
            if (!this.canvases.length) return;
        }

        const GRID_COLOR = '#444';
        const LABEL_COLOR = '#666';
        const CURVE_COLOR = '#0f0';

        this.canvases.forEach((canvas, bandIndex) => {
            if (bandIndex >= this.bands.length) return;

            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const band = this.bands[bandIndex];
            if (!band) return;

            ctx.clearRect(0, 0, width, height);

            // Draw grid lines
            ctx.strokeStyle = GRID_COLOR;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0; x <= width; x += width / 4) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
            }
            for (let y = 0; y <= height; y += height / 4) {
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
            }
            ctx.stroke();

            // Draw labels
            ctx.fillStyle = LABEL_COLOR;
            ctx.font = '20px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('-6dB', width * 0.25, height - 5);
            ctx.fillText('-6dB', width * 0.75, height - 5);
            ctx.save();
            ctx.translate(20, height * 0.25);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('-6dB', 0, 0);
            ctx.restore();
            ctx.save();
            ctx.translate(20, height * 0.75);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('-6dB', 0, 0);
            ctx.restore();

            // Draw axis labels
            ctx.fillStyle = '#fff';
            ctx.font = '28px Arial';
            ctx.fillText('in', width / 2, height - 5);
            ctx.save();
            ctx.translate(20, height / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('out', 0, 0);
            ctx.restore();

            // Draw transfer curve
            ctx.strokeStyle = CURVE_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            const mixRatio = band.mx / 100;
            const biasOffset = Math.tanh(band.dr * band.bs);
            for (let i = 0; i < width; i++) {
                const x = (i / width) * 2 - 1;
                const wet = Math.tanh(band.dr * (x + band.bs)) - biasOffset;
                const y = ((1 - mixRatio) * x + mixRatio * wet) * Math.pow(10, band.gn / 20);
                const canvasY = ((1 - y) / 2) * height;
                if (i === 0) {
                    ctx.moveTo(i, canvasY);
                } else {
                    ctx.lineTo(i, canvasY);
                }
            }
            ctx.stroke();
        });
    }

    cleanup() {
        this.canvases = null;
        super.cleanup();
    }

    createUI() {
        const container = document.createElement('div');
        this.instanceId = `mbs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        container.className = 'mbs-container';
        container.setAttribute('data-instance-id', this.instanceId);

        // Frequency sliders UI
        const freqContainer = document.createElement('div');
        freqContainer.className = 'mbs-freq-sliders';

        const createFreqSlider = (label, min, max, value, setter, freqNum, idPrefix = this.instanceId) => {
            const sliderContainer = document.createElement('div');
            sliderContainer.className = 'mbs-freq-slider';

            const topRow = document.createElement('div');
            topRow.className = 'mbs-freq-slider-top';

            // Create unique IDs for the inputs using provided prefix
            const sliderId = `${idPrefix}-freq${freqNum}-slider`;
            const inputId = `${idPrefix}-freq${freqNum}-input`;

            const labelEl = document.createElement('label');
            labelEl.textContent = label;
            labelEl.htmlFor = sliderId;

            const numberInput = document.createElement('input');
            numberInput.type = 'number';
            numberInput.min = min;
            numberInput.max = max;
            numberInput.step = 1;
            numberInput.value = value;
            numberInput.id = inputId;
            numberInput.name = inputId;
            numberInput.autocomplete = "off";

            topRow.appendChild(labelEl);
            topRow.appendChild(numberInput);
            sliderContainer.appendChild(topRow);

            const rangeInput = document.createElement('input');
            rangeInput.type = 'range';
            rangeInput.min = min;
            rangeInput.max = max;
            rangeInput.step = 1;
            rangeInput.value = value;
            rangeInput.id = sliderId;
            rangeInput.name = sliderId;
            rangeInput.autocomplete = "off";

            rangeInput.addEventListener('input', (e) => {
                setter(parseFloat(e.target.value));
                const normalizedValue = this[`f${freqNum}`];
                rangeInput.value = normalizedValue;
                numberInput.value = normalizedValue;
            });
            numberInput.addEventListener('input', (e) => {
                const parsedValue = parseFloat(e.target.value) || 0;
                const val = parsedValue < min ? min : (parsedValue > max ? max : parsedValue);
                setter(val);
                const normalizedValue = this[`f${freqNum}`];
                rangeInput.value = normalizedValue;
                e.target.value = normalizedValue;
            });

            sliderContainer.appendChild(rangeInput);
            return sliderContainer;
        };

        freqContainer.appendChild(createFreqSlider('Freq 1 (Hz)', 20, 2000, this.f1, this.setF1.bind(this), 1, this.instanceId));
        freqContainer.appendChild(createFreqSlider('Freq 2 (Hz)', 200, 20000, this.f2, this.setF2.bind(this), 2, this.instanceId));
        container.appendChild(freqContainer);

        // Band settings UI
        const bandSettings = document.createElement('div');
        bandSettings.className = 'mbs-band-settings';
        const bandTabs = document.createElement('div');
        bandTabs.className = 'mbs-band-tabs';
        const bandContents = document.createElement('div');
        bandContents.className = 'mbs-band-contents';

        const bandNames = ['Low', 'Mid', 'High'];
        for (let i = 0; i < this.bands.length; i++) {
            const tab = document.createElement('button');
            tab.className = `mbs-band-tab ${i === 0 ? 'active' : ''}`;
            tab.textContent = bandNames[i];
            tab.setAttribute('data-instance-id', this.instanceId);
            
            tab.onclick = () => {
                if (i >= this.bands.length) return;
                const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
                container.querySelectorAll('.mbs-band-tab').forEach(t => t.classList.remove('active'));
                container.querySelectorAll('.mbs-band-content').forEach(c => c.classList.remove('active'));
                container.querySelectorAll('.mbs-band-graph').forEach((g, index) => {
                    g.classList.toggle('active', index === i);
                });
                tab.classList.add('active');
                content.classList.add('active');
                this.selectedBand = i;
                this.updateTransferGraphs();
            };
            bandTabs.appendChild(tab);

            const content = document.createElement('div');
            content.className = `mbs-band-content plugin-parameter-ui ${i === 0 ? 'active' : ''}`;
            content.setAttribute('data-instance-id', this.instanceId);

            const band = this.bands[i];
            
            // Create a wrapped version of createParameterControl that uses the bandIdPrefix
            const createBandControl = (label, min, max, step, value, setter, unit = '') => {
                // Temporarily store the original ID
                const originalId = this.id;
                
                // Temporarily change ID to include band index for uniqueness
                this.id = `${originalId}-band${i}`;
                
                // Create the control
                const control = this.createParameterControl(label, min, max, step, value, setter, unit);
                
                // Restore the original ID
                this.id = originalId;
                
                return control;
            };
            
            content.appendChild(createBandControl('Drive', 0, 10, 0.1, band.dr,
                 (v) => this.setDr(v), // Use bound setter directly
                 '' // No unit for Drive
            ));
            content.appendChild(createBandControl('Bias', -0.3, 0.3, 0.01, band.bs,
                (v) => this.setBs(v),
                '' // No unit for Bias
            ));
            content.appendChild(createBandControl('Mix', 0, 100, 1, band.mx,
                (v) => this.setMx(v),
                '%'
            ));
            content.appendChild(createBandControl('Gain', -18, 18, 0.1, band.gn,
                (v) => this.setGn(v),
                'dB'
            ));
            
            bandContents.appendChild(content);
        }

        bandSettings.appendChild(bandTabs);
        bandSettings.appendChild(bandContents);
        container.appendChild(bandSettings);

        // Transfer graphs UI
        const graphsContainer = document.createElement('div');
        graphsContainer.className = 'mbs-transfer-graphs';
        for (let i = 0; i < this.bands.length; i++) {
            const graphDiv = document.createElement('div');
            graphDiv.className = `mbs-band-graph ${i === 0 ? 'active' : ''}`;
            graphDiv.setAttribute('data-instance-id', this.instanceId);
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 320;
            canvas.style.width = '160px';
            canvas.style.height = '160px';
            canvas.style.backgroundColor = '#222';
            const label = document.createElement('div');
            label.className = 'mbs-band-graph-label';
            label.textContent = bandNames[i];
            graphDiv.appendChild(canvas);
            graphDiv.appendChild(label);
            
            // Add click event to switch to this band when clicking on the graph
            const bandIndex = i; // Capture the current band index
            graphDiv.addEventListener('click', () => {
                if (bandIndex >= this.bands.length) return;
                const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
                container.querySelectorAll('.mbs-band-tab').forEach(t => t.classList.remove('active'));
                container.querySelectorAll('.mbs-band-content').forEach(c => c.classList.remove('active'));
                container.querySelectorAll('.mbs-band-graph').forEach(g => g.classList.remove('active'));
                
                // Find and activate the corresponding tab and content
                const tabs = container.querySelectorAll('.mbs-band-tab');
                const contents = container.querySelectorAll('.mbs-band-content');
                if (bandIndex < tabs.length) tabs[bandIndex].classList.add('active');
                if (bandIndex < contents.length) contents[bandIndex].classList.add('active');
                graphDiv.classList.add('active');
                
                this.selectedBand = bandIndex;
                this.updateTransferGraphs();
            });
            
            graphsContainer.appendChild(graphDiv);
        }
        container.appendChild(graphsContainer);

        this.canvases = Array.from(container.querySelectorAll('.mbs-band-graph canvas'));
        
        setTimeout(() => {
            this.updateTransferGraphs();
        }, 0);

        return container;
    }
}

window.MultibandSaturationPlugin = MultibandSaturationPlugin;
