class BrickwallLimiterPlugin extends PluginBase {
    constructor() {
        super('Brickwall Limiter', 'Prevents audio from exceeding 0 dBFS');

        // Plugin parameters
        this.th = 0;       // Threshold in dB (-24 to 0 dB)
        this.rl = 100;     // Release Time in ms (10 to 500 ms)
        this.la = 3;       // Lookahead Time in ms (0 to 10 ms)
        this.os = 4;       // Oversampling Factor (1, 2, 4, or 8)
        this.ig = 0;       // Input Gain in dB (-18 to 18 dB), default 0 dB
        this.sm = -1.000;  // Margin in dB (-1.000 to 0.000 dB, default -1.000 dB)

        this._hasMessageHandler = false;
        this.lastProcessTime = performance.now() / 1000;

        this._setupMessageHandler();

        // Register the audio processing function with Audio Worklet.
        // Processing chain:
        //  1. Apply input gain.
        //  2. If oversampling > 1:
        //      Upsample via polyphase interpolation.
        //  3. Write the (gain‐unprocessed) input into a delay buffer (for lookahead).
        //  4. Read the delayed block (lookahead signal) and compute its maximum level.
        //  5. Compute the required gain so that (max * gain) <= effective threshold.
        //     Effective threshold is computed as: parameters.th + Margin.
        //     If the upcoming block exceeds effective threshold, immediately drop gain,
        //     otherwise allow gradual recovery (release).
        //  6. Apply the computed gain to the delayed block.
        //  7. If oversampling > 1:
        //      Downsample via polyphase decimation.
        this.registerProcessor(`
            if (!parameters.enabled) {
                return data;
            }
            const numChannels = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate;
            
            // Global state reinitialization if sample rate or os factor changes.
            if (context.sampleRate !== sampleRate || context.lastOsFactor !== parameters.os) {
                context.sampleRate = sampleRate;
                context.lastOsFactor = parameters.os;
                context.initialized = false;
                delete context.delayLength;
                delete context.delayWritePos;
                delete context.delayBuffers;
                delete context.gainStates;
                delete context.filterCoeffs;
                delete context.filterLength;
                delete context.polyphase;
                delete context.osFactorCached;
                delete context.upsampleState;
                delete context.downsampleState;
                delete context.delayBufferOS;
                delete context.delayWritePosOS;
            }
            
            // Input Gain (dB -> linear)
            const inputGainDb = (parameters.ig !== undefined) ? parameters.ig : 0;
            const inputGainLinear = Math.pow(10, inputGainDb / 20);
            let inputBuffer = new Float32Array(data.length);
            for (let i = 0; i < data.length; i++) {
                inputBuffer[i] = data[i] * inputGainLinear;
            }
            
            // Time delta calculation
            const currentTime = (parameters.time !== undefined) ? parameters.time : 0;
            const prevTime = (context.prevTime !== undefined) ? context.prevTime : currentTime;
            const deltaTime = Math.max(0.001, currentTime - prevTime);
            context.prevTime = currentTime;
            
            // Release smoothing coefficient (release time is in seconds)
            const releaseTime = Math.max(10, parameters.rl) / 1000;
            const releaseCoeff = Math.exp(-deltaTime / releaseTime);
            
            // Threshold and Margin conversion (dB -> linear)
            const thresholdDb = parameters.th;
            const marginDb = (parameters.sm !== undefined) ? parameters.sm : -1.00;
            const effectiveThresholdDb = thresholdDb + marginDb;
            const effectiveThresholdLin = Math.pow(10, effectiveThresholdDb / 20);
            
            // 1x Processing (No Oversampling)
            if (parameters.os === 1) {
                if (!context.initialized) {
                    const delaySamples = Math.ceil(parameters.la * sampleRate / 1000);
                    context.delayLength = delaySamples + blockSize;
                    context.delayWritePos = 0;
                    context.delayBuffers = [];
                    for (let ch = 0; ch < numChannels; ch++) {
                        context.delayBuffers[ch] = new Float32Array(context.delayLength).fill(0);
                    }
                    context.gainStates = new Float32Array(numChannels).fill(1);
                    context.initialized = true;
                }
                // Write input into delay buffers (for lookahead)
                for (let ch = 0; ch < numChannels; ch++) {
                    const chOffset = ch * blockSize;
                    const delayBuffer = context.delayBuffers[ch];
                    for (let i = 0; i < blockSize; i++) {
                        delayBuffer[(context.delayWritePos + i) % context.delayLength] = inputBuffer[chOffset + i];
                    }
                }
                // Read delayed block from delay buffers
                let output = new Float32Array(data.length);
                for (let ch = 0; ch < numChannels; ch++) {
                    const chOffset = ch * blockSize;
                    const delayBuffer = context.delayBuffers[ch];
                    for (let i = 0; i < blockSize; i++) {
                        output[chOffset + i] = delayBuffer[(context.delayWritePos + i) % context.delayLength];
                    }
                }
                context.delayWritePos = (context.delayWritePos + blockSize) % context.delayLength;
                
                // Compute maximum level in delayed (lookahead) block
                let maxDelayed = 0;
                for (let ch = 0; ch < numChannels; ch++) {
                    const chOffset = ch * blockSize;
                    for (let i = 0; i < blockSize; i++) {
                        const sample = Math.abs(output[chOffset + i]);
                        if (sample > maxDelayed) {
                            maxDelayed = sample;
                        }
                    }
                }
                const requiredGain = (maxDelayed > effectiveThresholdLin) ? (effectiveThresholdLin / maxDelayed) : 1;
                
                // Update gain state per channel
                if (!context.gainStates) {
                    context.gainStates = new Float32Array(numChannels).fill(1);
                }
                for (let ch = 0; ch < numChannels; ch++) {
                    const currentGain = context.gainStates[ch];
                    if (requiredGain < currentGain) {
                        context.gainStates[ch] = requiredGain;
                    } else {
                        context.gainStates[ch] = releaseCoeff * currentGain + (1 - releaseCoeff) * requiredGain;
                    }
                }
                
                // Apply computed gain to the delayed output
                for (let ch = 0; ch < numChannels; ch++) {
                    const chOffset = ch * blockSize;
                    const gain = context.gainStates[ch];
                    for (let i = 0; i < blockSize; i++) {
                        output[chOffset + i] *= gain;
                    }
                }
                
                output.measurements = { time: parameters.time, gainReduction: 1 - Math.min(...context.gainStates) };
                return output;
            }
            
            // Oversampling Processing (os > 1) using Polyphase Filtering
            const osFactor = parameters.os;
            const L = osFactor;
            
            // Recompute filter coefficients if needed.
            if (!context.filterCoeffs || context.osFactorCached !== osFactor) {
                delete context.upsampleState;
                delete context.downsampleState;
                
                const N = 63;
                const half = (N - 1) / 2;
                const beta = 5.0;
                function sinc(x) { return (x === 0) ? 1 : Math.sin(Math.PI * x) / (Math.PI * x); }
                function kaiser(n, N, beta) {
                    let r = (n - (N - 1) / 2) / ((N - 1) / 2);
                    function I0(x) {
                        let sum = 1, y = x * x / 4, t = y;
                        for (let i = 1; i < 25; i++) { sum += t; t *= y / (i * i); }
                        return sum;
                    }
                    return I0(beta * Math.sqrt(1 - r * r)) / I0(beta);
                }
                let h = new Float32Array(N);
                for (let n = 0; n < N; n++) {
                    h[n] = osFactor * sinc((n - half) / osFactor) * kaiser(n, N, beta);
                }
                let sumH = 0;
                for (let n = 0; n < N; n++) {
                    sumH += h[n];
                }
                for (let n = 0; n < N; n++) {
                    h[n] *= osFactor / sumH;
                }
                let polyphase = [];
                for (let p = 0; p < L; p++) {
                    let phaseCoeffs = [];
                    for (let k = 0; p + L * k < N; k++) {
                        phaseCoeffs.push(h[p + L * k]);
                    }
                    polyphase.push(Float32Array.from(phaseCoeffs));
                }
                context.filterCoeffs = h;
                context.filterLength = N;
                context.polyphase = polyphase;
                context.osFactorCached = osFactor;
            }
            const N = context.filterLength;
            const polyphase = context.polyphase;
            
            // Upsampling (Polyphase Interpolation)
            let P_len = 0;
            for (let p = 0; p < L; p++) {
                if (polyphase[p].length > P_len) {
                    P_len = polyphase[p].length;
                }
            }
            if (!context.upsampleState) {
                context.upsampleState = [];
                for (let ch = 0; ch < numChannels; ch++) {
                    context.upsampleState[ch] = new Float32Array(P_len - 1).fill(0);
                }
            }
            let oversampledLength = blockSize * L;
            let oversampled = new Float32Array(numChannels * oversampledLength);
            for (let ch = 0; ch < numChannels; ch++) {
                const inOffset = ch * blockSize;
                const state = context.upsampleState[ch];
                let combinedLength = state.length + blockSize;
                let X = new Float32Array(combinedLength);
                X.set(state, 0);
                X.set(inputBuffer.subarray(inOffset, inOffset + blockSize), state.length);
                for (let i = P_len - 1; i < combinedLength; i++) {
                    let j = i - (P_len - 1);
                    for (let p = 0; p < L; p++) {
                        let acc = 0;
                        let h_poly = polyphase[p];
                        for (let k = 0; k < h_poly.length; k++) {
                            acc += h_poly[k] * X[i - k];
                        }
                        oversampled[ch * oversampledLength + j * L + p] = acc;
                    }
                }
                state.set(X.subarray(combinedLength - (P_len - 1), combinedLength));
            }
            
            // Lookahead Delay in Oversampled Domain
            const rawDelaySamplesOS = Math.ceil(parameters.la * sampleRate / 1000);
            const delaySamplesOS = (rawDelaySamplesOS > 0 ? rawDelaySamplesOS : 1) * osFactor;
            if (!context.delayBufferOS || context.delayBufferOS[0].length !== delaySamplesOS) {
                context.delayBufferOS = [];
                context.delayWritePosOS = [];
                for (let ch = 0; ch < numChannels; ch++) {
                    context.delayBufferOS[ch] = new Float32Array(delaySamplesOS).fill(0);
                    context.delayWritePosOS[ch] = 0;
                }
            }
            let delayedOversampled = new Float32Array(numChannels * oversampledLength);
            for (let ch = 0; ch < numChannels; ch++) {
                const buf = context.delayBufferOS[ch];
                let writePos = context.delayWritePosOS[ch];
                for (let i = 0; i < oversampledLength; i++) {
                    delayedOversampled[ch * oversampledLength + i] = buf[writePos];
                    buf[writePos] = oversampled[ch * oversampledLength + i];
                    writePos = (writePos + 1) % delaySamplesOS;
                }
                context.delayWritePosOS[ch] = writePos;
            }
            
            // Compute maximum level in delayed oversampled block
            let maxDelayedOS = 0;
            for (let ch = 0; ch < numChannels; ch++) {
                const offset = ch * oversampledLength;
                for (let i = 0; i < oversampledLength; i++) {
                    const sample = Math.abs(delayedOversampled[offset + i]);
                    if (sample > maxDelayedOS) {
                        maxDelayedOS = sample;
                    }
                }
            }
            const requiredGainOS = (maxDelayedOS > effectiveThresholdLin) ? (effectiveThresholdLin / maxDelayedOS) : 1;
            
            // Update gain state for each channel in oversampled domain
            if (!context.gainStates) {
                context.gainStates = new Float32Array(numChannels).fill(1);
            }
            for (let ch = 0; ch < numChannels; ch++) {
                const currentGain = context.gainStates[ch];
                if (requiredGainOS < currentGain) {
                    context.gainStates[ch] = requiredGainOS;
                } else {
                    context.gainStates[ch] = releaseCoeff * currentGain + (1 - releaseCoeff) * requiredGainOS;
                }
            }
            
            // Apply computed gain to the delayed oversampled signal
            for (let ch = 0; ch < numChannels; ch++) {
                const offset = ch * oversampledLength;
                const gain = context.gainStates[ch];
                for (let i = 0; i < oversampledLength; i++) {
                    delayedOversampled[offset + i] *= gain;
                }
            }
            
            // Downsampling (Polyphase Decimation)
            const M = Math.ceil(N / osFactor);
            // Set d to the full history length needed so that for i = 0:
            // n_index = d = osFactor*(M - 1) and the smallest index used is 0.
            const d = osFactor * (M - 1);
            const stateLength = d;
            if (!context.downsampleState) {
                context.downsampleState = [];
                for (let ch = 0; ch < numChannels; ch++) {
                    context.downsampleState[ch] = new Float32Array(stateLength).fill(0);
                }
            }
            let downsampledOutput = new Float32Array(numChannels * blockSize);
            for (let ch = 0; ch < numChannels; ch++) {
                const osOffset = ch * oversampledLength;
                const state = context.downsampleState[ch];
                let combinedLength = state.length + oversampledLength;
                let Z = new Float32Array(combinedLength);
                Z.set(state, 0);
                Z.set(delayedOversampled.subarray(osOffset, osOffset + oversampledLength), state.length);
                for (let i = 0; i < blockSize; i++) {
                    let n_index = i * L + d;
                    let r = n_index % L;
                    let acc = 0;
                    let h_poly = polyphase[r];
                    for (let k = 0; k < h_poly.length; k++) {
                        let idx = n_index - L * k;
                        if (idx < 0) break;
                        acc += h_poly[k] * Z[idx];
                    }
                    downsampledOutput[ch * blockSize + i] = acc;
                }
                state.set(Z.subarray(combinedLength - stateLength, combinedLength));
            }
            
            downsampledOutput.measurements = {
                time: parameters.time,
                gainReduction: 1 - Math.min(...context.gainStates)
            };
            context.initialized = true;
            return downsampledOutput;
        `);
    }
    
    _setupMessageHandler() {
        // No additional message handling required.
    }
    
    _validateParameters(params) {
        super._validateParameters(params);
        const validateRange = (value, min, max, name) => {
            if (typeof value !== "number" || isNaN(value) || value < min || value > max) {
                throw new Error(name + " must be between " + min + " and " + max);
            }
        };
        if (params.th !== undefined) { validateRange(params.th, -24, 0, "Threshold"); }
        if (params.rl !== undefined) { validateRange(params.rl, 10, 500, "Release Time"); }
        if (params.la !== undefined) { validateRange(params.la, 0, 10, "Lookahead Time"); }
        if (params.os !== undefined) {
            if (![1, 2, 4, 8].includes(params.os)) {
                throw new Error("Oversampling Factor must be 1, 2, 4, or 8");
            }
        }
        if (params.ig !== undefined) { validateRange(params.ig, -18, 18, "Input Gain"); }
        if (params.sm !== undefined) { validateRange(params.sm, -3.00, 0.00, "Margin"); }
    }
    
    _setValidatedParameters(params) {
        if (params.th !== undefined) this.th = params.th;
        if (params.rl !== undefined) this.rl = params.rl;
        if (params.la !== undefined) this.la = params.la;
        if (params.os !== undefined) this.os = params.os;
        if (params.ig !== undefined) this.ig = params.ig;
        if (params.sm !== undefined) this.sm = params.sm;
        this.updateParameters();
    }
    
    getParameters() {
        const baseParams = super.getParameters();
        return {
            ...baseParams,
            enabled: this.enabled,
            th: this.th,
            rl: this.rl,
            la: this.la,
            os: this.os,
            ig: this.ig,
            sm: this.sm
        };
    }
    
    setTh(value) { this.setParameters({ th: value }); }
    setRl(value) { this.setParameters({ rl: value }); }
    setLa(value) { this.setParameters({ la: value }); }
    setOs(value) { this.setParameters({ os: value }); }
    setIg(value) { this.setParameters({ ig: value }); }
    setSm(value) { this.setParameters({ sm: value }); }
    
    createUI() {
        const container = document.createElement("div");
        container.className = "plugin-parameter-ui";
        const createControl = (label, min, max, step, value, setter) => {
            const row = document.createElement("div");
            row.className = "parameter-row";
            const labelEl = document.createElement("label");
            labelEl.textContent = label;
            const slider = document.createElement("input");
            slider.type = "range";
            slider.min = min; slider.max = max; slider.step = step; slider.value = value;
            const numberInput = document.createElement("input");
            numberInput.type = "number";
            numberInput.min = min; numberInput.max = max; numberInput.step = step; numberInput.value = value;
            slider.addEventListener("input", (e) => { setter(parseFloat(e.target.value)); numberInput.value = e.target.value; });
            numberInput.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value) || 0;
                const clamped = Math.max(min, Math.min(max, val));
                setter(clamped);
                slider.value = clamped;
                e.target.value = clamped;
            });
            row.appendChild(labelEl);
            row.appendChild(slider);
            row.appendChild(numberInput);
            return row;
        };
        container.appendChild(createControl("Input Gain (dB):", -18, 18, 0.1, this.ig, this.setIg.bind(this)));
        container.appendChild(createControl("Threshold (dB):", -24, 0, 0.1, this.th, this.setTh.bind(this)));
        container.appendChild(createControl("Release (ms):", 10, 500, 1, this.rl, this.setRl.bind(this)));
        container.appendChild(createControl("Lookahead (ms):", 0, 10, 0.1, this.la, this.setLa.bind(this)));
        container.appendChild(createControl("Margin (dB):", -1.000, 0.000, 0.001, this.sm, this.setSm.bind(this)));
        const osRow = document.createElement("div");
        osRow.className = "parameter-row";
        const osLabel = document.createElement("label");
        osLabel.textContent = "Oversampling:";
        osRow.appendChild(osLabel);
        const osSelect = document.createElement("select");
        [1,2,4,8].forEach(factor => {
            const option = document.createElement("option");
            option.value = factor;
            option.textContent = factor + "x";
            if (factor === this.os) { option.selected = true; }
            osSelect.appendChild(option);
        });
        osSelect.addEventListener("change", () => {
            this.setParameters({ os: parseInt(osSelect.value) });
        });
        osRow.appendChild(osSelect);
        container.appendChild(osRow);
        return container;
    }
}
  
window.BrickwallLimiterPlugin = BrickwallLimiterPlugin;
