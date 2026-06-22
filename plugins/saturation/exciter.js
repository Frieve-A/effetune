class ExciterPlugin extends PluginBase {
    constructor() {
        super('Exciter', 'Add harmonic content to enhance clarity and presence');
        this.hf = 3000;   // hf: HPF Freq (500-10000 Hz)
        this.hs = 1;      // hs: HPF Slope (0=off, 1=6dB/oct, 2=12dB/oct)
        this.dr = 3.0;    // dr: Drive (0.0-10.0)
        this.bs = 0.1;    // bs: Bias (-0.3 to 0.3)
        this.mx = 25;     // mx: Mix (0-100%)

        this.registerProcessor(`
            // Bypass processing if the plugin is disabled.
            if (!parameters.enabled) return data;
            
            const {
                hf: hpfFreq,
                hs: hpfSlope,
                dr: drive,
                bs: bias,
                mx: mix,
                channelCount,
                blockSize,
                sampleRate
            } = parameters;
            
            // Initialize filter state if it doesn't exist or channel count has changed.
            if (!context.initialized || context.lastChannelCount !== channelCount) {
                context.hpfState = new Array(channelCount).fill(null).map(() => ({
                    x1: 0,
                    y1: 0,
                    x2: 0,
                    y2: 0
                }));
                context.lastChannelCount = channelCount;
                context.initialized = true;
            }
            
            // Recalculate filter coefficients if relevant parameters have changed.
            if (context.lastFreq !== hpfFreq || context.lastSlope !== hpfSlope || context.lastSampleRate !== sampleRate) {
                context.lastFreq = hpfFreq;
                context.lastSlope = hpfSlope;
                context.lastSampleRate = sampleRate;
                
                if (hpfSlope === 0) {
                    context.useHPF = false;
                } else {
                    context.useHPF = true;
                    const omega = Math.tan(Math.PI * hpfFreq / sampleRate);
                    
                    if (hpfSlope === 1) {
                        // 6dB/oct (1st order Butterworth high-pass)
                        const n = 1 / (1 + omega);
                        context.b0 = n;
                        context.b1 = -n;
                        context.a1 = (omega - 1) * n;
                        context.firstOrder = true;
                    } else {
                        // 12dB/oct (2nd order Butterworth high-pass)
                        const omega2 = omega * omega;
                        const sqrt2 = Math.SQRT2;
                        const n = 1 / (1 + sqrt2 * omega + omega2);
                        context.b0 = n;
                        context.b1 = -2 * n;
                        context.b2 = n;
                        context.a1 = 2 * (omega2 - 1) * n;
                        context.a2 = (1 - sqrt2 * omega + omega2) * n;
                        context.firstOrder = false;
                    }
                }
            }
            
            const mixRatio = mix * 0.01;
            const biasOffset = Math.tanh(drive * bias);

            // Cache parameters and filter coefficients for this processing block.
            const useHPF = context.useHPF;
            const firstOrder = context.firstOrder;
            const { b0, b1, b2, a1, a2 } = context;

            // Process each audio channel.
            for (let ch = 0; ch < channelCount; ch++) {
                const offset = ch * blockSize;
                
                // Retrieve filter state for the current channel.
                const state = context.hpfState[ch];
                let x1 = state.x1, y1 = state.y1, x2 = state.x2, y2 = state.y2;

                // Select the appropriate processing loop based on filter settings.
                if (useHPF) {
                    if (firstOrder) {
                        // Process audio with 1st Order HPF.
                        for (let i = 0; i < blockSize; i++) {
                            const dry = data[offset + i];
                            const y = b0 * dry + b1 * x1 - a1 * y1;
                            x1 = dry;
                            y1 = (Math.abs(y) < 1.0e-25) ? 0 : y;
                            const wet = Math.tanh(drive * (y1 + bias)) - biasOffset;
                            data[offset + i] = dry + wet * mixRatio;
                        }
                    } else {
                        // Process audio with 2nd Order HPF.
                        for (let i = 0; i < blockSize; i++) {
                            const dry = data[offset + i];
                            const y = b0 * dry + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
                            x2 = x1;
                            x1 = dry;
                            y2 = y1;
                            y1 = (Math.abs(y) < 1.0e-25) ? 0 : y;
                            const wet = Math.tanh(drive * (y1 + bias)) - biasOffset;
                            data[offset + i] = dry + wet * mixRatio;
                        }
                    }
                } else {
                    // Process audio with HPF bypassed.
                    for (let i = 0; i < blockSize; i++) {
                        const dry = data[offset + i];
                        const wet = Math.tanh(drive * (dry + bias)) - biasOffset;
                        data[offset + i] = dry + wet * mixRatio;
                    }
                }
                
                // Update filter state for the next audio block.
                state.x1 = x1;
                state.y1 = y1;
                state.x2 = x2;
                state.y2 = y2;
            }
            
            return data;
        `);
    }

    setParameters(params) {
        let graphNeedsUpdate = false;
        
        if (params.hf !== undefined) {
            this.hf = this.parseFiniteNumber(params.hf, 500, 10000, this.hf);
            graphNeedsUpdate = true;
        }
        if (params.hs !== undefined) {
            const value = this.parseFiniteNumber(params.hs, 0, 2, this.hs);
            this.hs = this.isAllowedEnum(value, [0, 1, 2], this.hs);
            graphNeedsUpdate = true;
        }
        if (params.dr !== undefined) {
            this.dr = this.parseFiniteNumber(params.dr, 0, 10, this.dr);
            graphNeedsUpdate = true;
        }
        if (params.bs !== undefined) {
            this.bs = this.parseFiniteNumber(params.bs, -0.3, 0.3, this.bs);
            graphNeedsUpdate = true;
        }
        if (params.mx !== undefined) {
            this.mx = this.parseFiniteNumber(params.mx, 0, 100, this.mx);
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        
        this.updateParameters();
        
        if (graphNeedsUpdate) {
            this.updateGraphs();
        }
    }

    setHPFFreq(value) { this.setParameters({ hf: value }); }
    setHPFSlope(value) { this.setParameters({ hs: value }); }
    setDrive(value) { this.setParameters({ dr: value }); }
    setBias(value) { this.setParameters({ bs: value }); }
    setMix(value) { this.setParameters({ mx: value }); }

    getParameters() {
        return {
            type: this.constructor.name,
            hf: this.hf,
            hs: this.hs,
            dr: this.dr,
            bs: this.bs,
            mx: this.mx,
            enabled: this.enabled
        };
    }

    updateGraphs() {
        if (this.hpfCanvas) this.drawHPFGraph(this.hpfCanvas);
        if (this.satCanvas) this.drawSaturationGraph(this.satCanvas);
    }

    drawHPFGraph(canvas) {
        const ctx = canvas.getContext("2d");
        const width = canvas.width, height = canvas.height;
        ctx.clearRect(0, 0, width, height);

        // Draw grid
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 1;
        const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        freqs.forEach(freq => {
            const x = width * (Math.log10(freq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            if (freq >= 50 && freq <= 10000) {
                ctx.fillStyle = "#666";
                ctx.font = "20px Arial";
                ctx.textAlign = "center";
                ctx.fillText(freq >= 1000 ? `${freq/1000}k` : freq, x, height - 40);
            }
        });
        const dBs = [-60, -48, -36, -24, -12, 0, 12];
        dBs.forEach(db => {
            const y = height * (1 - (db + 60) / 72);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            // Brighten the 0dB line
            if (db === 0) {
                ctx.strokeStyle = "#888";
                ctx.lineWidth = 2;
            } else {
                ctx.strokeStyle = "#444";
                ctx.lineWidth = 1;
            }
            ctx.stroke();
            if (db > -60 && db < 12) {
                ctx.fillStyle = "#666";
                ctx.font = "20px Arial";
                ctx.textAlign = "right";
                ctx.fillText(`${db}dB`, 80, y + 6);
            }
        });
        ctx.fillStyle = "#fff";
        ctx.font = "24px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Frequency (Hz)", width / 2, height - 5);
        ctx.save();
        ctx.translate(20, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("Level (dB)", 0, 0);
        ctx.restore();

        // Calculate the frequency response
        ctx.beginPath();
        ctx.strokeStyle = "#00ff00";
        ctx.lineWidth = 2;
        for (let i = 0; i < width; i++) {
            const freq = Math.pow(10, Math.log10(20) + (i / width) * (Math.log10(20000) - Math.log10(20)));

            // Calculate high-pass filter response
            let hpfMag = 1;
            if (this.hs !== 0) {
                const wRatio = freq / this.hf;
                
                if (this.hs === 1) {
                    // 6dB/oct (1st order)
                    hpfMag = wRatio / Math.sqrt(1 + wRatio * wRatio);
                } else if (this.hs === 2) {
                    // 12dB/oct (2nd order)
                    hpfMag = wRatio * wRatio / Math.sqrt(1 + Math.pow(wRatio, 4));
                }
            }
            
            const response = 20 * Math.log10(hpfMag);
            const y = height * (1 - (response + 60) / 72);
            i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y);
        }
        ctx.stroke();
    }

    drawSaturationGraph(canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        for (let x = 0; x <= width; x += width / 4) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y <= height; y += height / 4) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        ctx.fillStyle = '#fff';
        ctx.font = '28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('in', width / 2, height - 5);
        ctx.save();
        ctx.translate(20, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('out', 0, 0);
        ctx.restore();
        ctx.fillStyle = '#666';
        ctx.font = '20px Arial';
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
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const mixRatio = this.mx / 100;
        for (let i = 0; i < width; i++) {
            const x = (i / width) * 2 - 1;
            const wet = Math.tanh(this.dr * (x + this.bs)) - Math.tanh(this.dr * this.bs);
            const y = ((1 - mixRatio) * x + mixRatio * wet);
            const canvasY = ((1 - y) / 2) * height;
            if (i === 0) {
                ctx.moveTo(i, canvasY);
            } else {
                ctx.lineTo(i, canvasY);
            }
        }
        ctx.stroke();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'exciter-plugin-ui plugin-parameter-ui';

        // HPF Frequency control
        const freqRow = this.createParameterControl(
            'HPF Freq', 500, 10000, 10, this.hf,
            this.setHPFFreq.bind(this), 'Hz'
        );
        container.appendChild(freqRow);

        // HPF Slope selector
        const slopeRow = document.createElement('div');
        slopeRow.className = 'parameter-row';
        
        const slopeLabel = document.createElement('label');
        slopeLabel.textContent = 'HPF Slope:';
        slopeLabel.className = 'parameter-label';
        slopeRow.appendChild(slopeLabel);
        
        const slopeSelect = document.createElement('select');
        slopeSelect.className = 'slope-select';
        slopeSelect.id = `${this.id}-${this.name}-hpf-slope`;
        slopeSelect.name = `${this.id}-${this.name}-hpf-slope`;
        slopeSelect.autocomplete = 'off';
        
        const slopes = [
            { value: 0, label: 'Off' },
            { value: 1, label: '6dB/oct' },
            { value: 2, label: '12dB/oct' }
        ];
        
        slopes.forEach(slope => {
            const option = document.createElement('option');
            option.value = slope.value;
            option.textContent = slope.label;
            option.selected = this.hs === slope.value;
            slopeSelect.appendChild(option);
        });
        
        slopeSelect.addEventListener('change', e => {
            this.setHPFSlope(parseInt(e.target.value));
        });
        
        slopeRow.appendChild(slopeSelect);
        container.appendChild(slopeRow);

        // Drive control
        container.appendChild(this.createParameterControl(
            'Drive', 0, 10, 0.1, this.dr,
            this.setDrive.bind(this)
        ));

        // Bias control
        container.appendChild(this.createParameterControl(
            'Bias', -0.3, 0.3, 0.01, this.bs,
            this.setBias.bind(this)
        ));

        // Mix control
        container.appendChild(this.createParameterControl(
            'Mix', 0, 100, 1, this.mx,
            this.setMix.bind(this), '%'
        ));

        // Graphs container
        const graphsContainer = document.createElement('div');
        graphsContainer.className = 'graphs-container';
        graphsContainer.style.display = 'flex';
        graphsContainer.style.gap = '10px';
        graphsContainer.style.marginTop = '10px';

        // HPF graph
        const hpfGraphContainer = document.createElement('div');
        hpfGraphContainer.style.position = 'relative';
        const hpfCanvas = document.createElement('canvas');
        hpfCanvas.width = 1200;
        hpfCanvas.height = 400;
        hpfCanvas.style.width = '600px';
        hpfCanvas.style.height = '200px';
        hpfCanvas.style.backgroundColor = '#222';
        this.hpfCanvas = hpfCanvas;
        hpfGraphContainer.appendChild(hpfCanvas);
        graphsContainer.appendChild(hpfGraphContainer);

        // Saturation graph
        const satGraphContainer = document.createElement('div');
        satGraphContainer.style.position = 'relative';
        const satCanvas = document.createElement('canvas');
        satCanvas.width = 400;
        satCanvas.height = 400;
        satCanvas.style.width = '200px';
        satCanvas.style.height = '200px';
        satCanvas.style.backgroundColor = '#222';
        this.satCanvas = satCanvas;
        satGraphContainer.appendChild(satCanvas);
        graphsContainer.appendChild(satGraphContainer);

        container.appendChild(graphsContainer);

        // Initial graph draw
        this.updateGraphs();

        return container;
    }
}

window.ExciterPlugin = ExciterPlugin;
