class HumGeneratorPlugin extends PluginBase {
    constructor() {
        super('Hum Generator', 'High-precision power hum noise generator');
        
        // Parameters - using the specification's naming
        this.fr = 50.0;      // Frequency (Hz) - 10-120 Hz
        this.tp = 'Standard'; // Type - Standard, Rich, Dirty
        this.hm = 50;        // Harmonics (%) - 0-100%
        this.tn = 10.0;      // Tone (kHz) - 1.0-20.0 kHz
        this.in = 1.0;       // Instability (%) - 0-10%
        this.lv = -40.0;     // Level (dB) - -80 to 0 dB
        this.temporalCapability = 'must-process';

        this.registerProcessor(`
            if (!parameters.enabled) return data;

            const { channelCount, blockSize, sampleRate } = parameters;
            const { fr, tp, hm, tn, in: instability, lv } = parameters;
            
            if (channelCount === 0 || sampleRate <= 0) {
                return data;
            }

            // --- Optimization: Pre-calculated constants ---
            const TWO_PI = 2.0 * Math.PI;
            const INV_PI = 1.0 / Math.PI;
            const INV_SAMPLE_RATE = 1.0 / sampleRate;
            const DENORMAL_OFFSET = 1.0e-25;

            const maxCombDelaySamples = Math.ceil(sampleRate / 20.0) + 1;

            // Initialize context (state) if necessary
            if (!context.initialized ||
                context.lastChannelCount !== channelCount ||
                context.sampleRate !== sampleRate ||
                context.delayBufferLength !== maxCombDelaySamples) {
                context.lfoPhase1 = 0.0;
                context.lfoPhase2 = 0.0;
                context.oscillatorPhase = 0.0;
                // Max delay for 10Hz fundamental plus one sample for safe circular reads.
                context.delayBuffers = Array.from({ length: channelCount }, () => new Float32Array(maxCombDelaySamples));
                context.delayPositions = new Uint32Array(channelCount).fill(0);
                // Biquad filter states for each channel
                context.harmonicFilterStates = Array.from({ length: channelCount }, () => ({ x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }));
                context.toneFilterStates = Array.from({ length: channelCount }, () => ({ x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }));
                
                context.lastChannelCount = channelCount;
                context.sampleRate = sampleRate;
                context.delayBufferLength = maxCombDelaySamples;
                context.frequencyCurrent = fr; context.frequencyTarget = fr; context.frequencyStep = 0;
                context.harmonicsCurrent = hm; context.harmonicsTarget = hm; context.harmonicsStep = 0;
                context.frequencyRemaining = 0; context.harmonicsRemaining = 0;
                context.initialized = true;
            }

            // --- Optimization: Calculate block-level parameters outside the main loop ---

            // LFO increments for instability
            const lfo1Inc = TWO_PI * 0.3 * INV_SAMPLE_RATE; // 0.3 Hz
            const lfo2Inc = TWO_PI * 0.7 * INV_SAMPLE_RATE; // 0.7 Hz
            
            // Instability modulation depths
            const instabilityAmount = instability / 100.0;
            const freqModDepth = instabilityAmount * 0.02; // Max ±2% frequency deviation
            const ampModDepth = instabilityAmount * 0.1;  // Max ±10% amplitude variation

            // Biquad filter coefficient calculation
            const calculateLowpassCoeffs = (f0, Q) => {
                const w0 = TWO_PI * f0 * INV_SAMPLE_RATE;
                const cosW0 = Math.cos(w0);
                const alpha = Math.sin(w0) / (2.0 * Q);
                const a0Inv = 1.0 / (1.0 + alpha);
                return {
                    b0: (1.0 - cosW0) * 0.5 * a0Inv,
                    b1: (1.0 - cosW0) * a0Inv,
                    b2: (1.0 - cosW0) * 0.5 * a0Inv,
                    a1: -2.0 * cosW0 * a0Inv,
                    a2: (1.0 - alpha) * a0Inv
                };
            };

            const harmonicsCutoff = 200.0 + (hm / 100.0) ** 2 * 10000.0;
            const harmonicsTargetCoeffs = calculateLowpassCoeffs(harmonicsCutoff, 0.707);
            
            const toneCutoff = tn * 1000.0;
            const toneTargetCoeffs = calculateLowpassCoeffs(toneCutoff, 1.0);
            const keys = ['b0', 'b1', 'b2', 'a1', 'a2'];
            const frames = Math.max(1, Math.ceil(sampleRate * 0.005));
            const retargetCoeffs = (name, target) => {
                if (!context[name]) {
                    context[name] = { ...target };
                    context[name + 'Target'] = target;
                    context[name + 'Step'] = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 };
                    context[name + 'Remaining'] = 0;
                } else if (keys.some(key => target[key] !== context[name + 'Target'][key])) {
                    context[name + 'Target'] = target;
                    const step = context[name + 'Step'];
                    for (const key of keys) step[key] = (target[key] - context[name][key]) / frames;
                    context[name + 'Remaining'] = frames;
                }
            };
            retargetCoeffs('harmonicsCoeffs', harmonicsTargetCoeffs);
            retargetCoeffs('toneCoeffs', toneTargetCoeffs);
            if (fr !== context.frequencyTarget) {
                context.frequencyTarget = fr;
                context.frequencyStep = (fr - context.frequencyCurrent) / frames;
                context.frequencyRemaining = frames;
            }
            if (hm !== context.harmonicsTarget) {
                context.harmonicsTarget = hm;
                context.harmonicsStep = (hm - context.harmonicsCurrent) / frames;
                context.harmonicsRemaining = frames;
            }
            const controlAt = (current, step, remaining, i) => current + step * Math.min(i + 1, remaining);
            const processBiquadAt = (input, state, name, i) => {
                const current = context[name], step = context[name + 'Step'];
                const elapsed = Math.min(i + 1, context[name + 'Remaining']);
                const b0 = current.b0 + step.b0 * elapsed, b1 = current.b1 + step.b1 * elapsed;
                const b2 = current.b2 + step.b2 * elapsed, a1 = current.a1 + step.a1 * elapsed;
                const a2 = current.a2 + step.a2 * elapsed;
                let output = b0 * input + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
                output += DENORMAL_OFFSET;
                output = output > 10.0 ? 10.0 : (output < -10.0 ? -10.0 : output);
                state.x2 = state.x1; state.x1 = input; state.y2 = state.y1; state.y1 = output;
                return output;
            };
            
            // Final gain from Level parameter
            const finalGain = 10 ** (lv / 20.0);
            
            // Load phase states into local variables for faster access inside the loop
            let lfoPhase1 = context.lfoPhase1;
            let lfoPhase2 = context.lfoPhase2;
            let oscillatorPhase = context.oscillatorPhase;
            
            // --- Optimization: Specialize processing loop based on type to avoid branching ---
            // This creates separate, optimized paths for each 'tp' value.

            if (tp === 'Standard') {
                for (let i = 0; i < blockSize; i++) {
                    const currentFr = controlAt(context.frequencyCurrent, context.frequencyStep, context.frequencyRemaining, i);
                    // Update LFOs and oscillator (common for all channels)
                    lfoPhase1 = (lfoPhase1 + lfo1Inc) % TWO_PI;
                    lfoPhase2 = (lfoPhase2 + lfo2Inc) % TWO_PI;
                    const combinedLfo = (Math.sin(lfoPhase1) + Math.sin(lfoPhase2)) * 0.5;
                    const modulatedFreq = currentFr * (1.0 + combinedLfo * freqModDepth);
                    const phaseInc = TWO_PI * modulatedFreq * INV_SAMPLE_RATE;
                    oscillatorPhase = (oscillatorPhase + phaseInc) % TWO_PI;
                    const oscillatorOutput = (oscillatorPhase * INV_PI) - 1.0;
                    const amplitudeModulation = 1.0 + combinedLfo * ampModDepth;
                    
                    for (let ch = 0; ch < channelCount; ch++) {
                        let wetSignal = oscillatorOutput;
                        
                        // 1. Harmonic Shaper (Comb filter)
                        const delayBuffer = context.delayBuffers[ch];
                        let delayPos = context.delayPositions[ch];
                        const combDelaySamples = 0.5 / currentFr * sampleRate;
                        if (combDelaySamples > 0 && combDelaySamples < delayBuffer.length - 1) {
                            let read = delayPos - combDelaySamples;
                            while (read < 0) read += delayBuffer.length;
                            const first = Math.floor(read) % delayBuffer.length;
                            const second = first + 1 === delayBuffer.length ? 0 : first + 1;
                            const fraction = read - Math.floor(read);
                            const delayedSample = delayBuffer[first] + fraction * (delayBuffer[second] - delayBuffer[first]);
                            delayBuffer[delayPos] = wetSignal;
                            wetSignal = (wetSignal - delayedSample) * 0.5;
                        }
                        context.delayPositions[ch] = (delayPos + 1) % delayBuffer.length;
                        
                        // 2. Harmonic Dampener (Biquad Lowpass - Inlined)
                        const hState = context.harmonicFilterStates[ch];
                        let filterOut = processBiquadAt(wetSignal, hState, 'harmonicsCoeffs', i);
                        wetSignal = filterOut;

                        // 3. Tone Control (Biquad Lowpass - Inlined)
                        const tState = context.toneFilterStates[ch];
                        filterOut = processBiquadAt(wetSignal, tState, 'toneCoeffs', i);
                        wetSignal = filterOut;
                        
                        // 4. Amplitude & Mixing
                        data[i + ch * blockSize] += wetSignal * amplitudeModulation * finalGain;
                    }
                }
            } else if (tp === 'Dirty') {
                for (let i = 0; i < blockSize; i++) {
                    const currentFr = controlAt(context.frequencyCurrent, context.frequencyStep, context.frequencyRemaining, i);
                    const currentHm = controlAt(context.harmonicsCurrent, context.harmonicsStep, context.harmonicsRemaining, i);
                    const drive = 1.0 + (currentHm / 100.0 * 3.0);
                    // Update LFOs and oscillator
                    lfoPhase1 = (lfoPhase1 + lfo1Inc) % TWO_PI;
                    lfoPhase2 = (lfoPhase2 + lfo2Inc) % TWO_PI;
                    const combinedLfo = (Math.sin(lfoPhase1) + Math.sin(lfoPhase2)) * 0.5;
                    const modulatedFreq = currentFr * (1.0 + combinedLfo * freqModDepth);
                    const phaseInc = TWO_PI * modulatedFreq * INV_SAMPLE_RATE;
                    oscillatorPhase = (oscillatorPhase + phaseInc) % TWO_PI;
                    const oscillatorOutput = (oscillatorPhase * INV_PI) - 1.0;
                    const amplitudeModulation = 1.0 + combinedLfo * ampModDepth;

                    for (let ch = 0; ch < channelCount; ch++) {
                        let wetSignal = oscillatorOutput;
                        
                        // 1. Harmonic Dampener
                        const hState = context.harmonicFilterStates[ch];
                        let filterOut = processBiquadAt(wetSignal, hState, 'harmonicsCoeffs', i);
                        wetSignal = filterOut;

                        // 2. Distortion
                        wetSignal = Math.tanh(wetSignal * drive);
                       
                        // 3. Tone Control
                        const tState = context.toneFilterStates[ch];
                        filterOut = processBiquadAt(wetSignal, tState, 'toneCoeffs', i);
                        wetSignal = filterOut;

                        // 4. Amplitude & Mixing
                        data[i + ch * blockSize] += wetSignal * amplitudeModulation * finalGain;
                    }
                }
            } else { // 'Rich' type (and any other default)
                for (let i = 0; i < blockSize; i++) {
                    const currentFr = controlAt(context.frequencyCurrent, context.frequencyStep, context.frequencyRemaining, i);
                    // Update LFOs and oscillator
                    lfoPhase1 = (lfoPhase1 + lfo1Inc) % TWO_PI;
                    lfoPhase2 = (lfoPhase2 + lfo2Inc) % TWO_PI;
                    const combinedLfo = (Math.sin(lfoPhase1) + Math.sin(lfoPhase2)) * 0.5;
                    const modulatedFreq = currentFr * (1.0 + combinedLfo * freqModDepth);
                    const phaseInc = TWO_PI * modulatedFreq * INV_SAMPLE_RATE;
                    oscillatorPhase = (oscillatorPhase + phaseInc) % TWO_PI;
                    const oscillatorOutput = (oscillatorPhase * INV_PI) - 1.0;
                    const amplitudeModulation = 1.0 + combinedLfo * ampModDepth;

                    for (let ch = 0; ch < channelCount; ch++) {
                        let wetSignal = oscillatorOutput;
                        
                        // 1. Harmonic Dampener
                        const hState = context.harmonicFilterStates[ch];
                        let filterOut = processBiquadAt(wetSignal, hState, 'harmonicsCoeffs', i);
                        wetSignal = filterOut;

                        // 2. Tone Control
                        const tState = context.toneFilterStates[ch];
                        filterOut = processBiquadAt(wetSignal, tState, 'toneCoeffs', i);
                        wetSignal = filterOut;
                        
                        // 3. Amplitude & Mixing
                        data[i + ch * blockSize] += wetSignal * amplitudeModulation * finalGain;
                    }
                }
            }
            
            // Store the final phase states back to the context for the next block
            context.lfoPhase1 = lfoPhase1;
            context.lfoPhase2 = lfoPhase2;
            context.oscillatorPhase = oscillatorPhase;
            if (blockSize >= context.frequencyRemaining) {
                context.frequencyCurrent = context.frequencyTarget;
                context.frequencyRemaining = 0;
            } else {
                context.frequencyCurrent += context.frequencyStep * blockSize;
                context.frequencyRemaining -= blockSize;
            }
            if (blockSize >= context.harmonicsRemaining) {
                context.harmonicsCurrent = context.harmonicsTarget;
                context.harmonicsRemaining = 0;
            } else {
                context.harmonicsCurrent += context.harmonicsStep * blockSize;
                context.harmonicsRemaining -= blockSize;
            }
            for (const name of ['harmonicsCoeffs', 'toneCoeffs']) {
                const remainingName = name + 'Remaining';
                const remaining = context[remainingName];
                if (!remaining) continue;
                if (blockSize >= remaining) {
                    context[name] = { ...context[name + 'Target'] };
                    context[remainingName] = 0;
                } else {
                    for (const key of keys) context[name][key] += context[name + 'Step'][key] * blockSize;
                    context[remainingName] -= blockSize;
                }
            }

            return data;
        `);
    }

    getTemporalCapability() {
        return this.enabled !== false ? 'must-process' : 'reset-on-resume';
    }

    getParameters() {
        return {
            type: this.constructor.name,
            fr: this.fr,
            tp: this.tp,
            hm: this.hm,
            tn: this.tn,
            in: this.in,
            lv: this.lv,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.fr !== undefined) {
            const value = parseFloat(params.fr);
            if (!isNaN(value)) {
                this.fr = Math.max(10.0, Math.min(120.0, value));
            }
        }
        if (params.tp !== undefined) {
            if (['Standard', 'Rich', 'Dirty'].includes(params.tp)) {
                this.tp = params.tp;
            }
        }
        if (params.hm !== undefined) {
            const value = parseInt(params.hm, 10);
            if (!isNaN(value)) {
                this.hm = Math.max(0, Math.min(100, value));
            }
        }
        if (params.tn !== undefined) {
            const value = parseFloat(params.tn);
            if (!isNaN(value)) {
                this.tn = Math.max(1.0, Math.min(20.0, value));
            }
        }
        if (params.in !== undefined) {
            const value = parseFloat(params.in);
            if (!isNaN(value)) {
                this.in = Math.max(0.0, Math.min(10.0, value));
            }
        }
        if (params.lv !== undefined) {
            const value = parseFloat(params.lv);
            if (!isNaN(value)) {
                this.lv = Math.max(-80.0, Math.min(0.0, value));
            }
        }
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'hum-generator-plugin-ui plugin-parameter-ui';

        // Frequency control
        container.appendChild(this.createParameterControl(
            'Frequency', 10.0, 120.0, 0.1, this.fr,
            (value) => this.setParameters({ fr: value }), 'Hz'
        ));

        // Type selection (radio buttons)
        const typeRow = document.createElement('div');
        typeRow.className = 'parameter-row';
        const typeLabel = document.createElement('label');
        typeLabel.textContent = 'Type:';
        typeRow.appendChild(typeLabel);

        const typeGroup = document.createElement('div');
        typeGroup.className = 'radio-group';
        
        ['Standard', 'Rich', 'Dirty'].forEach(type => {
            const radioId = `${this.id}-${this.name}-type-${type}`;
            const radioLabel = document.createElement('label');
            radioLabel.htmlFor = radioId;
            
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.id = radioId;
            radio.name = `${this.id}-${this.name}-type`;
            radio.value = type;
            radio.checked = this.tp === type;
            radio.autocomplete = 'off';
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    this.setParameters({ tp: type });
                }
            });
            
            radioLabel.appendChild(radio);
            radioLabel.appendChild(document.createTextNode(type));
            typeGroup.appendChild(radioLabel);
        });
        
        typeRow.appendChild(typeGroup);
        container.appendChild(typeRow);

        // Harmonics control
        container.appendChild(this.createParameterControl(
            'Harmonics', 0, 100, 1, this.hm,
            (value) => this.setParameters({ hm: value }), '%'
        ));

        // Tone control
        container.appendChild(this.createParameterControl(
            'Tone', 1.0, 20.0, 0.1, this.tn,
            (value) => this.setParameters({ tn: value }), 'kHz'
        ));

        // Instability control
        container.appendChild(this.createParameterControl(
            'Instability', 0.0, 10.0, 0.1, this.in,
            (value) => this.setParameters({ in: value }), '%'
        ));

        // Level control
        container.appendChild(this.createParameterControl(
            'Level', -80.0, 0.0, 0.1, this.lv,
            (value) => this.setParameters({ lv: value }), 'dB'
        ));

        return container;
    }
}

// Register plugin
window.HumGeneratorPlugin = HumGeneratorPlugin;
