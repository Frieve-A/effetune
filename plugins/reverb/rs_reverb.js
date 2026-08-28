const RS_REVERB_SYSTEM_PRESETS = Object.freeze([
    Object.freeze({
        id: 'small-room', label: 'Small Room',
        params: Object.freeze({
            pd: 5, rs: 3.5, rt: 0.5, ds: 8, df: 0.6,
            dp: 70, hd: 4000, ld: 250, mx: 14
        })
    }),
    Object.freeze({
        id: 'jazz-club', label: 'Jazz Club',
        params: Object.freeze({
            pd: 15, rs: 9, rt: 1.2, ds: 8, df: 0.7,
            dp: 75, hd: 3500, ld: 200, mx: 25
        })
    }),
    Object.freeze({
        id: 'concert-hall', label: 'Concert Hall',
        params: Object.freeze({
            pd: 25, rs: 35, rt: 2.2, ds: 8, df: 0.75,
            dp: 70, hd: 3000, ld: 150, mx: 35
        })
    }),
    Object.freeze({
        id: 'cathedral', label: 'Cathedral',
        params: Object.freeze({
            pd: 40, rs: 40, rt: 6, ds: 8, df: 0.8,
            dp: 60, hd: 1800, ld: 100, mx: 45
        })
    })
]);

class RSReverbPlugin extends PluginBase {
    static getSystemPresetGroups() {
        return [{
            label: '',
            presets: RS_REVERB_SYSTEM_PRESETS.map(preset => ({ ...preset }))
        }];
    }

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

            const needsCombDelays = !context.combDelays ||
                context.combDelays.length !== channelCount * 8 || context.roomSize !== parameters.rs;
            if (needsCombDelays) {
                const baseDelays = [19, 29, 41, 47, 23, 31, 37, 43];
                const delayJitter = [
                    1.0000, 0.9884, 1.0157, 0.9738, 1.0291, 0.9812, 1.0043, 0.9926,
                    1.0198, 0.9701, 1.0114, 0.9855, 1.0266, 0.9793, 1.0089, 0.9968
                ];
                context.combDelays = new Float64Array(channelCount * 8);
                for (let ch = 0; ch < channelCount; ch++) {
                    for (let line = 0; line < 8; line++) {
                        context.combDelays[ch * 8 + line] =
                            baseDelays[line] * delayJitter[(ch * 7 + line) % 16] * roomScale;
                    }
                }
                context.roomSize = parameters.rs;
            }
            
            // Initialize context state if needed
            const sampleRateChanged = context.initialized && context.sampleRate !== sampleRate;
            if (!context.initialized ||
                sampleRateChanged ||
                context.channelCount !== channelCount ||
                needsCombDelays) {
                context.sampleRate = sampleRate;
                context.channelCount = channelCount;
                const maxPreDelayRaw = Math.ceil(sampleRate * 0.05) + 1; // Include the 50ms tap.
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
                    const combs = new Array(8);
                    for (let j = 0; j < 8; j++) {
                        const delay = context.combDelays[ch * 8 + j];
                        const bufferLengthRaw = Math.ceil(delay * sampleRate * 0.001); // Convert ms to samples
                        const bufferLength = bufferLengthRaw > 0 ? bufferLengthRaw : 1;
                        combs[j] = {
                            buffer: new Float32Array(bufferLength),
                            pos: 0,
                            dampState1: 0,
                            dampState2: 0
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
            
            // Reverb time coefficient (calculate once)
            const rtCoeff = 1 / parameters.rt;
            
            // Pre-calculate channel-specific feedback gains from the active delays.
            if (!context.rsFeedbackScratch ||
                context.rsFeedbackScratch.length !== context.combDelays.length) {
                context.rsFeedbackScratch = new Float64Array(context.combDelays.length);
            }
            const feedbackGains = context.rsFeedbackScratch;
            for (let i = 0; i < context.combDelays.length; i++) {
                const delayTime = context.combDelays[i] * 0.001;
                const gain = Math.pow(0.001, delayTime * rtCoeff);
                feedbackGains[i] = gain > 0.99 ? 0.99 : (gain < -0.99 ? -0.99 : gain);
            }
            if (!context.rsControlScratch) context.rsControlScratch = new Float64Array(6);
            const targetControls = context.rsControlScratch;
            targetControls[0] = hdCoeff;
            targetControls[1] = ldCoeff;
            targetControls[2] = dampAmount;
            targetControls[3] = df;
            targetControls[4] = wetMix;
            const preDelayLimit = context.preDelayBuffer[0].buffer.length - 1;
            const requestedPreDelay = parameters.pd * sampleRate * 0.001;
            targetControls[5] = requestedPreDelay < 0 ? 0 :
                (requestedPreDelay > preDelayLimit ? preDelayLimit : requestedPreDelay);
            const rampFramesRaw = Math.ceil(sampleRate * 0.005);
            const rampFrames = rampFramesRaw > 0 ? rampFramesRaw : 1;
            if (!context.rsControls) {
                context.rsControls = new Float64Array(6);
                context.targetRsControls = new Float64Array(6);
                context.rsControlSteps = new Float64Array(6);
                context.rsControls.set(targetControls);
                context.targetRsControls.set(targetControls);
                context.rsRampRemaining = 0;
            } else if (sampleRateChanged) {
                context.rsControls[5] = targetControls[5];
                context.targetRsControls[5] = targetControls[5];
                context.rsControlSteps[5] = 0;
            }
            if (!context.rsFeedbackGains || context.rsFeedbackGains.length !== feedbackGains.length) {
                context.rsFeedbackGains = new Float64Array(feedbackGains.length);
                context.targetRsFeedbackGains = new Float64Array(feedbackGains.length);
                context.rsFeedbackSteps = new Float64Array(feedbackGains.length);
                context.rsFeedbackGains.set(feedbackGains);
                context.targetRsFeedbackGains.set(feedbackGains);
            }
            let changed = false;
            for (let i = 0; i < targetControls.length; i++) if (context.targetRsControls[i] !== targetControls[i]) changed = true;
            for (let i = 0; i < feedbackGains.length; i++) if (context.targetRsFeedbackGains[i] !== feedbackGains[i]) changed = true;
            if (changed) {
                context.targetRsControls.set(targetControls);
                context.targetRsFeedbackGains.set(feedbackGains);
                for (let i = 0; i < targetControls.length; i++) context.rsControlSteps[i] =
                    (targetControls[i] - context.rsControls[i]) / rampFrames;
                for (let i = 0; i < feedbackGains.length; i++) context.rsFeedbackSteps[i] =
                    (feedbackGains[i] - context.rsFeedbackGains[i]) / rampFrames;
                context.rsRampRemaining = rampFrames;
            }
            const rsControls = context.rsControls;
            const rsControlSteps = context.rsControlSteps;
            const rsFeedbackGains = context.rsFeedbackGains;
            const rsFeedbackSteps = context.rsFeedbackSteps;
            const rsRampRemaining = context.rsRampRemaining;

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
                    const rampFrame = i + 1 < rsRampRemaining ? i + 1 : rsRampRemaining;
                    const hdCoeff = rsControls[0] + rsControlSteps[0] * rampFrame;
                    const ldCoeff = rsControls[1] + rsControlSteps[1] * rampFrame;
                    // Unity-peak bandpass: preserve RT60 in the passband while damping both ends.
                    const dampingPoleProduct = hdCoeff * (1 - ldCoeff);
                    const dampingPoleSum = hdCoeff + 1 - ldCoeff;
                    const dampingInputGain = 0.5 * (1 - dampingPoleProduct);
                    const dampAmount = rsControls[2] + rsControlSteps[2] * rampFrame;
                    const oneMinusDampAmount = 1 - dampAmount;
                    const df = rsControls[3] + rsControlSteps[3] * rampFrame;
                    const dfSquared = df * df;
                    const oneMinusDf = 1 - df;
                    const oneMinusDfSquared = 1 - dfSquared;
                    const wetMix = rsControls[4] + rsControlSteps[4] * rampFrame;
                    const dryGain = wetMix <= 0.5 ? 1 : 2 * (1 - wetMix);
                    const wetGain = wetMix <= 0.5 ? 2 * wetMix : 1;
                    const input = data[channelDataOffset + i];
                    
                    // Write before reading so a zero-length tap returns this sample.
                    preDelayBuffer[preDelayPos] = input;
                    const preDelaySamples = rsControls[5] + rsControlSteps[5] * rampFrame;
                    let preDelayRead = preDelayPos - preDelaySamples;
                    if (preDelayRead < 0) preDelayRead += preDelayLength;
                    const firstTap = Math.floor(preDelayRead);
                    const nextTap = firstTap + 1 === preDelayLength ? 0 : firstTap + 1;
                    const fraction = preDelayRead - firstTap;
                    const delayedInput = preDelayBuffer[firstTap] +
                        fraction * (preDelayBuffer[nextTap] - preDelayBuffer[firstTap]);
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
                        
                        // H(z) = (1-ab)/2 * (1-z^-2) / ((1-a*z^-1)(1-b*z^-1)).
                        const scaledInput = dampingInputGain * delayedSample;
                        const bandpassed = scaledInput + comb.dampState1;
                        comb.dampState1 = dampingPoleSum * bandpassed + comb.dampState2;
                        comb.dampState2 = -scaledInput - dampingPoleProduct * bandpassed;
                        const dampedSample = delayedSample * oneMinusDampAmount + bandpassed * dampAmount;
                        
                        const feedbackIndex = ch * 8 + j;
                        const feedback = rsFeedbackGains[feedbackIndex] + rsFeedbackSteps[feedbackIndex] * rampFrame;
                        const feedbackGain = feedback < -0.99 ? -0.99 : (feedback > 0.99 ? 0.99 : feedback);
                        combBuffer[combPos] = delayedInput + dampedSample * feedbackGain;
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
                    if (dampAmount > 0) {
                        hdState = output + hdCoeff * (hdState - output);
                        ldState += ldCoeff * (output - ldState);
                        const lowDamped = output - ldState;
                        output = output * oneMinusDampAmount + (hdState * 0.5 + lowDamped * 0.5) * dampAmount;
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

            const rsAdvanced = blockSize < context.rsRampRemaining ? blockSize : context.rsRampRemaining;
            for (let i = 0; i < context.rsControls.length; i++) context.rsControls[i] += context.rsControlSteps[i] * rsAdvanced;
            for (let i = 0; i < context.rsFeedbackGains.length; i++) context.rsFeedbackGains[i] += context.rsFeedbackSteps[i] * rsAdvanced;
            context.rsRampRemaining -= rsAdvanced;
            if (context.rsRampRemaining === 0) {
                context.rsControls.set(context.targetRsControls);
                context.rsFeedbackGains.set(context.targetRsFeedbackGains);
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
        container.appendChild(this.createParameterControl('Pre-Delay', 0, 50, 0.1, this.pd, (value) => this.setParameters({ pd: value }), 'ms', 'pd'));
        container.appendChild(this.createParameterControl('Room Size', 2.0, 50.0, 0.1, this.rs, (value) => this.setParameters({ rs: value }), 'm', 'rs'));
        container.appendChild(this.createParameterControl('Reverb Time', 0.1, 10.0, 0.1, this.rt, (value) => this.setParameters({ rt: value }), 's', 'rt'));
        container.appendChild(this.createParameterControl('Density', 4, 8, 1, this.ds, (value) => this.setParameters({ ds: value }), 'lines', 'ds'));
        container.appendChild(this.createParameterControl('Diffusion', 0.2, 0.8, 0.01, this.df, (value) => this.setParameters({ df: value }), 'ratio', 'df'));
        container.appendChild(this.createParameterControl('Damping', 0, 100, 1, this.dp, (value) => this.setParameters({ dp: value }), '%', 'dp'));
        container.appendChild(this.createParameterControl('High Damp', 1000, 20000, 100, this.hd, (value) => this.setParameters({ hd: value }), 'Hz', 'hd'));
        container.appendChild(this.createParameterControl('Low Damp', 20, 500, 1, this.ld, (value) => this.setParameters({ ld: value }), 'Hz', 'ld'));
        container.appendChild(this.createParameterControl('Mix', 0, 100, 1, this.mx, (value) => this.setParameters({ mx: value }), '%', 'mx'));

        return container;
    }
}

// Register the plugin globally
window.RSReverbPlugin = RSReverbPlugin;
