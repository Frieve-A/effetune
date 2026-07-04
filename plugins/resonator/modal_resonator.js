class ModalResonatorPlugin extends PluginBase {
    constructor() {
        super('Modal Resonator', 'Frequency resonance effect with up to 5 resonators');

        this.en = true;
        this.rs = Array(5).fill(null).map((_, i) => ({
            en: true,
            fr: this._getInitialFreq(i),
            dc: this._getInitialDecay(i),
            lp: this._getInitialLpf(i),
            hp: this._getInitialHpf(i),
            gn: [0, -3, -6, -9, -12][i]
        }));
        this.mx = 25;
        this.sr = 0;

        const LOG_20 = Math.log(20);
        const LOG_20000 = Math.log(20000);
        const LOG_RANGE_RECIP = 1 / (LOG_20000 - LOG_20);
        const TWO_PI = 2 * Math.PI;

        // Register the audio processor
        this.registerProcessor(`
            if (!parameters.en) return data;
        
            const sampleRate = parameters.sampleRate;
            const channelCount = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const TWO_PI = 6.283185307179586;
        
            // Dry/Wet calculation
            const mix = parameters.mx;
            const wetGain = (mix < 50) ? (mix * 0.02) : 1.0;
            const dryGain = (mix < 50) ? 1.0 : ((100 - mix) * 0.02);
        
            // 1-pole HPF: y[n] = a * (y[n-1] + x[n] - x[n-1])
            function processHPF(x, st, alpha) {
                const y = alpha * (st.yPrev + x - st.xPrev);
                st.xPrev = x;
                st.yPrev = y;
                return y;
            }
        
            // 1-pole LPF: y[n] = y[n-1] + (1 - alpha)*(x[n] - y[n-1])
            function processLPF(x, st, alpha) {
                const y = st.yPrev + (1 - alpha) * (x - st.yPrev);
                st.yPrev = y;
                return y;
            }
        
            // Initialization if necessary
            if (
                !context.initialized ||
                context.sampleRate !== sampleRate ||
                context.channelCount !== channelCount
            ) {
                const maxDelay = Math.ceil(sampleRate * 2); // 2 seconds
                context.delayBuffers = [];
                context.delayPositions = [];
                context.hpfStates = [];
                context.lpfStates = [];
        
                for (let ch = 0; ch < channelCount; ch++) {
                    context.delayBuffers[ch] = new Array(5);
                    context.delayPositions[ch] = new Uint32Array(5);
                    context.hpfStates[ch] = new Array(5);
                    context.lpfStates[ch] = new Array(5);
        
                    for (let r = 0; r < 5; r++) {
                        context.delayBuffers[ch][r] = new Float32Array(maxDelay);
        
                        context.hpfStates[ch][r] = { xPrev: 0.0, yPrev: 0.0 };
                        context.lpfStates[ch][r] = { yPrev: 0.0 };
                    }
                }
                context.accum = new Float32Array(blockSize);
                context.resonators = new Array(5);
                for (let r = 0; r < 5; r++) {
                    context.resonators[r] = {
                        enabled: false,
                        delaySamples: 1,
                        feedback: 0.0,
                        alphaHPF: 0.0,
                        alphaLPF: 0.0,
                        gain: 0.0
                    };
                }
        
                context.initialized = true;
                context.sampleRate = sampleRate;
                context.channelCount = channelCount;
            }
            if (!context.accum || context.accum.length !== blockSize) {
                context.accum = new Float32Array(blockSize);
            }
        
            // Prepare resonator parameters
            const resonators = context.resonators;
            for (let r = 0; r < 5; r++) {
                const p = parameters.rs[r];
                const cfg = resonators[r];
                if (!p.en) {
                    cfg.enabled = false;
                    continue;
                }
                const freqHz = Math.exp(p.fr);
                let delaySamp = Math.floor(sampleRate / freqHz);
                if (delaySamp < 1) delaySamp = 1;
        
                const decaySamples = p.dc * 0.001 * sampleRate;
                let cycles = decaySamples / delaySamp;
                if (cycles < 0.1) cycles = 0.1;
                let fb = Math.exp(Math.log(0.001) / cycles);
                if (fb > 0.999) fb = 0.999;
        
                const hpfHz = Math.exp(p.hp);
                const alphaHPF = Math.exp(-TWO_PI * hpfHz / sampleRate);
        
                const lpfHz = Math.exp(p.lp);
                const alphaLPF = Math.exp(-TWO_PI * lpfHz / sampleRate);
        
                const gainLinear = Math.pow(10, p.gn / 20.0);
        
                cfg.enabled = true;
                cfg.delaySamples = delaySamp;
                cfg.feedback = fb;
                cfg.alphaHPF = alphaHPF;
                cfg.alphaLPF = alphaLPF;
                cfg.gain = gainLinear;
            }
        
            const db = context.delayBuffers;
            const dp = context.delayPositions;
            const hpSt = context.hpfStates;
            const lpSt = context.lpfStates;
            const accum = context.accum;
        
            // Main loop
            for (let ch = 0; ch < channelCount; ch++) {
                const offset = ch * blockSize;
                accum.fill(0.0);
        
                for (let r = 0; r < 5; r++) {
                    const cfg = resonators[r];
                    if (!cfg.enabled) continue;
        
                    const buf = db[ch][r];
                    const len = buf.length;
                    let pos = dp[ch][r];
                    const hpfState = hpSt[ch][r];
                    const lpfState = lpSt[ch][r];
        
                    for (let i = 0; i < blockSize; i++) {
                        const input = data[offset + i];
        
                        // Delay read (unfiltered feedback)
                        const readPos = (pos - cfg.delaySamples + len) % len;
                        const delayedSample = buf[readPos];
        
                        // Write feedback
                        buf[pos] = input + delayedSample * cfg.feedback;
        
                        // Output filter
                        const afterHPF = processHPF(delayedSample, hpfState, cfg.alphaHPF);
                        const afterLPF = processLPF(afterHPF, lpfState, cfg.alphaLPF);
                        const outVal = afterLPF * cfg.gain;
        
                        accum[i] += outVal;
        
                        // Increment position
                        pos++;
                        if (pos >= len) pos = 0;
                    }
                    dp[ch][r] = pos;
                }
        
                // Dry/Wet mix
                for (let i = 0; i < blockSize; i++) {
                    const drySig = data[offset + i];
                    data[offset + i] = drySig * dryGain + accum[i] * wetGain;
                }
            }
        
            return data;
        `);              
    }

    _getInitialFreq(index) {
        // Slightly adjusted modal frequencies reflecting realistic irregularities (Hz)
        const freqValues = [950, 1850, 2950, 4200, 6300];
        return Number(Math.log(freqValues[index]).toFixed(2));
    }
    
    _getInitialDecay(index) {
        // Decay values remain realistic and accurate (ms)
        return [15, 12, 10, 8, 6][index];
    }
    
    _getInitialLpf(index) {
        // LPF at approximately 1.4× resonant frequency to better match measurement data
        const lpfValues = [1330, 2590, 4130, 5880, 8800];
        return Number(Math.log(lpfValues[index]).toFixed(2));
    }
    
    _getInitialHpf(index) {
        // HPF at approximately 0.35× resonant frequency to avoid unnatural thinning
        const hpfValues = [330, 650, 1030, 1470, 2200];
        return Number(Math.log(hpfValues[index]).toFixed(2));
    }   

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            en: this.en,
            rs: this.rs,
            mx: this.mx,
            sr: this.sr
        };
    }

    setParameters(params) {
        let updated = false;

        if (params.en !== undefined) {
            this.en = Boolean(params.en);
            updated = true;
        }

        if (params.mx !== undefined) {
            const newMix = Number(params.mx);
            if (!isNaN(newMix)) {
                this.mx = Math.max(0, Math.min(100, newMix));
                updated = true;
            }
        }

        if (params.sr !== undefined) {
            const index = Number(params.sr);
            if (!isNaN(index) && index >= 0 && index < 5) {
                this.sr = Math.floor(index);
                updated = true;
            }
        }

        if (params.rs !== undefined && Array.isArray(params.rs)) {
            params.rs.forEach((resonator, index) => {
                if (index < this.rs.length && resonator) {
                    if (resonator.en !== undefined) {
                        this.rs[index].en = Boolean(resonator.en);
                    }
                    if (resonator.fr !== undefined) {
                        const fr = Number(resonator.fr);
                        if (!isNaN(fr)) {
                            this.rs[index].fr = Math.max(3.00, Math.min(9.90, fr));
                        }
                    }
                    if (resonator.dc !== undefined) {
                        const dc = Number(resonator.dc);
                        if (!isNaN(dc)) {
                            this.rs[index].dc = Math.max(1, Math.min(500, dc));
                        }
                    }
                    if (resonator.lp !== undefined) {
                        const lp = Number(resonator.lp);
                        if (!isNaN(lp)) {
                            this.rs[index].lp = Math.max(3.00, Math.min(9.90, lp));
                        }
                    }
                    if (resonator.hp !== undefined) {
                        const hp = Number(resonator.hp);
                        if (!isNaN(hp)) {
                            this.rs[index].hp = Math.max(3.00, Math.min(9.90, hp));
                        }
                    }
                    if (resonator.gn !== undefined) {
                        const gn = Number(resonator.gn);
                        if (!isNaN(gn)) {
                            this.rs[index].gn = Math.max(-18, Math.min(18, gn));
                        }
                    }
                }
            });
            updated = true;
        }

        if (params.resonatorIndex !== undefined && params.resonatorParams) {
            const index = Number(params.resonatorIndex);
            if (!isNaN(index) && index >= 0 && index < 5) {
                const resonator = this.rs[index];
                const resParams = params.resonatorParams;

                if (resParams.en !== undefined) {
                    resonator.en = Boolean(resParams.en);
                    updated = true;
                }
                if (resParams.fr !== undefined) {
                    const freq = Number(resParams.fr);
                    if (!isNaN(freq)) {
                        resonator.fr = Math.max(3.00, Math.min(9.90, freq));
                        updated = true;
                    }
                }
                if (resParams.dc !== undefined) {
                    const decay = Number(resParams.dc);
                    if (!isNaN(decay)) {
                        resonator.dc = Math.max(1, Math.min(500, decay));
                        updated = true;
                    }
                }
                if (resParams.lp !== undefined) {
                    const lpf = Number(resParams.lp);
                    if (!isNaN(lpf)) {
                        resonator.lp = Math.max(3.00, Math.min(9.90, lpf));
                        updated = true;
                    }
                }
                if (resParams.hp !== undefined) {
                    const hpf = Number(resParams.hp);
                    if (!isNaN(hpf)) {
                        resonator.hp = Math.max(3.00, Math.min(9.90, hpf));
                        updated = true;
                    }
                }
                if (resParams.gn !== undefined) {
                    const gain = Number(resParams.gn);
                    if (!isNaN(gain)) {
                        resonator.gn = Math.max(-18, Math.min(18, gain));
                        updated = true;
                    }
                }
            }
        }

        if (updated) {
            this.updateParameters();
        }
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';
        container.id = this.id;

        const resonatorContainer = document.createElement('div');
        resonatorContainer.className = 'modal-resonator-container';

        const settingsContainer = document.createElement('div');
        settingsContainer.className = 'modal-resonator-frame';

        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'modal-resonator-tabs';
        tabsContainer.style.flexWrap = 'wrap';

        const contentContainer = document.createElement('div');

        const createResonatorRow = (label, min, max, step, value, param, resonatorIndex) => {
            const row = document.createElement('div');
            row.className = 'parameter-row';

            // Generate unique ID
            const sliderId = `${this.id}-${this.name}-res${resonatorIndex}-${param}-slider`;
            const inputId = `${this.id}-${this.name}-res${resonatorIndex}-${param}-input`;

            const labelEl = document.createElement('label');
            labelEl.textContent = label;
            labelEl.htmlFor = sliderId;
            row.appendChild(labelEl);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.id = sliderId;
            slider.name = sliderId;
            slider.min = min;
            slider.max = max;
            slider.step = step;
            slider.value = value;

            const input = document.createElement('input');
            input.type = 'number';
            input.id = inputId;
            input.name = inputId;
            if (param === 'fr' || param === 'lp' || param === 'hp') {
                input.min = Math.round(Math.exp(min));
                input.max = Math.round(Math.exp(max));
                input.step = 1;
                input.value = Math.round(Math.exp(value));
            } else {
                input.min = min;
                input.max = max;
                input.step = step;
                input.value = value;
            }

            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (param === 'fr' || param === 'lp' || param === 'hp') {
                    input.value = Math.round(Math.exp(val));
                } else {
                    input.value = val;
                }
                const params = {};
                params[param] = val;
                this.setParameters({
                    resonatorIndex: resonatorIndex,
                    resonatorParams: params
                });
            });

            input.addEventListener('input', (e) => {
                let inputVal = parseFloat(e.target.value);
                let paramVal;
                if (isNaN(inputVal)) {
                    inputVal = (param === 'fr' || param === 'lp' || param === 'hp') ? Math.round(Math.exp(this.rs[resonatorIndex][param])) : this.rs[resonatorIndex][param];
                }
                if (param === 'fr' || param === 'lp' || param === 'hp') {
                    const minHz = Math.round(Math.exp(min));
                    const maxHz = Math.round(Math.exp(max));
                    inputVal = Math.max(minHz, Math.min(maxHz, inputVal));
                    paramVal = Math.log(inputVal);
                    paramVal = Math.max(min, Math.min(max, parseFloat(paramVal.toFixed(2))));
                    e.target.value = Math.round(inputVal);
                } else {
                    paramVal = Math.max(min, Math.min(max, inputVal));
                    e.target.value = paramVal;
                }
                slider.value = paramVal;
                const params = {};
                params[param] = paramVal;
                this.setParameters({
                    resonatorIndex: resonatorIndex,
                    resonatorParams: params
                });
            });

            row.appendChild(slider);
            row.appendChild(input);
            return row;
        };

        for (let i = 0; i < 5; i++) {
            const tab = document.createElement('button');
            tab.className = `modal-resonator-tab ${i === this.sr ? 'active' : ''}`;
            tab.textContent = `Resonator ${i + 1}`;

            tab.onclick = () => {
                const pluginUI = document.getElementById(this.id);
                if (!pluginUI) return;

                pluginUI.querySelectorAll('.modal-resonator-tab').forEach(el => el.classList.remove('active'));
                pluginUI.querySelectorAll('.modal-resonator-content').forEach(el => el.classList.remove('active'));

                tab.classList.add('active');
                const content = pluginUI.querySelector(`.modal-resonator-content[data-index="${i}"]`);
                if (content) {
                    content.classList.add('active');
                }
                this.setParameters({ sr: i });
            };

            tabsContainer.appendChild(tab);

            const content = document.createElement('div');
            content.className = `modal-resonator-content ${i === this.sr ? 'active' : ''}`;
            content.setAttribute('data-index', i);

            const paramUI = document.createElement('div');
            paramUI.className = 'plugin-parameter-ui';
            content.appendChild(paramUI);

            const resonator = this.rs[i];

            const enableRow = document.createElement('div');
            enableRow.className = 'parameter-row';
            const enableId = `${this.id}-${this.name}-res${i}-enable`;
            const enableLabel = document.createElement('label');
            enableLabel.textContent = 'Enable:';
            enableLabel.htmlFor = enableId;
            enableRow.appendChild(enableLabel);

            const enableCheckbox = document.createElement('input');
            enableCheckbox.type = 'checkbox';
            enableCheckbox.id = enableId;
            enableCheckbox.name = enableId;
            enableCheckbox.checked = resonator.en;
            enableCheckbox.onchange = (e) => {
                this.setParameters({
                    resonatorIndex: i,
                    resonatorParams: { en: e.target.checked }
                });
            };
            enableRow.appendChild(enableCheckbox);
            paramUI.appendChild(enableRow);

            paramUI.appendChild(createResonatorRow(
                'Freq (Hz):', 3.00, 9.90, 0.01, resonator.fr, 'fr', i
            ));
            paramUI.appendChild(createResonatorRow(
                'Decay (ms):', 1, 500, 1, resonator.dc, 'dc', i
            ));
            paramUI.appendChild(createResonatorRow(
                'LPF Freq (Hz):', 3.00, 9.90, 0.01, resonator.lp, 'lp', i
            ));
            paramUI.appendChild(createResonatorRow(
                'HPF Freq (Hz):', 3.00, 9.90, 0.01, resonator.hp, 'hp', i
            ));
            paramUI.appendChild(createResonatorRow(
                'Gain (dB):', -18, 18, 0.1, resonator.gn, 'gn', i
            ));

            contentContainer.appendChild(content);
        }

        settingsContainer.appendChild(tabsContainer);
        settingsContainer.appendChild(contentContainer);
        resonatorContainer.appendChild(settingsContainer);
        container.appendChild(resonatorContainer);

        // Mix Control
        const mixRow = document.createElement('div');
        mixRow.className = 'parameter-row';
        const mixLabel = document.createElement('label');
        mixLabel.textContent = 'Mix (%):';
        mixLabel.htmlFor = `${this.id}-${this.name}-mix-slider`;
        const mixSlider = document.createElement('input');
        mixSlider.type = 'range';
        mixSlider.id = `${this.id}-${this.name}-mix-slider`;
        mixSlider.name = `${this.id}-${this.name}-mix-slider`;
        mixSlider.min = 0;
        mixSlider.max = 100;
        mixSlider.step = 1;
        mixSlider.value = this.mx;
        const mixValue = document.createElement('input');
        mixValue.type = 'number';
        mixValue.id = `${this.id}-${this.name}-mix-value`;
        mixValue.name = `${this.id}-${this.name}-mix-value`;
        mixValue.min = 0;
        mixValue.max = 100;
        mixValue.step = 1;
        mixValue.value = this.mx;
        const mixHandler = (e) => {
            const value = parseFloat(e.target.value);
            mixSlider.value = value;
            mixValue.value = value;
            this.setParameters({ mx: value });
        };
        mixSlider.addEventListener('input', mixHandler);
        mixValue.addEventListener('input', mixHandler);
        mixRow.appendChild(mixLabel);
        mixRow.appendChild(mixSlider);
        mixRow.appendChild(mixValue);
        container.appendChild(mixRow);

        return container;
    }
}

window.ModalResonatorPlugin = ModalResonatorPlugin;
