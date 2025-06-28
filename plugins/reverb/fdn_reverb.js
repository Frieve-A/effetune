class FDNReverbPlugin extends PluginBase {
    constructor() {
        super('FDN Reverb', 'Feedback Delay Network reverb with Hadamard matrix');

        // Initialize parameters with defaults (using shortened names for external storage)
        this.rt = 1.20;  // rt: Reverb Time (0.20-10.00s)
        this.dt = 8;     // dt: Density (4-8 lines)
        this.pd = 10.0;  // pd: Pre Delay (0.0-100.0ms)
        this.bd = 20.0;  // bd: Base Delay (10.0-60.0ms)
        this.ds = 5.0;   // ds: Delay Spread (0.0-25.0ms)
        this.hd = 6.0;   // hd: HF Damp (0.0-12.0dB/s)
        this.lc = 100;   // lc: Low Cut (20-500Hz)
        this.md = 3.0;   // md: Mod Depth (0.0-10.0ct)
        this.mr = 0.30;  // mr: Mod Rate (0.10-5.00Hz)
        this.df = 100;   // df: Diffusion (0-100%)
        this.wm = 30;    // wm: Wet Mix (0-100%)
        this.dm = 100;   // dm: Dry Mix (0-100%)
        this.sw = 100;   // sw: Stereo Width (0-200%)

        // Register processor function
        this.registerProcessor(`
            // Skip processing if disabled
            if (!parameters.enabled) return data;

            const channelCount = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate;
            
            const TWO_PI = 6.283185307179586; // 2 * Math.PI

            // Cache parameters locally for performance and readability
            const p_rt = parameters.rt;
            const p_dt = parameters.dt;
            const p_pd = parameters.pd;
            const p_bd = parameters.bd;
            const p_ds = parameters.ds;
            const p_hd = parameters.hd;
            const p_lc = parameters.lc;
            const p_md = parameters.md;
            const p_mr = parameters.mr;
            const p_df = parameters.df;
            const p_wm = parameters.wm;
            const p_dm = parameters.dm;
            const p_sw = parameters.sw;

            // --- Initialization and Re-initialization on sample rate change ---
            if (!context.initialized || context.sampleRate !== sampleRate) {
                context.sampleRate = sampleRate;
                context.hadamard = [
                    [1, 1, 1, 1, 1, 1, 1, 1], [1, -1, 1, -1, 1, -1, 1, -1],
                    [1, 1, -1, -1, 1, 1, -1, -1], [1, -1, -1, 1, 1, -1, -1, 1],
                    [1, 1, 1, 1, -1, -1, -1, -1], [1, -1, 1, -1, -1, 1, -1, 1],
                    [1, 1, -1, -1, -1, -1, 1, 1], [1, -1, -1, 1, -1, 1, 1, -1]
                ];
                context.delayLines = new Array(8); // Max density
                context.delayPositions = new Uint32Array(8);
                context.lfoPhases = new Float32Array(8);
                context.lfoOffsets = new Float32Array(8);
                context.lpfStates = new Float32Array(8).fill(0.0);
                context.hpfStates = new Float32Array(8).fill(0.0);
                context.delayTimeRandomOffsetsMs = new Float32Array(8);
                
                const MAX_RANDOM_DELAY_OFFSET_MS = 3.0;
                for (let k = 0; k < 8; k++) {
                    context.delayTimeRandomOffsetsMs[k] = (Math.random() - 0.5) * 2.0 * MAX_RANDOM_DELAY_OFFSET_MS;
                }
                
                const maxDelayTimeSeconds = 0.175; 
                const maxDelaySamplesPerLine = Math.ceil(sampleRate * maxDelayTimeSeconds); 
                for (let i = 0; i < 8; i++) {
                    context.delayLines[i] = new Float32Array(maxDelaySamplesPerLine).fill(0.0);
                    context.lfoPhases[i] = Math.random() * TWO_PI;
                    context.lfoOffsets[i] = (i * TWO_PI) / 8.0;
                }
                context.initialized = true;
            }
            
            // --- Pre-delay buffer allocation on channel count change ---
            if (!context.preDelayBuffer || context.preDelayBuffer.length !== channelCount) {
                const maxPreDelaySamples = Math.ceil(sampleRate * 0.1); // Max pre-delay is 100ms
                context.preDelayBuffer = new Array(channelCount);
                for (let ch = 0; ch < channelCount; ch++) {
                    context.preDelayBuffer[ch] = {
                        buffer: new Float32Array(maxPreDelaySamples).fill(0.0),
                        pos: 0
                    };
                }
            }

            // --- Per-block parameter calculations ---
            const preDelaySamples = (p_pd * sampleRate * 0.001) | 0;
            const baseDelaySamplesParam = p_bd * sampleRate * 0.001;
            const spreadSamplesParam = p_ds * sampleRate * 0.001;
            const densityLines = p_dt; 
            const diffusionAmount = p_df * 0.01; 
            const modDepthAsFraction = Math.pow(2.0, p_md / 1200.0) - 1.0; 
            const modRateHz = p_mr;             
            const reverbTimeSeconds = p_rt;
            
            // HF Damp LPF coefficient calculation
            const hfDampNormalized = Math.max(0.0, Math.min(1.0, p_hd / 12.0));
            const hfDampCutoffHz = 20000.0 * Math.pow(500.0 / 20000.0, hfDampNormalized);
            
            let lpfAlphaForHfDamp = 0.0; 
            if (hfDampCutoffHz < sampleRate * 0.495 && sampleRate > 0.0) {
                 const expVal = Math.exp(-TWO_PI * hfDampCutoffHz / sampleRate);
                 lpfAlphaForHfDamp = Math.max(0.0, Math.min(0.99999, expVal));
            }
            
            // Low Cut HPF coefficient calculation
            const lowCutHz = p_lc; 
            let hpfAlphaForLowCut = 0.0; 
            let apply_hpf = false;
            if (lowCutHz > 1.0 && sampleRate > 0.0) {
                const expVal = Math.exp(-TWO_PI * lowCutHz / sampleRate);
                hpfAlphaForLowCut = Math.max(0.0, Math.min(0.99999, expVal));
                apply_hpf = true;
            }

            const wetMix = p_wm * 0.01;
            const dryMix = p_dm * 0.01;
            const stereoWidthParam = p_sw * 0.01; 
            
            // Manage and calculate delay times and feedback gains for active lines
            if (!context.unmodulatedDelayTimesSamples_block || context.unmodulatedDelayTimesSamples_block.length !== densityLines) {
                context.unmodulatedDelayTimesSamples_block = new Float32Array(densityLines);
            }
            const unmodulatedDelayTimesSamples = context.unmodulatedDelayTimesSamples_block;
            
            if (!context.feedbackGains_block || context.feedbackGains_block.length !== densityLines) {
                context.feedbackGains_block = new Float32Array(densityLines);
            }
            const feedbackGains = context.feedbackGains_block;
            
            for (let k = 0; k < densityLines; k++) {
                let deterministicLineDelay = baseDelaySamplesParam;
                if (densityLines > 1) {
                    const linearRatio = k / (densityLines - 1.0); 
                    const spreadFactor = Math.pow(linearRatio, 0.8); 
                    deterministicLineDelay += (spreadSamplesParam * spreadFactor);
                }
                const randomOffsetSamples = context.delayTimeRandomOffsetsMs[k] * sampleRate * 0.001;
                unmodulatedDelayTimesSamples[k] = Math.max(1.0, deterministicLineDelay + randomOffsetSamples);
            }
            
            const FEEDBACK_GAIN_CLAMP = 0.99999; 
            for (let k = 0; k < densityLines; k++) {
                const effectiveDelayLengthForGain = Math.max(1, unmodulatedDelayTimesSamples[k] | 0);
                let gain = 0.0;
                if (reverbTimeSeconds > 0.0 && sampleRate > 0.0 && effectiveDelayLengthForGain > 0) {
                    gain = Math.pow(0.001, effectiveDelayLengthForGain / (sampleRate * reverbTimeSeconds));
                }
                feedbackGains[k] = Math.max(-FEEDBACK_GAIN_CLAMP, Math.min(FEEDBACK_GAIN_CLAMP, gain));
            }
            
            const lfoIncrement = (sampleRate > 0.0) ? (TWO_PI * modRateHz / sampleRate) : 0.0;
            const invSqrtDensity = (densityLines > 0) ? (1.0 / Math.sqrt(densityLines)) : 1.0;
            const lTapActualCount = (densityLines + 1) >> 1; // Integer division by 2
            const rTapActualCount = densityLines >> 1;
            const invSqrtLTapCount = (lTapActualCount > 0) ? (1.0 / Math.sqrt(lTapActualCount)) : 0.0;
            const invSqrtRTapCount = (rTapActualCount > 0) ? (1.0 / Math.sqrt(rTapActualCount)) : 0.0;
            
            // --- Cache context properties for the hot loop ---
            const delayLines = context.delayLines;
            const delayPositions = context.delayPositions;
            const lfoPhases = context.lfoPhases;
            const lfoOffsets = context.lfoOffsets;
            const lpfStates = context.lpfStates;
            const hpfStates = context.hpfStates;
            const hadamardMatrix = context.hadamard;
            const preDelayBuffers = context.preDelayBuffer;

            // Allocate/resize FDN processing arrays in context if densityLines changed
            if (!context.fdnOutputs_block_cache || context.fdnOutputs_block_cache.length !== densityLines) {
                context.fdnOutputs_block_cache = new Float32Array(densityLines);
                context.hadamardMixingOutput_block_cache = new Float32Array(densityLines);
            }
            const fdnOutputs_currentSample = context.fdnOutputs_block_cache;
            const hadamardMixingOutput_currentSample = context.hadamardMixingOutput_block_cache;

            // --- Main Sample Processing Loop (Hot Path) ---
            for (let i = 0; i < blockSize; i++) { 
                // Update LFO phases once per sample for all potential lines
                for (let lineIdx = 0; lineIdx < 8; lineIdx++) { 
                    lfoPhases[lineIdx] += lfoIncrement;
                    if (lfoPhases[lineIdx] >= TWO_PI) {
                        lfoPhases[lineIdx] -= TWO_PI;
                    }
                }
                
                for (let ch = 0; ch < channelCount; ch++) {
                    const channelGlobalOffset = ch * blockSize + i; 
                    const currentInputSample = data[channelGlobalOffset];
                    
                    // Pre-delay processing
                    const preDelayLine = preDelayBuffers[ch];
                    const preDelayBuffer = preDelayLine.buffer;
                    const preDelayBufferLength = preDelayBuffer.length;
                    let fdnTankInput; 
            
                    if (preDelaySamples > 0 && preDelayBufferLength > 0) {
                        const readPos = (preDelayLine.pos - preDelaySamples + preDelayBufferLength) % preDelayBufferLength;
                        fdnTankInput = preDelayBuffer[readPos];
                    } else {
                        fdnTankInput = currentInputSample; 
                    }
                    preDelayBuffer[preDelayLine.pos] = currentInputSample; 
                    preDelayLine.pos = (preDelayLine.pos + 1) % preDelayBufferLength;
                    
                    // FDN Read Stage: Read from delay lines with modulation
                    for (let line = 0; line < densityLines; line++) {
                        const delayLineBuffer = delayLines[line];
                        const allocatedBufferLength = delayLineBuffer.length; 
                        const writePos = delayPositions[line]; 
                        
                        const lfoValue = Math.sin(lfoPhases[line] + lfoOffsets[line]);
                        const modulatedDelay = unmodulatedDelayTimesSamples[line] * (1.0 + modDepthAsFraction * lfoValue);
                        
                        // Clamp delay time using ternary operators instead of Math.max/min
                        const upperClampLimit = allocatedBufferLength - 1.00001;
                        let clampedDelay = modulatedDelay < 0.0 ? 0.0 : modulatedDelay;
                        clampedDelay = clampedDelay > upperClampLimit ? upperClampLimit : clampedDelay;

                        const readPosInt = clampedDelay | 0;
                        const fraction = clampedDelay - readPosInt;
                        
                        // Robust modulo for buffer wrap-around
                        const idx0 = (writePos - 1 - readPosInt + allocatedBufferLength) % allocatedBufferLength;
                        const idx1 = (writePos - 1 - (readPosInt + 1) + allocatedBufferLength) % allocatedBufferLength; 
                                                
                        const sample0 = delayLineBuffer[idx0];
                        const sample1 = delayLineBuffer[idx1];
                        fdnOutputs_currentSample[line] = sample0 + (sample1 - sample0) * fraction; // Optimized lerp
                    }
                    
                    // Hadamard Mixing Stage
                    for (let row = 0; row < densityLines; row++) {
                        let sum = 0.0;
                        const hadamardRow = hadamardMatrix[row];
                        for (let col = 0; col < densityLines; col++) {
                            sum += hadamardRow[col] * fdnOutputs_currentSample[col];
                        }
                        hadamardMixingOutput_currentSample[row] = sum * invSqrtDensity;
                    }
                    
                    // FDN Write Stage: Feedback, filtering, and writing to delay lines
                    for (let line = 0; line < densityLines; line++) {
                        const delayLineBuffer = delayLines[line];
                        const allocatedBufferLength = delayLineBuffer.length;
                        const writePos = delayPositions[line];
                        
                        // Apply diffusion and feedback
                        const diffusedFeedback = hadamardMixingOutput_currentSample[line] * diffusionAmount;
                        let signalToFilter = fdnTankInput + diffusedFeedback * feedbackGains[line];
                        
                        // HF Damp (LPF)
                        if (lpfAlphaForHfDamp > 0.0) { 
                            lpfStates[line] = (1.0 - lpfAlphaForHfDamp) * signalToFilter + lpfAlphaForHfDamp * lpfStates[line];
                            signalToFilter = lpfStates[line];
                        }
                        
                        // Low Cut (HPF)
                        if (apply_hpf) { 
                            const lpfComponentForHpf = (1.0 - hpfAlphaForLowCut) * signalToFilter + hpfAlphaForLowCut * hpfStates[line];
                            signalToFilter = signalToFilter - lpfComponentForHpf; 
                            hpfStates[line] = lpfComponentForHpf; 
                        }
                        
                        delayLineBuffer[writePos] = signalToFilter;
                        delayPositions[line] = (writePos + 1) % allocatedBufferLength; // Update position in cached array
                    }
                    
                    // Output Tapping and Mixing
                    let lTapSum = 0.0;
                    let rTapSum = 0.0;
                    for (let line = 0; line < densityLines; line++) {
                        // Use bitwise AND for even/odd check, potentially faster
                        if ((line & 1) === 0) { 
                            lTapSum += fdnOutputs_currentSample[line]; 
                        } else { 
                            rTapSum += fdnOutputs_currentSample[line];
                        }
                    }

                    const lTapWet = lTapSum * invSqrtLTapCount;
                    const rTapWet = rTapSum * invSqrtRTapCount;
                    
                    let wetSignalForThisChannel;
                    if (channelCount === 1) { 
                        wetSignalForThisChannel = (lTapWet + rTapWet) * 0.5; 
                    } else { 
                        // Stereo width processing
                        const monoMixComponent = (lTapWet + rTapWet) * 0.5;
                        const temp_m_s_factor = stereoWidthParam * 0.5;
                        const mixToStereoFactor = temp_m_s_factor < 0.0 ? 0.0 : (temp_m_s_factor > 1.0 ? 1.0 : temp_m_s_factor);
                        
                        if (ch === 0) { // Left channel
                            wetSignalForThisChannel = monoMixComponent * (1.0 - mixToStereoFactor) + lTapWet * mixToStereoFactor;
                        } else { // Right channel (and any subsequent)
                            wetSignalForThisChannel = monoMixComponent * (1.0 - mixToStereoFactor) + rTapWet * mixToStereoFactor;
                        }
                    }
                    data[channelGlobalOffset] = currentInputSample * dryMix + wetSignalForThisChannel * wetMix;
                } 
            } 
            return data;
        `);
    }

    // Get current parameters
    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            rt: this.rt,      // Reverb Time
            dt: this.dt,      // Density
            pd: this.pd,      // Pre Delay
            bd: this.bd,      // Base Delay
            ds: this.ds,      // Delay Spread
            hd: this.hd,      // HF Damp
            lc: this.lc,      // Low Cut
            md: this.md,      // Mod Depth
            mr: this.mr,      // Mod Rate
            df: this.df,      // Diffusion
            wm: this.wm,      // Wet Mix
            dm: this.dm,      // Dry Mix
            sw: this.sw      // Stereo Width
        };
    }

    // Set parameters with validation
    setParameters(params) {
        if (params.rt !== undefined) this.rt = Math.max(0.20, Math.min(10.00, Number(params.rt)));
        if (params.dt !== undefined) this.dt = Math.max(4, Math.min(8, Math.floor(Number(params.dt))));
        if (params.pd !== undefined) this.pd = Math.max(0.0, Math.min(100.0, Number(params.pd)));
        if (params.bd !== undefined) this.bd = Math.max(10.0, Math.min(60.0, Number(params.bd)));
        if (params.ds !== undefined) this.ds = Math.max(0.0, Math.min(25.0, Number(params.ds)));
        if (params.hd !== undefined) this.hd = Math.max(0.0, Math.min(12.0, Number(params.hd)));
        if (params.lc !== undefined) this.lc = Math.max(20, Math.min(500, Math.floor(Number(params.lc))));
        if (params.md !== undefined) this.md = Math.max(0.0, Math.min(10.0, Number(params.md)));
        if (params.mr !== undefined) this.mr = Math.max(0.10, Math.min(5.00, Number(params.mr)));
        if (params.df !== undefined) this.df = Math.max(0, Math.min(100, Math.floor(Number(params.df))));
        if (params.wm !== undefined) this.wm = Math.max(0, Math.min(100, Math.floor(Number(params.wm))));
        if (params.dm !== undefined) this.dm = Math.max(0, Math.min(100, Math.floor(Number(params.dm))));
        if (params.sw !== undefined) this.sw = Math.max(0, Math.min(200, Math.floor(Number(params.sw))));
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        // Use the base class createParameterControl helper
        container.appendChild(this.createParameterControl('Reverb Time', 0.20, 10.00, 0.01, this.rt, (value) => this.setParameters({ rt: value }), 's'));
        container.appendChild(this.createParameterControl('Density', 4, 8, 1, this.dt, (value) => this.setParameters({ dt: value }), 'lines'));
        container.appendChild(this.createParameterControl('Pre Delay', 0.0, 100.0, 0.1, this.pd, (value) => this.setParameters({ pd: value }), 'ms'));
        container.appendChild(this.createParameterControl('Base Delay', 10.0, 60.0, 0.1, this.bd, (value) => this.setParameters({ bd: value }), 'ms'));
        container.appendChild(this.createParameterControl('Delay Spread', 0.0, 25.0, 0.1, this.ds, (value) => this.setParameters({ ds: value }), 'ms'));
        container.appendChild(this.createParameterControl('HF Damp', 0.0, 12.0, 0.1, this.hd, (value) => this.setParameters({ hd: value }), 'dB/s'));
        container.appendChild(this.createParameterControl('Low Cut', 20, 500, 1, this.lc, (value) => this.setParameters({ lc: value }), 'Hz'));
        container.appendChild(this.createParameterControl('Mod Depth', 0.0, 10, 0.1, this.md, (value) => this.setParameters({ md: value }), 'ct'));
        container.appendChild(this.createParameterControl('Mod Rate', 0.10, 5.00, 0.01, this.mr, (value) => this.setParameters({ mr: value }), 'Hz'));
        container.appendChild(this.createParameterControl('Diffusion', 0, 100, 1, this.df, (value) => this.setParameters({ df: value }), '%'));
        container.appendChild(this.createParameterControl('Wet Mix', 0, 100, 1, this.wm, (value) => this.setParameters({ wm: value }), '%'));
        container.appendChild(this.createParameterControl('Dry Mix', 0, 100, 1, this.dm, (value) => this.setParameters({ dm: value }), '%'));
        container.appendChild(this.createParameterControl('Stereo Width', 0, 200, 1, this.sw, (value) => this.setParameters({ sw: value }), '%'));

        return container;
    }
}

// Register the plugin globally
window.FDNReverbPlugin = FDNReverbPlugin;
