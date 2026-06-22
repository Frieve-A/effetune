class RSReverbPlugin extends PluginBase {
    constructor() {
        super('RS Reverb', 'Random scattering reverb with natural diffusion');

        // Initialize parameters with defaults
        this.pd = 10;     // Pre-Delay (ms)
        this.rs = 10.0;   // Room Size (m)
        this.rt = 2.4;    // Reverb Time (s)
        this.ds = 8;      // Density (4-8)
        this.df = 0.7;    // Diffusion (0.2-0.8)
        this.dp = 80;     // Damping (%)
        this.hd = 2000;   // High Damp (Hz)
        this.ld = 200;    // Low Damp (Hz)
        this.mx = 16;     // Wet/Dry Mix (%)

        // Initialize state variables
        this.lastProcessTime = performance.now() / 1000;

        // Register processor function
        this.registerProcessor(`
            // Skip processing if disabled
            if (!parameters.enabled) return data;

            const channelCount = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate; // Define sampleRate at the beginning
            // Room size scaling factor
            const roomScale = parameters.rs / 10.0;

            const needsRandomizedDelays = !context.randomizedDelays || context.roomSize !== parameters.rs;
            if (needsRandomizedDelays) {
                const baseDelays = [19, 29, 41, 47, 23, 31, 37, 43];
                context.randomizedDelays = new Array(baseDelays.length);
                for (let i = 0; i < baseDelays.length; i++) {
                    context.randomizedDelays[i] = (baseDelays[i] + Math.random() - 0.5) * roomScale;
                }
                context.roomSize = parameters.rs;
            }
            
            // Initialize context state if needed
            if (!context.initialized ||
                context.sampleRate !== sampleRate ||
                context.channelCount !== channelCount ||
                needsRandomizedDelays) {
                context.sampleRate = sampleRate;
                context.channelCount = channelCount;
                const maxPreDelayRaw = Math.ceil(sampleRate * 0.05); // 50ms
                const maxPreDelay = maxPreDelayRaw > 0 ? maxPreDelayRaw : 1;
                
                // Pre-allocate arrays
                context.preDelayBuffer = new Array(channelCount);
                context.combFilters = new Array(channelCount);
                context.allpassFilters = new Array(channelCount);
                
                // Calculate allpass filter delay once
                const apfDelayRaw = Math.ceil(0.005 * sampleRate); // 5ms
                const apfDelay = apfDelayRaw > 0 ? apfDelayRaw : 1;
                
                // Initialize all buffers for all channels at once
                for (let ch = 0; ch < channelCount; ch++) {
                    // Pre-delay buffer
                    context.preDelayBuffer[ch] = {
                        buffer: new Float32Array(maxPreDelay),
                        pos: 0
                    };
                    
                    // Comb filters
                    const combs = new Array(context.randomizedDelays.length);
                    for (let j = 0; j < context.randomizedDelays.length; j++) {
                        const delay = context.randomizedDelays[j];
                        const bufferLengthRaw = Math.ceil(delay * sampleRate * 0.001); // Convert ms to samples
                        const bufferLength = bufferLengthRaw > 0 ? bufferLengthRaw : 1;
                        combs[j] = {
                            buffer: new Float32Array(bufferLength),
                            pos: 0,
                            hdState: 0,
                            ldState: 0
                        };
                    }
                    context.combFilters[ch] = combs;
                    
                    // Allpass filters - fixed at 2 filters
                    const apfs = new Array(2);
                    apfs[0] = { buffer: new Float32Array(apfDelay), pos: 0, lastOutput: 0 };
                    apfs[1] = { buffer: new Float32Array(apfDelay), pos: 0, lastOutput: 0 };
                    context.allpassFilters[ch] = apfs;
                }
                
                // Initialize damping filter states per channel
                context.hdStates = new Float32Array(channelCount);
                context.ldStates = new Float32Array(channelCount);
                
                context.initialized = true;
            }

            // Pre-calculate coefficients for the block - cache frequently used values
            const twoPI = 2 * Math.PI;
            
            // Damping coefficients
            const hdCoeff = Math.exp(-twoPI * parameters.hd / sampleRate);
            const ldCoeff = 1 - Math.exp(-twoPI * parameters.ld / sampleRate);
            const dampAmount = parameters.dp / 100;
            
            // Density and diffusion
            const numActiveCombs = parameters.ds;
            const normalizationFactor = 0.4 / (numActiveCombs < 1 ? 1 : numActiveCombs);
            const df = parameters.df;
            
            // Mix calculations
            const wetMix = parameters.mx / 100;
            const dryGain = wetMix <= 0.5 ? 1.0 : 2.0 * (1.0 - wetMix);
            const wetGain = wetMix <= 0.5 ? 2.0 * wetMix : 1.0;
            
            // Reverb time coefficient (calculate once)
            const rtCoeff = 1 / parameters.rt;
            
            // Pre-calculate feedback gains using stored randomized delays
            const feedbackGains = new Array(context.randomizedDelays.length);
            for (let i = 0; i < context.randomizedDelays.length; i++) {
                const delayTime = context.randomizedDelays[i] * 0.001;
                const gain = Math.pow(0.001, delayTime * rtCoeff);
                feedbackGains[i] = gain > 0.99 ? 0.99 : (gain < -0.99 ? -0.99 : gain);
            }

            // Precalculate values used in the inner loop
            const hasDamping = parameters.dp > 0;
            const oneMinusDampAmount = 1 - dampAmount;
            const dfSquared = df * df;
            const oneMinusDf = 1 - df;
            const oneMinusDfSquared = 1 - dfSquared;
            
            // Process each channel
            for (let ch = 0; ch < channelCount; ch++) {
                const channelDataOffset = ch * blockSize;
                const preDelay = context.preDelayBuffer[ch];
                const combFilters = context.combFilters[ch];
                const allpassFilters = context.allpassFilters[ch];
                const numCombs = numActiveCombs;
                
                // Cache buffer properties to avoid property lookups in the inner loop
                const preDelayBuffer = preDelay.buffer;
                let preDelayPos = preDelay.pos;
                const preDelayLength = preDelayBuffer.length;
                
                // Cache channel damping states
                let hdState = context.hdStates[ch];
                let ldState = context.ldStates[ch];
                
                // Cache allpass filter properties
                const apf0 = allpassFilters[0];
                const apf1 = allpassFilters[1];
                const apf0Buffer = apf0.buffer;
                const apf1Buffer = apf1.buffer;
                let apf0Pos = apf0.pos;
                let apf1Pos = apf1.pos;
                const apf0Length = apf0Buffer.length;
                const apf1Length = apf1Buffer.length;
                let apf0LastOutput = apf0.lastOutput;
                let apf1LastOutput = apf1.lastOutput;

                for (let i = 0; i < blockSize; i++) {
                    const input = data[channelDataOffset + i];
                    
                    // Apply pre-delay
                    const delayedInput = preDelayBuffer[preDelayPos];
                    preDelayBuffer[preDelayPos] = input;
                    preDelayPos++;
                    if (preDelayPos >= preDelayLength) preDelayPos = 0;
                    
                    // Process through comb filters based on density
                    let combOut = 0;
                    for (let j = 0; j < numCombs; j++) {
                        const comb = combFilters[j];
                        const combBuffer = comb.buffer;
                        let combPos = comb.pos;
                        const combLength = combBuffer.length;
                        
                        const delayedSample = combBuffer[combPos];
                        
                        // Apply damping filters in series to feedback signal
                        comb.hdState = delayedSample + hdCoeff * (comb.hdState - delayedSample);
                        comb.ldState = comb.hdState + ldCoeff * (comb.ldState - comb.hdState);
                        const dampedSample = delayedSample * oneMinusDampAmount + comb.ldState * dampAmount;
                        
                        combBuffer[combPos] = delayedInput + dampedSample * feedbackGains[j];
                        combPos++;
                        if (combPos >= combLength) combPos = 0;
                        comb.pos = combPos;
                        
                        combOut += dampedSample;
                    }
                    let output = combOut * normalizationFactor;
                    
                    // Apply first allpass filter
                    const delaySample0 = apf0Buffer[apf0Pos];
                    const out0 = -oneMinusDf * output + delaySample0 + df * apf0LastOutput;
                    apf0Buffer[apf0Pos] = output;
                    apf0Pos++;
                    if (apf0Pos >= apf0Length) apf0Pos = 0;
                    apf0LastOutput = out0;
                    output = out0 * oneMinusDfSquared;
                    
                    // Apply second allpass filter
                    const delaySample1 = apf1Buffer[apf1Pos];
                    const out1 = -oneMinusDf * output + delaySample1 + df * apf1LastOutput;
                    apf1Buffer[apf1Pos] = output;
                    apf1Pos++;
                    if (apf1Pos >= apf1Length) apf1Pos = 0;
                    apf1LastOutput = out1;
                    output = out1 * oneMinusDfSquared;
                    
                    // Apply damping filters per channel if needed
                    if (hasDamping) {
                        hdState = output + hdCoeff * (hdState - output);
                        ldState = output + ldCoeff * (ldState - output);
                        output = output * oneMinusDampAmount + (hdState * 0.5 + ldState * 0.5) * dampAmount;
                    }
                    
                    // Apply wet/dry mix
                    data[channelDataOffset + i] = input * dryGain + output * wetGain;
                }
                
                // Update context with modified values
                preDelay.pos = preDelayPos;
                apf0.pos = apf0Pos;
                apf1.pos = apf1Pos;
                apf0.lastOutput = apf0LastOutput;
                apf1.lastOutput = apf1LastOutput;
                context.hdStates[ch] = hdState;
                context.ldStates[ch] = ldState;
            }

            return data;
        `);
    }

    // Get current parameters
    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            pd: this.pd,    // Pre-Delay
            rs: this.rs,    // Room Size
            rt: this.rt,    // Reverb Time
            ds: this.ds,    // Density
            df: this.df,    // Diffusion
            dp: this.dp,    // Damping
            hd: this.hd,    // High Damp
            ld: this.ld,    // Low Damp
            mx: this.mx     // Mix
        };
    }

    // Set parameters with validation
    setParameters(params) {
        if (params.pd !== undefined) this.pd = this.parseFiniteNumber(params.pd, 0, 50, this.pd);
        if (params.rs !== undefined) this.rs = this.parseFiniteNumber(params.rs, 2.0, 50.0, this.rs);
        if (params.rt !== undefined) this.rt = this.parseFiniteNumber(params.rt, 0.1, 10.0, this.rt);
        if (params.ds !== undefined) this.ds = Math.floor(this.parseFiniteNumber(params.ds, 4, 8, this.ds));
        if (params.df !== undefined) this.df = this.parseFiniteNumber(params.df, 0.2, 0.8, this.df);
        if (params.dp !== undefined) this.dp = this.parseFiniteNumber(params.dp, 0, 100, this.dp);
        if (params.hd !== undefined) this.hd = this.parseFiniteNumber(params.hd, 1000, 20000, this.hd);
        if (params.ld !== undefined) this.ld = this.parseFiniteNumber(params.ld, 20, 500, this.ld);
        if (params.mx !== undefined) this.mx = this.parseFiniteNumber(params.mx, 0, 100, this.mx);
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        // Use the base class createParameterControl helper directly
        container.appendChild(this.createParameterControl('Pre-Delay', 0, 50, 0.1, this.pd, (value) => this.setParameters({ pd: value }), 'ms'));
        container.appendChild(this.createParameterControl('Room Size', 2.0, 50.0, 0.1, this.rs, (value) => this.setParameters({ rs: value }), 'm'));
        container.appendChild(this.createParameterControl('Reverb Time', 0.1, 10.0, 0.1, this.rt, (value) => this.setParameters({ rt: value }), 's'));
        container.appendChild(this.createParameterControl('Density', 4, 8, 1, this.ds, (value) => this.setParameters({ ds: value }), 'lines'));
        container.appendChild(this.createParameterControl('Diffusion', 0.2, 0.8, 0.01, this.df, (value) => this.setParameters({ df: value }), 'ratio'));
        container.appendChild(this.createParameterControl('Damping', 0, 100, 1, this.dp, (value) => this.setParameters({ dp: value }), '%'));
        container.appendChild(this.createParameterControl('High Damp', 1000, 20000, 100, this.hd, (value) => this.setParameters({ hd: value }), 'Hz'));
        container.appendChild(this.createParameterControl('Low Damp', 20, 500, 1, this.ld, (value) => this.setParameters({ ld: value }), 'Hz'));
        container.appendChild(this.createParameterControl('Mix', 0, 100, 1, this.mx, (value) => this.setParameters({ mx: value }), '%'));

        return container;
    }
}

// Register the plugin globally
window.RSReverbPlugin = RSReverbPlugin;
