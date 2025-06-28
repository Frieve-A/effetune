class VinylArtifactsPlugin extends PluginBase {
    constructor() {
        super('Vinyl Artifacts', 'Analog record noise physical simulation');
        
        // --- Parameters ---
        this.pp = 20;
        this.pl = -24.0;
        this.cm = 500;
        this.cl = -33.0;
        this.hs = -42.0;
        this.rb = -50.0;
        this.xt = 60;
        this.tn = 0.0;
        this.wr = 100;
        this.rt = 25;
        this.rm = 'Velocity';
        this.mx = 100;

        this.registerProcessor(`
            // --- Noise Compensation Gains ---
            // Pops and Crackles are passed through high-pass filters, which reduces their overall energy.
            // These gains compensate for that loss to make their perceived level closer to the dB setting.
            // Pop gain is boosted significantly based on user feedback. Original +12dB, now +24dB total.
            const POP_COMPENSATION_GAIN = 16.0;
            const CRACKLE_COMPENSATION_GAIN = 4.0;
            const DB_TO_LINEAR_FAST = 0.11512925464970229; // ln(10) / 20

            // --- Biquad Filter Coefficient Calculation Helpers ---
            // NOTE: The High Shelf and Low Shelf functions use canonical, verified implementations.

            function calculateLowShelfCoeffs(f0, dbGain, Q, sr) {
                if (Math.abs(dbGain) < 0.01) return null;
                const A = Math.pow(10, dbGain / 40.0);
                const w0 = 2 * Math.PI * f0 / sr;
                const c = Math.cos(w0);
                const s = Math.sin(w0);
                const alpha = s / (2 * Q);
                const beta = 2 * Math.sqrt(A) * alpha;
                
                const Ap1 = A + 1;
                const Am1 = A - 1;
                const a0_inv = 1 / (Ap1 + Am1 * c + beta);
                
                const b0 = A * (Ap1 - Am1 * c + beta) * a0_inv;
                const b1 = 2 * A * (Am1 - Ap1 * c) * a0_inv;
                const b2 = A * (Ap1 - Am1 * c - beta) * a0_inv;
                const a1 = -2 * (Am1 + Ap1 * c) * a0_inv;
                const a2 = (Ap1 + Am1 * c - beta) * a0_inv;

                return { b0, b1, b2, a1, a2 };
            }

            function calculateHighShelfCoeffs(f0, dbGain, Q, sr) {
                if (Math.abs(dbGain) < 0.01) return null;
                const A = Math.pow(10, dbGain / 40.0);
                const w0 = 2 * Math.PI * f0 / sr;
                const c = Math.cos(w0);
                const s = Math.sin(w0);
                const alpha = s / (2 * Q);
                const beta = 2 * Math.sqrt(A) * alpha;

                const Ap1 = A + 1;
                const Am1 = A - 1;
                const a0_inv = 1 / (Ap1 - Am1 * c + beta);
                
                const b0 = A * (Ap1 + Am1 * c + beta) * a0_inv;
                const b1 = -2 * A * (Am1 + Ap1 * c) * a0_inv;
                const b2 = A * (Ap1 + Am1 * c - beta) * a0_inv;
                const a1 = 2 * (Am1 - Ap1 * c) * a0_inv;
                const a2 = (Ap1 - Am1 * c - beta) * a0_inv;
                
                return { b0, b1, b2, a1, a2 };
            }
            
            function calculateHpfCoeffs(f0, Q, sr) {
                const w0 = 2 * Math.PI * f0 / sr, c = Math.cos(w0), a = Math.sin(w0) / (2 * Q), a0_inv = 1 / (1 + a);
                const one_plus_c_half = (1 + c) * 0.5;
                return { b0: one_plus_c_half * a0_inv, b1: -(1 + c) * a0_inv, b2: one_plus_c_half * a0_inv, a1: -2 * c * a0_inv, a2: (1 - a) * a0_inv };
            }
            function calculateLpfCoeffs(f0, Q, sr) {
                const w0 = 2 * Math.PI * f0 / sr, c = Math.cos(w0), a = Math.sin(w0) / (2 * Q), a0_inv = 1 / (1 + a);
                const one_minus_c_half = (1 - c) * 0.5;
                return { b0: one_minus_c_half * a0_inv, b1: (1 - c) * a0_inv, b2: one_minus_c_half * a0_inv, a1: -2 * c * a0_inv, a2: (1 - a) * a0_inv };
            }
            
            function processSafeBiquad(input, state, coeffs) {
                if (!coeffs) return input;
                // Using Direct Form 1 for simplicity and stability.
                let output = coeffs.b0 * input + coeffs.b1 * state.x1 + coeffs.b2 * state.x2 - coeffs.a1 * state.y1 - coeffs.a2 * state.y2;
                
                // Add a denormal offset to prevent performance issues with subnormal numbers.
                output += 1.0e-25;

                // If the filter becomes unstable and output is non-finite, reset its state to prevent lock-ups.
                // This abrupt reset can cause an audible click.
                if (!isFinite(output)) {
                    state.x1 = 0; state.x2 = 0; state.y1 = 0; state.y2 = 0; return 0.0;
                }

                // Lower the clamp limit to a more reasonable value to prevent filter instability 
                // (which causes high-frequency artifacts) without being triggered by normal signal levels.
                // Use if statements instead of Math.max/min for performance.
                const clampLimit = 10.0;
                if (output > clampLimit) {
                    output = clampLimit;
                } else if (output < -clampLimit) {
                    output = -clampLimit;
                }

                state.x2 = state.x1; state.x1 = input;
                state.y2 = state.y1; state.y1 = output;
                return output;
            }

            const { channelCount, blockSize, sampleRate, enabled, mx } = parameters;
            const mixAmount = mx / 100.0;

            if (!enabled || mixAmount < 1e-6 || channelCount === 0 || sampleRate <= 0) {
                return data;
            }
            
            if (!context.initialized || context.lastChannelCount !== channelCount) {
                context.pinkState = Array.from({ length: channelCount }, () => new Float32Array(7).fill(0.0));
                context.popState = Array.from({ length: channelCount }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0, coeffs: null }));
                context.crackleState = Array.from({ length: channelCount }, () => ({ crackleLevel: 0, x1: 0, x2: 0, y1: 0, y2: 0 }));
                context.rumbleState = Array.from({ length: channelCount }, () => ({ brown: 0.0, x1: 0, x2: 0, y1: 0, y2: 0 }));
                context.lowShelfState = Array.from({ length: channelCount }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
                context.highShelfState = Array.from({ length: channelCount }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
                context.energySmooth = 0.0;
                context.lastInput = new Float32Array(channelCount).fill(0.0);
                context.lastChannelCount = channelCount;
                context.lowShelfBypassed = true;
                context.highShelfBypassed = true;
                context.initialized = true;
            }
            
            const { pp, pl, cm, cl, hs, rb, xt, tn, wr, rt, rm } = parameters;
            const MIN_DB_LEVEL = -80.0;
            const wearMultiplier = wr / 100.0;
            
            const popGain = (pl <= MIN_DB_LEVEL || wearMultiplier < 1e-6) ? 0.0 : Math.exp(pl * DB_TO_LINEAR_FAST);
            const crackleGain = (cl <= MIN_DB_LEVEL || wearMultiplier < 1e-6) ? 0.0 : Math.exp(cl * DB_TO_LINEAR_FAST);
            const hissGain = (hs <= MIN_DB_LEVEL || wearMultiplier < 1e-6) ? 0.0 : Math.exp(hs * DB_TO_LINEAR_FAST);
            const rumbleGain = (rb <= MIN_DB_LEVEL) ? 0.0 : Math.exp(rb * DB_TO_LINEAR_FAST);
            
            const invSampleRate = 1.0 / sampleRate;
            const popProb = (popGain > 0.0) ? (pp * wearMultiplier / 60.0) * invSampleRate : 0.0;
            const crackleProb = (crackleGain > 0.0) ? (cm * wearMultiplier / 60.0) * invSampleRate : 0.0;
            
            const reactAmount = rt / 100.0;
            const crosstalkAmount = (xt / 100.0) * 0.5;
            const profileRatio = tn / 10.0;
            const lowShelfDb = 20.0 * (1.0 - profileRatio); 
            const highShelfDb = -20.0 * (1.0 - profileRatio);
            
            const crackleHpfCoeffs = calculateHpfCoeffs(3500.0, 0.707, sampleRate);
            const rumbleLpfCoeffs = (rumbleGain > 0.0) ? calculateLpfCoeffs(70.0, 0.707, sampleRate) : null;
            const lowShelfCoeffs = calculateLowShelfCoeffs(50.0, lowShelfDb, 0.707, sampleRate);
            const highShelfCoeffs = calculateHighShelfCoeffs(2122.0, highShelfDb, 0.707, sampleRate);

            const isLowShelfBypassed = (lowShelfCoeffs === null);
            if (isLowShelfBypassed !== context.lowShelfBypassed) {
                for (let ch = 0; ch < channelCount; ch++) { Object.assign(context.lowShelfState[ch], { x1: 0, x2: 0, y1: 0, y2: 0 }); }
                context.lowShelfBypassed = isLowShelfBypassed;
            }

            const isHighShelfBypassed = (highShelfCoeffs === null);
            if (isHighShelfBypassed !== context.highShelfBypassed) {
                for (let ch = 0; ch < channelCount; ch++) { Object.assign(context.highShelfState[ch], { x1: 0, x2: 0, y1: 0, y2: 0 }); }
                context.highShelfBypassed = isHighShelfBypassed;
            }

            let controlSignal = 0.0;
            if (reactAmount > 0.0) {
                let energy = 0.0;
                const invChannelCount = 1.0 / channelCount;
                
                // Hoist mode check out of the loop for performance.
                if (rm === 'Velocity') {
                    for (let i = 0; i < blockSize; i++) {
                        let frameEnergy = 0.0;
                        for (let c = 0; c < channelCount; c++) {
                            const s = data[c * blockSize + i];
                            const d = s - context.lastInput[c];
                            frameEnergy += d * d;
                            context.lastInput[c] = s;
                        }
                        energy += frameEnergy * invChannelCount;
                    }
                } else { // 'Amplitude' mode
                    for (let i = 0; i < blockSize; i++) {
                        let frameEnergy = 0.0;
                        for (let c = 0; c < channelCount; c++) {
                            const s = data[c * blockSize + i];
                            frameEnergy += s * s;
                        }
                        energy += frameEnergy * invChannelCount;
                    }
                }
                
                energy = Math.sqrt(energy / blockSize);
                const sf = energy > context.energySmooth ? 0.05 : 0.3;
                context.energySmooth += (energy - context.energySmooth) * sf;
                const scaledEnergy = context.energySmooth * 2.0;
                controlSignal = (scaledEnergy > 1.0 ? 1.0 : scaledEnergy) * reactAmount;
            }
            
            // Pre-calculate reaction-adjusted probabilities.
            const popProbReact = popProb * (1.0 + controlSignal * 15.0);
            const crackleProbReact = crackleProb * (1.0 + controlSignal * 8.0);
            const hissFactor = 0.11 * hissGain * wearMultiplier;
            const popImpulseGain = popGain * POP_COMPENSATION_GAIN;
            const crackleImpulseGain = crackleGain * CRACKLE_COMPENSATION_GAIN;

            // Avoid allocating memory in the main processing loop.
            const wetSamples = new Float32Array(channelCount);

            for (let i = 0; i < blockSize; i++) {
                const popTrigger = Math.random() < popProbReact;
                const crackleTrigger = Math.random() < crackleProbReact;
                
                for (let ch = 0; ch < channelCount; ch++) {
                    let totalNoise = 0.0;
                    
                    if (popGain > 0.0) {
                        const popState = context.popState[ch];
                        let popSampleIn = 0.0;
                        if (popTrigger) {
                            const size = Math.random();
                            const sizeInv = 1.0 - size;
                            const freq = 200.0 + 3800.0 * sizeInv * sizeInv;
                            const q = 0.7 + 0.8 * size;
                            popState.coeffs = calculateHpfCoeffs(freq, q, sampleRate);
                            popSampleIn = (Math.random() * 2.0 - 1.0) * popImpulseGain;
                        }
                        totalNoise += processSafeBiquad(popSampleIn, popState, popState.coeffs);
                    }
                    
                    if (crackleGain > 0.0) {
                        const crackleState = context.crackleState[ch];
                        crackleState.crackleLevel *= 0.992;
                        if (crackleTrigger) {
                            crackleState.crackleLevel += Math.pow(Math.random(), 2.5) * 1.2;
                        }
                        if (crackleState.crackleLevel > 2.0) {
                            crackleState.crackleLevel = 2.0;
                        }
                        let crackleSampleIn = 0.0;
                        if (crackleState.crackleLevel > 1e-6) {
                            crackleSampleIn = (Math.random() * 2.0 - 1.0) * crackleImpulseGain * crackleState.crackleLevel;
                        }
                        totalNoise += processSafeBiquad(crackleSampleIn, crackleState, crackleHpfCoeffs);
                    }

                    if (hissGain > 0.0) {
                        const pinkState = context.pinkState[ch];
                        const white = Math.random() * 2.0 - 1.0;
                        
                        const b0 = 0.99886 * pinkState[0] + white * 0.0555179;
                        const b1 = 0.99332 * pinkState[1] + white * 0.0750759;
                        const b2 = 0.96900 * pinkState[2] + white * 0.1538520;
                        const b3 = 0.86650 * pinkState[3] + white * 0.3104856;
                        const b4 = 0.55000 * pinkState[4] + white * 0.5329522;
                        const b5 = -0.7616 * pinkState[5] - white * 0.0168980;
                        
                        totalNoise += (b0 + b1 + b2 + b3 + b4 + b5 + pinkState[6] + white * 0.5362) * hissFactor;
                        
                        // Update state in-place to avoid creating a new array.
                        pinkState[0] = b0; pinkState[1] = b1; pinkState[2] = b2;
                        pinkState[3] = b3; pinkState[4] = b4; pinkState[5] = b5;
                        pinkState[6] = white * 0.115926;
                    }

                    if (rumbleGain > 0.0) {
                        const rumbleState = context.rumbleState[ch];
                        let brown = rumbleState.brown + (Math.random() * 2.0 - 1.0) * 0.02;
                        // Clamp using if statements for performance.
                        if (brown > 0.95) {
                            brown = 0.95;
                        } else if (brown < -0.95) {
                            brown = -0.95;
                        }
                        rumbleState.brown = brown;
                        totalNoise += processSafeBiquad(rumbleState.brown * rumbleGain, rumbleState, rumbleLpfCoeffs);
                    }
                    
                    const shelf1Out = processSafeBiquad(totalNoise, context.lowShelfState[ch], lowShelfCoeffs);
                    wetSamples[ch] = processSafeBiquad(shelf1Out, context.highShelfState[ch], highShelfCoeffs);
                }

                // --- Mix and Crosstalk ---
                const dryL = data[i];
                let wetL = wetSamples[0];
                
                if (channelCount > 1) {
                    const dryR = data[blockSize + i];
                    let wetR = wetSamples[1];
                    
                    if (crosstalkAmount > 1e-6) {
                        const oL = wetL, oR = wetR;
                        const crossMix = 1.0 - crosstalkAmount;
                        wetL = oL * crossMix + oR * crosstalkAmount; 
                        wetR = oR * crossMix + oL * crosstalkAmount;
                    }
                    data[blockSize + i] = dryR + wetR * mixAmount;
                }
                data[i] = dryL + wetL * mixAmount;
            }
            return data;
        `);
    }

    // --- The rest of the class is unchanged ---

    getParameters() { return { type: this.constructor.name, pp: this.pp, pl: this.pl, cm: this.cm, cl: this.cl, hs: this.hs, rb: this.rb, xt: this.xt, tn: this.tn, wr: this.wr, rt: this.rt, rm: this.rm, mx: this.mx, enabled: this.enabled }; }
    
    setParameters(p) {
        const UNIFIED_DB_MIN = -80.0;
        const UNIFIED_DB_MAX = 0.0;
        const setIntParam = (key, min, max) => { if (p[key] !== undefined && p[key] !== null) { const val = parseInt(p[key], 10); if (!isNaN(val)) this[key] = Math.max(min, Math.min(max, val)); } };
        const setFloatParam = (key, min, max) => { if (p[key] !== undefined && p[key] !== null) { const val = parseFloat(p[key]); if (!isNaN(val)) this[key] = Math.max(min, Math.min(max, val)); } };
        setIntParam('pp', 0, 120); setFloatParam('pl', UNIFIED_DB_MIN, UNIFIED_DB_MAX); setIntParam('cm', 0, 2000); setFloatParam('cl', UNIFIED_DB_MIN, UNIFIED_DB_MAX); setFloatParam('hs', UNIFIED_DB_MIN, UNIFIED_DB_MAX); setFloatParam('rb', UNIFIED_DB_MIN, UNIFIED_DB_MAX); setIntParam('xt', 0, 100); setFloatParam('tn', 0, 10); setIntParam('wr', 0, 200); setIntParam('rt', 0, 100); setIntParam('mx', 0, 100);
        if (p.rm !== undefined) this.rm = p.rm === 'Amplitude' ? 'Amplitude' : 'Velocity';
        this.updateParameters();
    }

    createUI() {
        const c = document.createElement('div');
        c.className = 'vinyl-artifacts-plugin-ui plugin-parameter-ui';
        const UNIFIED_DB_MIN = -80.0; const UNIFIED_DB_MAX = 0.0; const DB_STEP = 0.1;
        c.appendChild(this.createParameterControl('Pops/min', 0, 120, 1, this.pp, v => this.setParameters({ pp: v })));
        c.appendChild(this.createParameterControl('Pop Level', UNIFIED_DB_MIN, UNIFIED_DB_MAX, DB_STEP, this.pl, v => this.setParameters({ pl: v }), 'dB'));
        c.appendChild(this.createParameterControl('Crackles/min', 0, 2000, 10, this.cm, v => this.setParameters({ cm: v })));
        c.appendChild(this.createParameterControl('Crackle Level', UNIFIED_DB_MIN, UNIFIED_DB_MAX, DB_STEP, this.cl, v => this.setParameters({ cl: v }), 'dB'));
        c.appendChild(this.createParameterControl('Hiss', UNIFIED_DB_MIN, UNIFIED_DB_MAX, DB_STEP, this.hs, v => this.setParameters({ hs: v }), 'dB'));
        c.appendChild(this.createParameterControl('Rumble', UNIFIED_DB_MIN, UNIFIED_DB_MAX, DB_STEP, this.rb, v => this.setParameters({ rb: v }), 'dB'));
        c.appendChild(this.createParameterControl('Crosstalk', 0, 100, 1, this.xt, v => this.setParameters({ xt: v }), '%'));
        c.appendChild(this.createParameterControl('Noise Profile', 0, 10, 0.1, this.tn, v => this.setParameters({ tn: v })));
        c.appendChild(this.createParameterControl('Wear', 0, 200, 1, this.wr, v => this.setParameters({ wr: v }), '%'));
        c.appendChild(this.createParameterControl('React', 0, 100, 1, this.rt, v => this.setParameters({ rt: v }), '%'));
        const r = document.createElement('div'); r.className = 'parameter-row'; const l = document.createElement('label'); l.textContent = 'React Mode:'; r.appendChild(l);
        const h = document.createElement('div'); h.className = 'radio-group';
        ['Velocity', 'Amplitude'].forEach(m => {
            const i = `${this.id}-react-mode-${m}`, a = document.createElement('label'); a.htmlFor = i;
            const d = document.createElement('input'); d.type = 'radio'; d.id = i; d.name = `${this.id}-react-mode`; d.value = m; d.checked = this.rm === m; d.autocomplete = 'off';
            d.addEventListener('change', () => { if (d.checked) this.setParameters({ rm: m }); });
            a.appendChild(d); a.appendChild(document.createTextNode(m)); h.appendChild(a);
        });
        r.appendChild(h); c.appendChild(r);
        c.appendChild(this.createParameterControl('Mix', 0, 100, 1, this.mx, v => this.setParameters({ mx: v }), '%'));
        return c;
    }
}

// Register plugin
window.VinylArtifactsPlugin = VinylArtifactsPlugin;