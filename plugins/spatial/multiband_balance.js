class MultibandBalancePlugin extends PluginBase {
    constructor() {
        super('Multiband Balance', '5-band stereo balance with crossover filters');

        // Crossover frequencies (same as Multiband Compressor)
        this.f1 = 100;  // Low
        this.f2 = 500;  // Low-mid
        this.f3 = 2000; // Mid
        this.f4 = 8000; // High

        // Band balance parameters (-100 to 100, default center)
        this.bands = [
            { balance: 0 }, // Low
            { balance: 0 }, // Low-mid
            { balance: 0 }, // Mid
            { balance: 0 }, // High-mid
            { balance: 0 }  // High
        ];

        this.selectedBand = 0;
        this.registerProcessor(this.getProcessorCode());
    }

    getProcessorCode() {
        return `
            if (!parameters.enabled || parameters.channelCount < 2) {
                return data;
            }
            let result = data;

            const frequencies = [parameters.f1, parameters.f2, parameters.f3, parameters.f4];
            const blockSize = parameters.blockSize;

            // Check if filter states need to be reset
            const frequenciesChanged = !context.filterConfig || !context.filterConfig.frequencies ||
                                     context.filterConfig.frequencies.some((f, i) => f !== frequencies[i]);
            const needsReset = !context.filterStates ||
                             !context.filterConfig ||
                             context.filterConfig.sampleRate !== parameters.sampleRate ||
                             context.filterConfig.channelCount !== parameters.channelCount ||
                             frequenciesChanged;

            if (needsReset) {
                // Create filter state with DC-blocking initialization
                const createFilterState = () => {
                    const state = {
                        stage1: {
                            x1: new Float32Array(parameters.channelCount),
                            x2: new Float32Array(parameters.channelCount),
                            y1: new Float32Array(parameters.channelCount),
                            y2: new Float32Array(parameters.channelCount)
                        },
                        stage2: {
                            x1: new Float32Array(parameters.channelCount),
                            x2: new Float32Array(parameters.channelCount),
                            y1: new Float32Array(parameters.channelCount),
                            y2: new Float32Array(parameters.channelCount)
                        }
                    };
                    const dcOffset = 1e-25;
                    for (let ch = 0; ch < parameters.channelCount; ch++) {
                        state.stage1.x1[ch] = dcOffset;
                        state.stage1.x2[ch] = -dcOffset;
                        state.stage1.y1[ch] = dcOffset;
                        state.stage1.y2[ch] = -dcOffset;
                        state.stage2.x1[ch] = dcOffset;
                        state.stage2.x2[ch] = -dcOffset;
                        state.stage2.y1[ch] = dcOffset;
                        state.stage2.y2[ch] = -dcOffset;
                    }
                    return state;
                };

                context.filterStates = {
                    lowpass: Array(4).fill(0).map(() => createFilterState()),
                    highpass: Array(4).fill(0).map(() => createFilterState())
                };

                context.filterConfig = {
                    sampleRate: parameters.sampleRate,
                    frequencies: frequencies.slice(),
                    channelCount: parameters.channelCount
                };

                // Apply a short fade-in to prevent clicks when filter states are reset
                context.fadeIn = {
                    counter: 0,
                    length: Math.min(parameters.blockSize, parameters.sampleRate * 0.005)
                };
            } else if (frequenciesChanged) {
                // Update frequencies in filterConfig even if reset is not needed
                context.filterConfig.frequencies = frequencies.slice();
            }

            // Helper function to apply cascaded Linkwitz-Riley filter to a block of samples (highly optimized)
            // For LR4, uses two different sections (Butterworth cascaded twice)
            function applyFilterBlock(input, output, coeffs, coeffsStage2, state, ch, blockSize) {
                const { b0, b1, b2, a1, a2 } = coeffs;
                const { b0: b0_2, b1: b1_2, b2: b2_2, a1: a1_2, a2: a2_2 } = coeffsStage2;
                const s1 = state.stage1, s2 = state.stage2;
                
                // Local variables for filter state (faster access)
                let s1_x1 = s1.x1[ch], s1_x2 = s1.x2[ch], s1_y1 = s1.y1[ch], s1_y2 = s1.y2[ch];
                let s2_x1 = s2.x1[ch], s2_x2 = s2.x2[ch], s2_y1 = s2.y1[ch], s2_y2 = s2.y2[ch];
                
                // Process the entire block with loop unrolling for better performance
                // Process 4 samples at a time when possible
                const blockSizeMod4 = blockSize & ~3; // Fast way to calculate blockSize - (blockSize % 4)
                let i = 0;
                
                // Main loop with 4-sample unrolling
                for (; i < blockSizeMod4; i += 4) {
                    // Sample 1
                    let sample = input[i];
                    let stage1_out = b0 * sample + b1 * s1_x1 + b2 * s1_x2 - a1 * s1_y1 - a2 * s1_y2;
                    s1_x2 = s1_x1;
                    s1_x1 = sample;
                    s1_y2 = s1_y1;
                    s1_y1 = stage1_out;
                    
                    let stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
                    s2_x2 = s2_x1;
                    s2_x1 = stage1_out;
                    s2_y2 = s2_y1;
                    s2_y1 = stage2_out;
                    
                    output[i] = stage2_out;
                    
                    // Sample 2
                    sample = input[i+1];
                    stage1_out = b0 * sample + b1 * s1_x1 + b2 * s1_x2 - a1 * s1_y1 - a2 * s1_y2;
                    s1_x2 = s1_x1;
                    s1_x1 = sample;
                    s1_y2 = s1_y1;
                    s1_y1 = stage1_out;
                    
                    stage2_out = b0 * stage1_out + b1 * s2_x1 + b2 * s2_x2 - a1 * s2_y1 - a2 * s2_y2;
                    s2_x2 = s2_x1;
                    s2_x1 = stage1_out;
                    s2_y2 = s2_y1;
                    s2_y1 = stage2_out;
                    
                    output[i+1] = stage2_out;
                    
                    // Sample 3
                    sample = input[i+2];
                    stage1_out = b0 * sample + b1 * s1_x1 + b2 * s1_x2 - a1 * s1_y1 - a2 * s1_y2;
                    s1_x2 = s1_x1;
                    s1_x1 = sample;
                    s1_y2 = s1_y1;
                    s1_y1 = stage1_out;
                    
                    stage2_out = b0 * stage1_out + b1 * s2_x1 + b2 * s2_x2 - a1 * s2_y1 - a2 * s2_y2;
                    s2_x2 = s2_x1;
                    s2_x1 = stage1_out;
                    s2_y2 = s2_y1;
                    s2_y1 = stage2_out;
                    
                    output[i+2] = stage2_out;
                    
                    // Sample 4
                    sample = input[i+3];
                    stage1_out = b0 * sample + b1 * s1_x1 + b2 * s1_x2 - a1 * s1_y1 - a2 * s1_y2;
                    s1_x2 = s1_x1;
                    s1_x1 = sample;
                    s1_y2 = s1_y1;
                    s1_y1 = stage1_out;
                    
                    stage2_out = b0 * stage1_out + b1 * s2_x1 + b2 * s2_x2 - a1 * s2_y1 - a2 * s2_y2;
                    s2_x2 = s2_x1;
                    s2_x1 = stage1_out;
                    s2_y2 = s2_y1;
                    s2_y1 = stage2_out;
                    
                    output[i+3] = stage2_out;
                }
                
                // Handle remaining samples
                for (; i < blockSize; i++) {
                    // First stage filtering
                    const stage1_out = b0 * input[i] + b1 * s1_x1 + b2 * s1_x2 - a1 * s1_y1 - a2 * s1_y2;
                    s1_x2 = s1_x1;
                    s1_x1 = input[i];
                    s1_y2 = s1_y1;
                    s1_y1 = stage1_out;
                    
                    // Second stage filtering
                    const stage2_out = b0_2 * stage1_out + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
                    s2_x2 = s2_x1;
                    s2_x1 = stage1_out;
                    s2_y2 = s2_y1;
                    s2_y1 = stage2_out;
                    
                    output[i] = stage2_out;
                }
                
                // Update filter state
                s1.x1[ch] = s1_x1; s1.x2[ch] = s1_x2; s1.y1[ch] = s1_y1; s1.y2[ch] = s1_y2;
                s2.x1[ch] = s2_x1; s2.x2[ch] = s2_x2; s2.y1[ch] = s2_y1; s2.y2[ch] = s2_y2;
            }

            // Cache filter coefficients if frequencies have changed
            // Use strict Linkwitz-Riley implementation (24dB/oct = LR4: 2nd order Butterworth cascaded twice)
            const frequenciesChangedForCoeffs = !context.cachedFilters || frequenciesChanged;
            
            if (frequenciesChangedForCoeffs) {
                // Helper functions for Linkwitz-Riley design (matching channel_divider.js)
                function computeButterworthQs(N) {
                    const Qs = [];
                    const pairs = Math.floor(N / 2);
                    for (let k = 1; k <= pairs; ++k) {
                        const theta = (2 * k - 1) * Math.PI / (2 * N);
                        const zeta = Math.sin(theta);
                        const Q = 1 / (2 * zeta);
                        Qs.push(Q);
                    }
                    return Qs;
                }
                
                function designFirstOrderButterworth(fs, fc, type) {
                    if (fc <= 0 || fc >= fs * 0.5) return null;
                    const K = 2 * fs;
                    const warped = 2 * fs * Math.tan(Math.PI * fc / fs);
                    const Om = warped;
                    const a0 = K + Om;
                    const a1 = Om - K;
                    let b0, b1;
                    if (type === "lp") {
                        b0 = Om;
                        b1 = Om;
                    } else {
                        b0 = -K;
                        b1 = K;
                    }
                    return { b0: b0 / a0, b1: b1 / a0, b2: 0, a1: a1 / a0, a2: 0 };
                }
                
                function designSecondOrderButterworth(fs, fc, Q, type) {
                    if (fc <= 0 || fc >= fs * 0.5) return null;
                    const K = 2 * fs;
                    const warped = 2 * fs * Math.tan(Math.PI * fc / fs);
                    const Om = warped;
                    const K2 = K * K;
                    const Om2 = Om * Om;
                    const K2Q = K2 * Q;
                    const Om2Q = Om2 * Q;
                    const a0 = K2Q + K * Om + Om2Q;
                    const a1 = -2 * K2Q + 2 * Om2Q;
                    const a2 = K2Q - K * Om + Om2Q;
                    let b0, b1, b2;
                    if (type === "lp") {
                        b0 = Om2Q;
                        b1 = 2 * Om2Q;
                        b2 = Om2Q;
                    } else {
                        b0 = K2Q;
                        b1 = -2 * K2Q;
                        b2 = K2Q;
                    }
                    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
                }
                
                function designButterworthSections(fs, fc, N, type) {
                    if (!Number.isFinite(N) || N <= 0) return [];
                    const sections = [];
                    const isOdd = (N % 2) !== 0;
                    if (isOdd) {
                        const sec1 = designFirstOrderButterworth(fs, fc, type);
                        if (sec1) sections.push(sec1);
                    }
                    const Qs = computeButterworthQs(N);
                    for (const Q of Qs) {
                        const sec2 = designSecondOrderButterworth(fs, fc, Q, type);
                        if (sec2) sections.push(sec2);
                    }
                    return sections;
                }
                
                function designLinkwitzRileySections(fs, fc, slope, type) {
                    if (slope === 0 || fc <= 0) return [];
                    const absSlope = Math.abs(slope);
                    if (absSlope % 12 !== 0) return [];
                    const N = absSlope / 12;
                    if (type !== "lp" && type !== "hp") return [];
                    const butter = designButterworthSections(fs, fc, N, type);
                    if (!butter.length) return [];
                    // LR: Butterworth_N cascaded twice
                    const lr = butter.slice();
                    for (let i = 0; i < butter.length; ++i) {
                        const s = butter[i];
                        lr.push({ b0: s.b0, b1: s.b1, b2: s.b2, a1: s.a1, a2: s.a2 });
                    }
                    return lr;
                }
                
                const sampleRate = parameters.sampleRate;
                context.cachedFilters = new Array(4);
                for (let i = 0; i < 4; i++) {
                    const freq = Math.max(10.0, Math.min(frequencies[i], sampleRate * 0.499));
                    const slope = -24; // 24dB/oct for multiband balance
                    const lpSections = designLinkwitzRileySections(sampleRate, freq, Math.abs(slope), "lp");
                    const hpSections = designLinkwitzRileySections(sampleRate, freq, Math.abs(slope), "hp");
                    
                    // For LR4 (24dB/oct), we have 2 sections (2nd order Butterworth cascaded twice)
                    // applyFilterBlock uses 2 stages, so we use the first section for stage1 and second for stage2
                    if (lpSections.length >= 2 && hpSections.length >= 2) {
                        context.cachedFilters[i] = {
                            lowpass: lpSections[0], // First Butterworth section
                            highpass: hpSections[0] // First Butterworth section
                        };
                        // Store second section separately for stage2
                        context.cachedFilters[i].lowpassStage2 = lpSections[1];
                        context.cachedFilters[i].highpassStage2 = hpSections[1];
                    } else {
                        // Fallback (should not happen with valid parameters)
                        context.cachedFilters[i] = {
                            lowpass: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
                            highpass: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
                            lowpassStage2: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
                            highpassStage2: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
                        };
                    }
                }
            }

            // Setup band signal buffers using a pooled TypedArray to avoid reallocation
            if (!context.bandSignals || context.bandSignals.length !== parameters.channelCount) {
                const totalArrays = parameters.channelCount * 5;
                const arrayPool = new Float32Array(totalArrays * parameters.blockSize);
                context.bandSignals = Array.from({ length: parameters.channelCount }, (_, ch) => {
                    return new Array(5).fill(0).map((_, band) => {
                        const offset = (ch * 5 + band) * parameters.blockSize;
                        return arrayPool.subarray(offset, offset + parameters.blockSize);
                    });
                });
                context.arrayPool = arrayPool; // Prevent GC of the pool
            }

            // Create temporary buffers for intermediate results if they don't exist
            if (!context.tempBuffers || context.tempBuffers.length !== 3) {
                context.tempBuffers = [
                    new Float32Array(parameters.blockSize),
                    new Float32Array(parameters.blockSize),
                    new Float32Array(parameters.blockSize)
                ];
            }

            // Create output buffer for summing if it doesn't exist
            if (!context.outputBuffer || context.outputBuffer.length !== parameters.blockSize * parameters.channelCount) {
                context.outputBuffer = new Float32Array(parameters.blockSize * parameters.channelCount);
            }

            // Process filtering for each channel (block processing)
            for (let ch = 0; ch < parameters.channelCount; ch++) {
                const offset = ch * parameters.blockSize;
                const bandSignals = context.bandSignals[ch];
                const filterStates = context.filterStates;
                
                // Extract channel data to temporary buffer
                const inputBuffer = context.tempBuffers[0];
                const hp1Buffer = context.tempBuffers[1];
                const hp2Buffer = context.tempBuffers[2];
                
                for (let i = 0; i < parameters.blockSize; i++) {
                    inputBuffer[i] = data[offset + i];
                }
                
                // Apply filters in blocks for better cache locality
                // Band 0 (Low) - direct lowpass on input
                applyFilterBlock(inputBuffer, bandSignals[0], context.cachedFilters[0].lowpass, context.cachedFilters[0].lowpassStage2, filterStates.lowpass[0], ch, parameters.blockSize);
                
                // Highpass branch for remaining bands
                applyFilterBlock(inputBuffer, hp1Buffer, context.cachedFilters[0].highpass, context.cachedFilters[0].highpassStage2, filterStates.highpass[0], ch, parameters.blockSize);
                
                // Band 1 (Low-Mid)
                applyFilterBlock(hp1Buffer, bandSignals[1], context.cachedFilters[1].lowpass, context.cachedFilters[1].lowpassStage2, filterStates.lowpass[1], ch, parameters.blockSize);
                
                // Highpass for bands 2-4
                applyFilterBlock(hp1Buffer, hp2Buffer, context.cachedFilters[1].highpass, context.cachedFilters[1].highpassStage2, filterStates.highpass[1], ch, parameters.blockSize);
                
                // Band 2 (Mid)
                applyFilterBlock(hp2Buffer, bandSignals[2], context.cachedFilters[2].lowpass, context.cachedFilters[2].lowpassStage2, filterStates.lowpass[2], ch, parameters.blockSize);
                
                // Highpass for bands 3-4
                applyFilterBlock(hp2Buffer, hp1Buffer, context.cachedFilters[2].highpass, context.cachedFilters[2].highpassStage2, filterStates.highpass[2], ch, parameters.blockSize); // Reuse hp1Buffer
                
                // Band 3 (High-Mid)
                applyFilterBlock(hp1Buffer, bandSignals[3], context.cachedFilters[3].lowpass, context.cachedFilters[3].lowpassStage2, filterStates.lowpass[3], ch, parameters.blockSize);
                
                // Band 4 (High)
                applyFilterBlock(hp1Buffer, bandSignals[4], context.cachedFilters[3].highpass, context.cachedFilters[3].highpassStage2, filterStates.highpass[3], ch, parameters.blockSize);
            }

            // Apply balance and sum bands
            const balanceValues = parameters.bands.map(b => b.balance / 100); // Convert percentage to -1.0 to 1.0
            const outputBuffer = context.outputBuffer;
            outputBuffer.fill(0); // Clear output buffer
            
            // Process each channel
            for (let ch = 0; ch < parameters.channelCount; ch++) {
                const offset = ch * parameters.blockSize;
                const bandSignals = context.bandSignals[ch];
                
                // Process each band with balance in blocks
                for (let band = 0; band < 5; band++) {
                    const balance = balanceValues[band];
                    const bandSignal = bandSignals[band];
                    
                    if ((balance >= 0 ? balance : -balance) < 1e-6) {
                        // Center position (balance = 0): no change
                        // Process in blocks with loop unrolling
                        const blockSizeMod4 = parameters.blockSize & ~3;
                        let i = 0;
                        
                        // Main loop with 4-sample unrolling
                        for (; i < blockSizeMod4; i += 4) {
                            outputBuffer[offset + i] += bandSignal[i];
                            outputBuffer[offset + i + 1] += bandSignal[i + 1];
                            outputBuffer[offset + i + 2] += bandSignal[i + 2];
                            outputBuffer[offset + i + 3] += bandSignal[i + 3];
                        }
                        
                        // Handle remaining samples
                        for (; i < parameters.blockSize; i++) {
                            outputBuffer[offset + i] += bandSignal[i];
                        }
                    } else {
                        // Apply balance
                        const leftGain = Math.max(0, 1 - balance);
                        const rightGain = Math.max(0, 1 + balance);
                        const gain = ch === 0 ? leftGain : rightGain;
                        
                        // Process in blocks with loop unrolling
                        const blockSizeMod4 = parameters.blockSize & ~3;
                        let i = 0;
                        
                        // Main loop with 4-sample unrolling
                        for (; i < blockSizeMod4; i += 4) {
                            outputBuffer[offset + i] += bandSignal[i] * gain;
                            outputBuffer[offset + i + 1] += bandSignal[i + 1] * gain;
                            outputBuffer[offset + i + 2] += bandSignal[i + 2] * gain;
                            outputBuffer[offset + i + 3] += bandSignal[i + 3] * gain;
                        }
                        
                        // Handle remaining samples
                        for (; i < parameters.blockSize; i++) {
                            outputBuffer[offset + i] += bandSignal[i] * gain;
                        }
                    }
                }
            }
            
            // Apply fade-in if needed and copy to result buffer
            if (context.fadeIn && context.fadeIn.counter < context.fadeIn.length) {
                const fadeInState = context.fadeIn;
                const fadeStartCounter = fadeInState.counter;
                const fadeLen = fadeInState.length;
                for (let i = 0; i < parameters.blockSize; i++) {
                    const fadeCounter = fadeStartCounter + i;
                    const fadeGain = fadeCounter < fadeLen ? fadeCounter / fadeLen : 1;
                    for (let ch = 0; ch < parameters.channelCount; ch++) {
                        const index = ch * parameters.blockSize + i;
                        result[index] = outputBuffer[index] * fadeGain;
                    }
                }
                const fadeNextCounter = fadeStartCounter + parameters.blockSize;
                fadeInState.counter = fadeNextCounter >= fadeLen ? fadeLen : fadeNextCounter;
                if (fadeInState.counter >= fadeLen) {
                    context.fadeIn = null;
                }
            } else {
                // Copy output buffer to result
                result.set(outputBuffer);
            }

            return result;
        `;
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            f1: this.f1,
            f2: this.f2,
            f3: this.f3,
            f4: this.f4,
            bands: this.bands.map(b => ({ balance: b.balance }))
        };
    }

    _normalizeCrossoverFrequencies() {
        let f1 = this.f1;
        f1 = f1 < 20 ? 20 : (f1 > 500 ? 500 : f1);

        let f2 = this.f2;
        const minF2 = f1 > 100 ? f1 : 100;
        f2 = f2 < minF2 ? minF2 : (f2 > 2000 ? 2000 : f2);

        let f3 = this.f3;
        const minF3 = f2 > 500 ? f2 : 500;
        f3 = f3 < minF3 ? minF3 : (f3 > 8000 ? 8000 : f3);

        let f4 = this.f4;
        const minF4 = f3 > 1000 ? f3 : 1000;
        f4 = f4 < minF4 ? minF4 : (f4 > 20000 ? 20000 : f4);

        this.f1 = f1;
        this.f2 = f2;
        this.f3 = f3;
        this.f4 = f4;
    }

    _syncCrossoverControls() {
        if (typeof document === 'undefined') return;
        const values = [this.f1, this.f2, this.f3, this.f4];
        for (let i = 0; i < values.length; i++) {
            const freqNum = i + 1;
            const slider = document.getElementById(`${this.id}-${this.name}-freq${freqNum}-slider`);
            const input = document.getElementById(`${this.id}-${this.name}-freq${freqNum}-input`);
            if (slider) slider.value = values[i];
            if (input) input.value = values[i];
        }
    }

    setParameters(params) {
        let crossoverChanged = false;

        // Update crossover frequencies and normalize the full chain afterward.
        if (params.f1 !== undefined) {
            this.f1 = this.parseFiniteNumber(params.f1, 20, 500, this.f1);
            crossoverChanged = true;
        }
        if (params.f2 !== undefined) {
            this.f2 = this.parseFiniteNumber(params.f2, 100, 2000, this.f2);
            crossoverChanged = true;
        }
        if (params.f3 !== undefined) {
            this.f3 = this.parseFiniteNumber(params.f3, 500, 8000, this.f3);
            crossoverChanged = true;
        }
        if (params.f4 !== undefined) {
            this.f4 = this.parseFiniteNumber(params.f4, 1000, 20000, this.f4);
            crossoverChanged = true;
        }
        if (crossoverChanged) {
            this._normalizeCrossoverFrequencies();
            this._syncCrossoverControls();
        }

        // Update band parameters if provided as an array
        if (Array.isArray(params.bands)) {
            params.bands.forEach((bandParams, i) => {
                if (i < 5 && bandParams.balance !== undefined) {
                    this.bands[i].balance = bandParams.balance < -100 ? -100 : (bandParams.balance > 100 ? 100 : bandParams.balance);
                }
            });
        } else if (params.band !== undefined && params.balance !== undefined) {
            // Update a single band's balance
            if (params.band >= 0 && params.band < 5) {
                this.bands[params.band].balance = params.balance < -100 ? -100 : (params.balance > 100 ? 100 : params.balance);
            }
        }

        if (params.enabled !== undefined) this.enabled = params.enabled;
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'multiband-balance-container';

        // Frequency sliders UI
        const freqContainer = document.createElement('div');
        freqContainer.className = 'plugin-parameter-ui';
        const freqSliders = document.createElement('div');
        freqSliders.className = 'multiband-balance-frequency-sliders';
        freqContainer.appendChild(freqSliders);

        const createFreqSlider = (label, min, max, value, setter, freqNum) => {
            const sliderContainer = document.createElement('div');
            sliderContainer.className = 'multiband-balance-frequency-slider';
            const topRow = document.createElement('div');
            topRow.className = 'multiband-balance-frequency-slider-top';
            
            // Create unique IDs for the inputs
            const sliderId = `${this.id}-${this.name}-freq${freqNum}-slider`;
            const inputId = `${this.id}-${this.name}-freq${freqNum}-input`;
            
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
            
            topRow.appendChild(labelEl);
            topRow.appendChild(numberInput);
            sliderContainer.appendChild(topRow);
            sliderContainer.appendChild(rangeInput);
            return sliderContainer;
        };

        freqSliders.appendChild(createFreqSlider('Freq 1 (Hz):', 20, 500, this.f1, (value) => this.setParameters({ f1: value }), 1));
        freqSliders.appendChild(createFreqSlider('Freq 2 (Hz):', 100, 2000, this.f2, (value) => this.setParameters({ f2: value }), 2));
        freqSliders.appendChild(createFreqSlider('Freq 3 (Hz):', 500, 8000, this.f3, (value) => this.setParameters({ f3: value }), 3));
        freqSliders.appendChild(createFreqSlider('Freq 4 (Hz):', 1000, 20000, this.f4, (value) => this.setParameters({ f4: value }), 4));
        container.appendChild(freqContainer);

        // Band balance sliders UI
        const bandContainer = document.createElement('div');
        bandContainer.className = 'plugin-parameter-ui';
        const bandBalances = document.createElement('div');
        bandBalances.className = 'multiband-balance-band-balances';
        bandContainer.appendChild(bandBalances);

        // Use base helper to create balance sliders
        // Note: Labels reflect band number (1-5)
        bandBalances.appendChild(this.createParameterControl(
            'Band 5 Bal.', -100, 100, 1, this.bands[4].balance,
            (value) => this.setParameters({ band: 4, balance: value }), '%'
        ));
        bandBalances.appendChild(this.createParameterControl(
            'Band 4 Bal.', -100, 100, 1, this.bands[3].balance,
            (value) => this.setParameters({ band: 3, balance: value }), '%'
        ));
        bandBalances.appendChild(this.createParameterControl(
            'Band 3 Bal.', -100, 100, 1, this.bands[2].balance,
            (value) => this.setParameters({ band: 2, balance: value }), '%'
        ));
        bandBalances.appendChild(this.createParameterControl(
            'Band 2 Bal.', -100, 100, 1, this.bands[1].balance,
            (value) => this.setParameters({ band: 1, balance: value }), '%'
        ));
        bandBalances.appendChild(this.createParameterControl(
            'Band 1 Bal.', -100, 100, 1, this.bands[0].balance,
            (value) => this.setParameters({ band: 0, balance: value }), '%'
        ));
        container.appendChild(bandContainer);

        return container;
    }
}

window.MultibandBalancePlugin = MultibandBalancePlugin;
