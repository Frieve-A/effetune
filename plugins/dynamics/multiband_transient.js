class MultibandTransientPlugin extends PluginBase {
    constructor() {
        super('Multiband Transient', '3-band transient shaper effect');

        // Crossover frequencies
        this.f1 = 200;  // Low-Mid crossover
        this.f2 = 4000; // Mid-High crossover

        // Band parameters (3 bands with default values from transient shaper)
        this.bands = [
            { fa: 5.0, fr: 50.0, sa: 25.0, sr: 250.0, gt: 6.0, gs: 0.0, sm: 5.0 }, // Low
            { fa: 2.0, fr: 30.0, sa: 10.0, sr: 150.0, gt: 6.0, gs: 0.0, sm: 5.0 }, // Mid
            { fa: 0.5, fr: 20.0, sa: 5.0,  sr: 100.0, gt: 6.0, gs: 0.0, sm: 5.0 }  // High
        ];

        this.selectedBand = 0;

        // Graph state
        this.canvases = [];
        this.boundEventListeners = new Map();
        this.animationFrameId = null;
        this.graphResizeDisposers = [];

        // Gain history buffers for each band (306 points)
        this.gainBuffers = [
            new Float32Array(306).fill(NaN),
            new Float32Array(306).fill(NaN),
            new Float32Array(306).fill(NaN)
        ];
        this.secondMarkers = [[], [], []];
        this.prevTime = null;

        this.observer = null;

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
                
                // Initialize transient shaper states for each band
                context.transientStates = Array.from({ length: 3 }, () => ({
                    fastEnv: new Float32Array(pChannelCount),
                    slowEnv: new Float32Array(pChannelCount),
                    gain: 1.0
                }));
            }
    
            // --- Filter Coefficient Calculation ---
            // Calculate coefficients only if they haven't been cached for the current config
        if (!context.cachedFilters) {
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
                    const lr = butter.slice();
                    for (let i = 0; i < butter.length; ++i) {
                        const s = butter[i];
                        lr.push({ b0: s.b0, b1: s.b1, b2: s.b2, a1: s.a1, a2: s.a2 });
                    }
                    return lr;
                }

                const sampleRateLocal = pSampleRate;
                const identityCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

                const pickStages = (sections) => {
                    if (!sections || sections.length === 0) return [identityCoeffs, identityCoeffs];
                    if (sections.length === 1) return [sections[0], sections[0]];
                    return [sections[0], sections[1]];
                };

                context.cachedFilters = new Array(2);

                for (let i = 0; i < 2; i++) {
                    const rawFreq = pFrequencies[i];
                    const freq = Math.max(10.0, Math.min(rawFreq, sampleRateLocal * 0.499));

                    const lpSections = designLinkwitzRileySections(sampleRateLocal, freq, 24, "lp");
                    const hpSections = designLinkwitzRileySections(sampleRateLocal, freq, 24, "hp");

                    const [lpStage1, lpStage2] = pickStages(lpSections);
                    const [hpStage1, hpStage2] = pickStages(hpSections);

                    context.cachedFilters[i] = {
                        lowpassStage1: lpStage1,
                        lowpassStage2: lpStage2,
                        highpassStage1: hpStage1,
                        highpassStage2: hpStage2
                    };
                }
            }
            // --- End Filter Coefficient Calculation ---
    
    
            // --- Biquad Filter Application Function (Optimized) ---
            // Applies a cascaded (2 stages) biquad filter using Transposed Direct Form II.
            // stateArray: Array containing state objects for each channel.
            function applyFilterBlock(input, output, coeffsStage1, coeffsStage2, stateArray, ch, blockSize) {
                // Retrieve the state object for the current channel
                const state = stateArray[ch]; 
                const s1 = state.stage1; // State for the first stage
                const s2 = state.stage2; // State for the second stage

                const stage1Coeffs = coeffsStage1 || { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
                const stage2Coeffs = coeffsStage2 || { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

                // Cache coefficients locally for faster access inside the loop
                const b0_1 = stage1Coeffs.b0, b1_1 = stage1Coeffs.b1, b2_1 = stage1Coeffs.b2;
                const a1_1 = stage1Coeffs.a1, a2_1 = stage1Coeffs.a2;
                const b0_2 = stage2Coeffs.b0, b1_2 = stage2Coeffs.b1, b2_2 = stage2Coeffs.b2;
                const a1_2 = stage2Coeffs.a1, a2_2 = stage2Coeffs.a2;
                
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
                    let y1_1 = b0_1 * x0_1 + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
                    s1_x2 = s1_x1; s1_x1 = x0_1; s1_y2 = s1_y1; s1_y1 = y1_1; // Update stage 1 state
                    let y2_1 = b0_2 * y1_1 + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
                    s2_x2 = s2_x1; s2_x1 = y1_1; s2_y2 = s2_y1; s2_y1 = y2_1; // Update stage 2 state
                    output[i] = y2_1;
    
                    // --- Sample 2 ---
                    let x0_2 = input[i + 1];
                    let y1_2 = b0_1 * x0_2 + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
                    s1_x2 = s1_x1; s1_x1 = x0_2; s1_y2 = s1_y1; s1_y1 = y1_2;
                    let y2_2 = b0_2 * y1_2 + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
                    s2_x2 = s2_x1; s2_x1 = y1_2; s2_y2 = s2_y1; s2_y1 = y2_2;
                    output[i + 1] = y2_2;
    
                    // --- Sample 3 ---
                    let x0_3 = input[i + 2];
                    let y1_3 = b0_1 * x0_3 + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
                    s1_x2 = s1_x1; s1_x1 = x0_3; s1_y2 = s1_y1; s1_y1 = y1_3;
                    let y2_3 = b0_2 * y1_3 + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
                    s2_x2 = s2_x1; s2_x1 = y1_3; s2_y2 = s2_y1; s2_y1 = y2_3;
                    output[i + 2] = y2_3;
    
                    // --- Sample 4 ---
                    let x0_4 = input[i + 3];
                    let y1_4 = b0_1 * x0_4 + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
                    s1_x2 = s1_x1; s1_x1 = x0_4; s1_y2 = s1_y1; s1_y1 = y1_4;
                    let y2_4 = b0_2 * y1_4 + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
                    s2_x2 = s2_x1; s2_x1 = y1_4; s2_y2 = s2_y1; s2_y1 = y2_4;
                    output[i + 3] = y2_4;
                }
                
                // Handle remaining samples (if blockSize is not a multiple of 4)
                for (; i < blockSize; i++) {
                    const x0 = input[i];
                    const y1 = b0_1 * x0 + b1_1 * s1_x1 + b2_1 * s1_x2 - a1_1 * s1_y1 - a2_1 * s1_y2;
                    s1_x2 = s1_x1; s1_x1 = x0; s1_y2 = s1_y1; s1_y1 = y1;
                    
                    const y2 = b0_2 * y1 + b1_2 * s2_x1 + b2_2 * s2_x2 - a1_2 * s2_y1 - a2_2 * s2_y2;
                    s2_x2 = s2_x1; s2_x1 = y1; s2_y2 = s2_y1; s2_y1 = y2;
                    output[i] = y2;
                }
                
                // Update state back to the object (critical for persistence)
                s1.x1 = s1_x1; s1.x2 = s1_x2; s1.y1 = s1_y1; s1.y2 = s1_y2;
                s2.x1 = s2_x1; s2.x2 = s2_x2; s2.y1 = s2_y1; s2.y2 = s2_y2;
            }
            // --- End Biquad Filter Application Function ---
    
            // Allocate temporary buffers (reuse to avoid garbage collection)
            if (!context.tempBuffers || context.tempBuffers.length !== pChannelCount * 3) {
                const bufferSize = pChannelCount * pBlockSize;
                context.tempBuffers = Array.from({ length: 3 }, () => new Float32Array(bufferSize));
            }
    
            const bands = context.tempBuffers; // Low, Mid, High bands
            const [lowBand, midBand, highBand] = bands;
    
            // Split input into frequency bands
            // 1. Low band = lowpass at f1
            for (let ch = 0; ch < pChannelCount; ch++) {
                const chOffset = ch * pBlockSize;
                const inputChannel = result.subarray(chOffset, chOffset + pBlockSize);
                const outputChannel = lowBand.subarray(chOffset, chOffset + pBlockSize);
                
                applyFilterBlock(inputChannel, outputChannel, 
                    context.cachedFilters[0].lowpassStage1, 
                    context.cachedFilters[0].lowpassStage2,
                    context.filterStates.lowpass[0], ch, pBlockSize);
            }
            
            // 2. High band = highpass at f2 of input
            for (let ch = 0; ch < pChannelCount; ch++) {
                const chOffset = ch * pBlockSize;
                const inputChannel = result.subarray(chOffset, chOffset + pBlockSize);
                const outputChannel = highBand.subarray(chOffset, chOffset + pBlockSize);
                
                applyFilterBlock(inputChannel, outputChannel, 
                    context.cachedFilters[1].highpassStage1, 
                    context.cachedFilters[1].highpassStage2,
                    context.filterStates.highpass[1], ch, pBlockSize);
            }
            
            // 3. Mid band = highpass at f1 + lowpass at f2
            // First highpass at f1
            for (let ch = 0; ch < pChannelCount; ch++) {
                const chOffset = ch * pBlockSize;
                const inputChannel = result.subarray(chOffset, chOffset + pBlockSize);
                const outputChannel = midBand.subarray(chOffset, chOffset + pBlockSize);
                
                applyFilterBlock(inputChannel, outputChannel, 
                    context.cachedFilters[0].highpassStage1, 
                    context.cachedFilters[0].highpassStage2,
                    context.filterStates.highpass[0], ch, pBlockSize);
            }
            // Then lowpass at f2
            for (let ch = 0; ch < pChannelCount; ch++) {
                const chOffset = ch * pBlockSize;
                const inputChannel = midBand.subarray(chOffset, chOffset + pBlockSize);
                const outputChannel = midBand.subarray(chOffset, chOffset + pBlockSize);
                
                applyFilterBlock(inputChannel, outputChannel, 
                    context.cachedFilters[1].lowpassStage1, 
                    context.cachedFilters[1].lowpassStage2,
                    context.filterStates.lowpass[1], ch, pBlockSize);
            }
    
            // Apply transient shaping to each band
            const LN10_OVER_20 = Math.LN10 / 20;
            const gains = [];
            
            for (let bandIdx = 0; bandIdx < 3; bandIdx++) {
                const band = pBands[bandIdx];
                const bandData = bands[bandIdx];
                const transientState = context.transientStates[bandIdx];
                
                const gTr = Math.exp(band.gt * LN10_OVER_20);
                const gSus = Math.exp(band.gs * LN10_OVER_20);
    
                const aFaAtk = Math.exp(-1.0 / (band.fa * 0.001 * pSampleRate));
                const aFaRel = Math.exp(-1.0 / (band.fr * 0.001 * pSampleRate));
                const aSaAtk = Math.exp(-1.0 / (band.sa * 0.001 * pSampleRate));
                const aSaRel = Math.exp(-1.0 / (band.sr * 0.001 * pSampleRate));
                const aSmooth = Math.exp(-1.0 / (band.sm * 0.001 * pSampleRate));
    
                const fastEnv = transientState.fastEnv;
                const slowEnv = transientState.slowEnv;
                let g = transientState.gain;
    
                for (let i = 0; i < pBlockSize; i++) {
                    let maxDiff = 0;
    
                    for (let ch = 0; ch < pChannelCount; ch++) {
                        const index = ch * pBlockSize + i;
                        const xAbs = bandData[index] < 0 ? -bandData[index] : bandData[index];
    
                        const coeffFast = xAbs > fastEnv[ch] ? aFaAtk : aFaRel;
                        fastEnv[ch] = fastEnv[ch] * coeffFast + xAbs * (1 - coeffFast);
    
                        const coeffSlow = xAbs > slowEnv[ch] ? aSaAtk : aSaRel;
                        slowEnv[ch] = slowEnv[ch] * coeffSlow + xAbs * (1 - coeffSlow);
    
                        const diff = fastEnv[ch] - slowEnv[ch];
                        if (diff > maxDiff) maxDiff = diff;
                    }
    
                    const T = maxDiff > 0 ? maxDiff : 0;
                    const gTrVal = 1 + (gTr - 1) * T;
                    const gSusVal = 1 + (gSus - 1) * (1 - T);
                    const target = gTrVal * gSusVal;
    
                    g = (1 - aSmooth) * target + aSmooth * g;
    
                    for (let ch = 0; ch < pChannelCount; ch++) {
                        const index = ch * pBlockSize + i;
                        let y = bandData[index] * g;
                        if (y > 1.0) y = 1.0;
                        else if (y < -1.0) y = -1.0;
                        bandData[index] = y;
                    }
                }
    
                transientState.gain = g;
                gains.push(20 * Math.log10(g));
            }
    
            // Sum processed bands
            for (let ch = 0; ch < pChannelCount; ch++) {
                const chOffset = ch * pBlockSize;
                for (let i = 0; i < pBlockSize; i++) {
                    const index = chOffset + i;
                    result[index] = lowBand[index] + midBand[index] + highBand[index];
                }
            }
    
            // Fade in if needed
            if (context.fadeIn && context.fadeIn.counter < context.fadeIn.length) {
                const fadeIn = context.fadeIn;
                const samplesLeft = fadeIn.length - fadeIn.counter;
                const samplesToProcess = samplesLeft < pBlockSize ? samplesLeft : pBlockSize;
                
                for (let i = 0; i < samplesToProcess; i++) {
                    const fadeGain = (fadeIn.counter + i) / fadeIn.length;
                    for (let ch = 0; ch < pChannelCount; ch++) {
                        const index = ch * pBlockSize + i;
                        result[index] *= fadeGain;
                    }
                }
                
                fadeIn.counter += samplesToProcess;
                if (fadeIn.counter >= fadeIn.length) {
                    context.fadeIn = null; // Mark fade-in as complete
                }
            }
    
            // Add gain measurements for graph display
            data.measurements = {
                gains: gains,
                time: time
            };
    
            return result;
        `;
    }

    onMessage(message) {
        if (message.type === 'processBuffer' && message.measurements) {
            // Update each band's gain buffer
            for (let bandIdx = 0; bandIdx < 3; bandIdx++) {
                // Shift gain buffer
                this.gainBuffers[bandIdx].copyWithin(0, 1);

                // Shift marker positions
                this.secondMarkers[bandIdx] = this.secondMarkers[bandIdx].map(v => v - 1).filter(v => v >= 0);

                const t = message.measurements.time;
                if (this.prevTime !== null && !Number.isNaN(t) && Math.floor(this.prevTime) !== Math.floor(t)) {
                    this.secondMarkers[bandIdx].push(this.gainBuffers[bandIdx].length - 1);
                }

                // Store gain value
                this.gainBuffers[bandIdx][this.gainBuffers[bandIdx].length - 1] = message.measurements.gains[bandIdx];
            }
            this.prevTime = message.measurements.time;
        }
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
        let crossoverChanged = false;
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
        }
        
        // Handle bands array for preset loading and copy/paste
        if (params.bands && Array.isArray(params.bands)) {
            params.bands.forEach((bandParams, i) => {
                if (i < this.bands.length && bandParams) {
                    const band = this.bands[i];
                    if (bandParams.fa !== undefined) band.fa = this.parseFiniteNumber(bandParams.fa, 0.1, 10.0, band.fa);
                    if (bandParams.fr !== undefined) band.fr = this.parseFiniteNumber(bandParams.fr, 1, 200, band.fr);
                    if (bandParams.sa !== undefined) band.sa = this.parseFiniteNumber(bandParams.sa, 1, 100, band.sa);
                    if (bandParams.sr !== undefined) band.sr = this.parseFiniteNumber(bandParams.sr, 50, 1000, band.sr);
                    if (bandParams.gt !== undefined) band.gt = this.parseFiniteNumber(bandParams.gt, -24, 24, band.gt);
                    if (bandParams.gs !== undefined) band.gs = this.parseFiniteNumber(bandParams.gs, -24, 24, band.gs);
                    if (bandParams.sm !== undefined) band.sm = this.parseFiniteNumber(bandParams.sm, 0.1, 20.0, band.sm);
                }
            });
        }
        // Handle individual band parameter updates
        else if (params.band !== undefined && params.band >= 0 && params.band < this.bands.length) {
            const band = this.bands[params.band];
            if (params.fa !== undefined) band.fa = this.parseFiniteNumber(params.fa, 0.1, 10.0, band.fa);
            if (params.fr !== undefined) band.fr = this.parseFiniteNumber(params.fr, 1, 200, band.fr);
            if (params.sa !== undefined) band.sa = this.parseFiniteNumber(params.sa, 1, 100, band.sa);
            if (params.sr !== undefined) band.sr = this.parseFiniteNumber(params.sr, 50, 1000, band.sr);
            if (params.gt !== undefined) band.gt = this.parseFiniteNumber(params.gt, -24, 24, band.gt);
            if (params.gs !== undefined) band.gs = this.parseFiniteNumber(params.gs, -24, 24, band.gs);
            if (params.sm !== undefined) band.sm = this.parseFiniteNumber(params.sm, 0.1, 20.0, band.sm);
        }
        
        if (params.enabled !== undefined) this.enabled = params.enabled;
        this.updateParameters();
    }

    setF1(value) { this.setParameters({ f1: value }); }
    setF2(value) { this.setParameters({ f2: value }); }

    setFa(value) { this.setParameters({ band: this.selectedBand, fa: value }); }
    setFr(value) { this.setParameters({ band: this.selectedBand, fr: value }); }
    setSa(value) { this.setParameters({ band: this.selectedBand, sa: value }); }
    setSr(value) { this.setParameters({ band: this.selectedBand, sr: value }); }
    setGt(value) { this.setParameters({ band: this.selectedBand, gt: value }); }
    setGs(value) { this.setParameters({ band: this.selectedBand, gs: value }); }
    setSm(value) { this.setParameters({ band: this.selectedBand, sm: value }); }

    getParameters() {
        return {
            type: this.constructor.name,
            f1: this.f1,
            f2: this.f2,
            bands: this.bands.map(band => ({ ...band })),
            enabled: this.enabled
        };
    }

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
            this.drawGraphs();
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

    disposeGraphResizeObservers() {
        this.graphResizeDisposers.forEach(dispose => dispose());
        this.graphResizeDisposers = [];
    }

    drawGraphs() {
        if (!this.canvases || this.canvases.length === 0) return;
        
        for (let bandIdx = 0; bandIdx < 3; bandIdx++) {
            const canvas = this.canvases[bandIdx];
            if (!canvas) continue;

            const ctx = canvas.getContext('2d');
            if (!ctx) continue;

            const width = canvas.width;
            const height = canvas.height;
            const cssWidth = canvas.clientWidth || width;
            const dpr = cssWidth > 0 ? width / cssWidth : 1;
            const tickFontSize = 12 * dpr;
            const axisFontSize = 14 * dpr;
            const labelX = 50 * dpr;
            const axisX = 20 * dpr;
            const tickOffset = 6 * dpr;
            const bottomOffset = 5 * dpr;
            const secondMarkerHeight = 8 * dpr;
            const isMobileLayout = typeof document !== 'undefined' && document.body && document.body.classList.contains('layout-mobile');
            const graphLineWidth = (isMobileLayout ? 2 : 1) * dpr;

            // Clear canvas
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, width, height);

            // Draw grid lines and labels
            ctx.strokeStyle = '#333';
            ctx.lineWidth = graphLineWidth;
            ctx.textAlign = 'right';
            ctx.font = `${tickFontSize}px Arial`;
            ctx.fillStyle = '#ccc';

            // Draw horizontal grid lines (6dB steps from -24dB to +24dB)
            for (let db = -4; db <= 4; db += 2) {
                const y = height * (1 - (db + 6) / 12);
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.fillText(`${db}`, labelX, y + tickOffset);
            }

            // Draw axis labels
            ctx.save();
            ctx.font = `${axisFontSize}px Arial`;
            ctx.translate(axisX, height / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.fillText('Gain (dB)', 0, 0);
            ctx.restore();

            ctx.textAlign = 'center';
            ctx.fillText('Time', width / 2, height - bottomOffset);

            // Draw 1-second markers
            ctx.strokeStyle = '#555';
            ctx.lineWidth = graphLineWidth;
            for (const idx of this.secondMarkers[bandIdx]) {
                const x = width * idx / this.gainBuffers[bandIdx].length;
                ctx.beginPath();
                ctx.moveTo(x, height - secondMarkerHeight);
                ctx.lineTo(x, height);
                ctx.stroke();
            }

            // Draw gain history; skip segments with NaN values
            ctx.strokeStyle = "#00ff00";
            ctx.lineWidth = graphLineWidth;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < this.gainBuffers[bandIdx].length; i++) {
                const value = this.gainBuffers[bandIdx][i];
                if (isNaN(value)) continue;
                const x = width * i / this.gainBuffers[bandIdx].length;
                const y = height * (1 - (value + 6) / 12);
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
        }
    }

    cleanup() {
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
        this.disposeGraphResizeObservers();
        if (this.canvases) {
            this.canvases.forEach(canvas => {
                if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                }
            });
            this.canvases = [];
        }

        // Reset buffers to NaN so that initial graph is blank
        this.gainBuffers.forEach(buffer => buffer.fill(NaN));
        this.secondMarkers = [[], [], []];
        this.prevTime = null;

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        super.cleanup();
    }

    createUI() {
        this.disposeGraphResizeObservers();
        const container = document.createElement('div');
        this.instanceId = `mbt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        container.className = 'mbt-container';
        container.setAttribute('data-instance-id', this.instanceId);

        // Frequency sliders UI (from multiband_saturation.js)
        const freqContainer = document.createElement('div');
        freqContainer.className = 'mbt-freq-sliders';

        const createFreqSlider = (label, min, max, value, setter, freqNum, idPrefix = this.instanceId) => {
            const sliderContainer = document.createElement('div');
            sliderContainer.className = 'mbt-freq-slider';

            const topRow = document.createElement('div');
            topRow.className = 'mbt-freq-slider-top parameter-row';

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

        // Band settings UI (from multiband_saturation.js structure with transient controls)
        const bandSettings = document.createElement('div');
        bandSettings.className = 'mbt-band-settings';
        const bandTabs = document.createElement('div');
        bandTabs.className = 'mbt-band-tabs';
        const bandContents = document.createElement('div');
        bandContents.className = 'mbt-band-contents';

        const bandNames = ['Low', 'Mid', 'High'];
        for (let i = 0; i < this.bands.length; i++) {
            const tab = document.createElement('button');
            tab.className = `mbt-band-tab ${i === 0 ? 'active' : ''}`;
            tab.textContent = bandNames[i];
            tab.setAttribute('data-instance-id', this.instanceId);
            
            tab.onclick = () => {
                if (i >= this.bands.length) return;
                const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
                container.querySelectorAll('.mbt-band-tab').forEach(t => t.classList.remove('active'));
                container.querySelectorAll('.mbt-band-content').forEach(c => c.classList.remove('active'));
                container.querySelectorAll('.mbt-band-graph').forEach((g, index) => {
                    g.classList.toggle('active', index === i);
                });
                tab.classList.add('active');
                content.classList.add('active');
                this.selectedBand = i;
            };
            bandTabs.appendChild(tab);

            const content = document.createElement('div');
            content.className = `mbt-band-content plugin-parameter-ui ${i === 0 ? 'active' : ''}`;
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
            
            // Add transient shaper controls (from transient_shaper.js)
            content.appendChild(createBandControl('Fast Attack', 0.1, 10.0, 0.1, band.fa, this.setFa.bind(this), 'ms'));
            content.appendChild(createBandControl('Fast Release', 1, 200, 1, band.fr, this.setFr.bind(this), 'ms'));
            content.appendChild(createBandControl('Slow Attack', 1, 100, 1, band.sa, this.setSa.bind(this), 'ms'));
            content.appendChild(createBandControl('Slow Release', 50, 1000, 5, band.sr, this.setSr.bind(this), 'ms'));
            content.appendChild(createBandControl('Transient Gain', -24, 24, 0.1, band.gt, this.setGt.bind(this), 'dB'));
            content.appendChild(createBandControl('Sustain Gain', -24, 24, 0.1, band.gs, this.setGs.bind(this), 'dB'));
            content.appendChild(createBandControl('Smoothing', 0.1, 20.0, 0.1, band.sm, this.setSm.bind(this), 'ms'));
            
            bandContents.appendChild(content);
        }

        bandSettings.appendChild(bandTabs);
        bandSettings.appendChild(bandContents);
        container.appendChild(bandSettings);

        // Transfer graphs UI (from multiband_saturation.js structure)
        const graphsContainer = document.createElement('div');
        graphsContainer.className = 'mbt-transfer-graphs';
        for (let i = 0; i < this.bands.length; i++) {
            const graphDiv = document.createElement('div');
            graphDiv.className = `mbt-band-graph ${i === 0 ? 'active' : ''}`;
            graphDiv.setAttribute('data-instance-id', this.instanceId);
            const { container: graphContainer, canvas, dispose } = this.createResponsiveGraph({
                maxWidth: 612,
                aspectRatio: '612 / 300',
                mobileAspectRatio: '2.5 / 1',
                className: 'mbt-transfer-graph',
                onResize: () => this.drawGraphs()
            });
            canvas.style.backgroundColor = '#1a1a1a';
            const label = document.createElement('div');
            label.className = 'mbt-band-graph-label';
            label.textContent = bandNames[i];
            graphDiv.appendChild(graphContainer);
            graphDiv.appendChild(label);
            this.graphResizeDisposers.push(dispose);
            
            // Add click event to switch to this band when clicking on the graph
            const bandIndex = i; // Capture the current band index
            graphDiv.addEventListener('click', () => {
                if (bandIndex >= this.bands.length) return;
                const container = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
                container.querySelectorAll('.mbt-band-tab').forEach(t => t.classList.remove('active'));
                container.querySelectorAll('.mbt-band-content').forEach(c => c.classList.remove('active'));
                container.querySelectorAll('.mbt-band-graph').forEach(g => g.classList.remove('active'));
                
                // Find and activate the corresponding tab and content
                const tabs = container.querySelectorAll('.mbt-band-tab');
                const contents = container.querySelectorAll('.mbt-band-content');
                if (bandIndex < tabs.length) tabs[bandIndex].classList.add('active');
                if (bandIndex < contents.length) contents[bandIndex].classList.add('active');
                graphDiv.classList.add('active');
                
                this.selectedBand = bandIndex;
            });
            
            graphsContainer.appendChild(graphDiv);
        }
        container.appendChild(graphsContainer);

        this.canvases = Array.from(container.querySelectorAll('.mbt-band-graph canvas'));
        
        if (this.observer) {
            this.observer.disconnect();
        }
        if (this.observer == null) {
            this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
        }
        this.canvases.forEach(canvas => this.observer.observe(canvas));

        return container;
    }
}

window.MultibandTransientPlugin = MultibandTransientPlugin;
