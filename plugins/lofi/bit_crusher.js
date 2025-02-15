// BitCrusherPlugin with integrated bit reduction and R2R ladder DAC simulation,
// using fixed resistor error values per channel and a seedable random generator.
// The input signal is quantized to the specified bit depth (bd) and then reconstructed
// via a simulated R2R ladder DAC. For each channel, each active bit (from MSB) gets an
// ideal weight (0.5^(bitIndex+1)) modified by a resistor error factor based on Bit Error (be).
// The resistor error values are computed only when bd, be, or the Seed changes.
// A seed parameter (0-1000, step 1) allows fixing the randomness per channel.
class BitCrusherPlugin extends PluginBase {
    constructor() {
        super('Bit Crusher', 'Bit depth reduction with R2R ladder DAC simulation');
        this.bd = 8;         // Bit Depth (range: 4-24)
        this.td = false;     // TPDF Dither (true/false)
        this.zf = 44100;     // Zero-Order Hold Frequency (Hz) (range: 4000-96000)
        this.be = 0.0;       // Bit Error in percent (0.00 - 10.00%), initial value 0.0%
        this.sd = 11;      // Random seed (0-1000)
        this.lastSample = new Float32Array(2); // For stereo output
        this.sampleCount = 0;
        
        // Register processor code
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            
            // Initialize or get processor state
            if (!this.processorState) {
                this.processorState = {
                    lastSample: new Float32Array(parameters.channelCount),
                    sampleCount: 0,
                    lastBE: null,
                    lastBD: null,
                    lastSeed: null,
                    channelBitAmplitudes: null
                };
            }
            
            // Map parameters for clarity
            const { bd: bitDepth, td: tpdfDither, zf: zohFreq, be: bitError, sd: seed, channelCount, blockSize } = parameters;
            
            // Calculate quantization levels based on bit depth: 0 ... (2^bd - 1)
            const levels = Math.pow(2, bitDepth) - 1;
            // Ideal full-scale DAC output (sum of ideal weights): 1 - 0.5^(bitDepth)
            const idealFullScale = 1 - Math.pow(0.5, bitDepth);
            
            const zohRatio = zohFreq / sampleRate;
            
            // Recalculate per-channel bit amplitudes if bitError, bitDepth, seed, or channelCount has changed.
            if (
                !this.processorState.channelBitAmplitudes ||
                this.processorState.lastBE !== bitError ||
                this.processorState.lastBD !== bitDepth ||
                this.processorState.lastSeed !== seed ||
                this.processorState.channelBitAmplitudes.length !== channelCount
            ) {
                this.processorState.channelBitAmplitudes = [];
                const beFactor = bitError / 100; // convert percent to fraction

                // Seeded RNG function (Mulberry32)
                function mulberry32(a) {
                    return function() {
                        var t = a += 0x6D2B79F5;
                        t = Math.imul(t ^ (t >>> 15), t | 1);
                        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                    }
                }
                
                // For each channel, generate an array of bit amplitudes
                for (let ch = 0; ch < channelCount; ch++) {
                    // Use (seed + channel) so that each channel's errors are independent
                    const rng = mulberry32(seed + ch);
                    const amplitudes = [];
                    for (let bit = 0; bit < bitDepth; bit++) {
                        const ideal = Math.pow(0.5, bit + 1); // Ideal weight (MSB: 0.5, then 0.25, etc.)
                        // Compute fixed resistor error for this bit using the seeded RNG
                        const error = (rng() * 2 - 1) * beFactor; // error in [-beFactor, +beFactor]
                        amplitudes.push(ideal * (1 + error));
                    }
                    this.processorState.channelBitAmplitudes.push(amplitudes);
                }
                this.processorState.lastBE = bitError;
                this.processorState.lastBD = bitDepth;
                this.processorState.lastSeed = seed;
            }
            
            // Process each channel and sample
            for (let ch = 0; ch < channelCount; ch++) {
                const offset = ch * blockSize;
                for (let i = 0; i < blockSize; i++) {
                    const currentIndex = this.processorState.sampleCount + i;
                    const sampleIndex = Math.floor(currentIndex * zohRatio);
                    // Apply Zero-Order Hold: reuse sample if still within same ZOH window
                    if (i > 0 && sampleIndex === Math.floor((currentIndex - 1) * zohRatio)) {
                        data[offset + i] = this.processorState.lastSample[ch];
                        continue;
                    }
                    
                    // Get input sample (in [-1, 1]) and convert to [0, 1]
                    const inputSample = data[offset + i];
                    let normalized = (inputSample + 1) / 2;
                    
                    // Scale to quantization levels (0 to levels)
                    let x = normalized * levels;
                    
                    // Apply TPDF dither if enabled
                    if (tpdfDither) {
                        const r1 = Math.random();
                        const r2 = Math.random();
                        x += (r1 - r2);
                    }
                    
                    // Quantize to integer code
                    let code = Math.round(x);
                    
                    // Reconstruct analog value using the channel's bit amplitudes
                    let dacOut = 0;
                    for (let bit = 0; bit < bitDepth; bit++) {
                        // Check bit (MSB first)
                        if (code & (1 << (bitDepth - 1 - bit))) {
                            dacOut += this.processorState.channelBitAmplitudes[ch][bit];
                        }
                    }
                    
                    // Normalize DAC output and convert back to bipolar [-1, 1]
                    const normalizedOut = dacOut / idealFullScale;
                    const outputSample = normalizedOut * 2 - 1;
                    
                    data[offset + i] = outputSample;
                    this.processorState.lastSample[ch] = outputSample;
                }
            }
            
            this.processorState.sampleCount += blockSize;
            return data;
        `);
    }

    setParameters(params) {
        if (params.bd !== undefined) {
            this.bd = Math.max(4, Math.min(24, Math.round(params.bd)));
        }
        if (params.td !== undefined) {
            this.td = params.td;
        }
        if (params.zf !== undefined) {
            this.zf = Math.max(4000, Math.min(96000, Math.round(params.zf / 100) * 100));
        }
        if (params.be !== undefined) {
            // Clamp Bit Error (be) to 0.00 - 10.00% with 0.01% precision
            let newBe = parseFloat(params.be);
            newBe = Math.max(0.00, Math.min(10.00, Math.round(newBe * 100) / 100));
            this.be = newBe;
        }
        if (params.sd !== undefined) {
            // Clamp seed to 0-1000 (integer steps)
            let newSeed = Math.round(params.sd);
            newSeed = Math.max(0, Math.min(1000, newSeed));
            this.sd = newSeed;
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        this.updateParameters();
    }

    // Set bit depth (4-24 bits)
    setBd(value) {
        this.setParameters({ bd: value });
    }

    // Set TPDF dither (true/false)
    setTd(value) {
        this.setParameters({ td: value });
    }

    // Set Zero-Order Hold frequency (4000-96000 Hz)
    setZf(value) {
        this.setParameters({ zf: value });
    }
    
    // Set Bit Error (0.00-10.00%)
    setBe(value) {
        this.setParameters({ be: value });
    }
    
    // Set Seed (0-1000)
    setSeed(value) {
        this.setParameters({ sd: value });
    }

    getParameters() {
        return {
            type: this.constructor.name,
            bd: this.bd,
            td: this.td,
            zf: this.zf,
            be: this.be,
            sd: this.sd,
            enabled: this.enabled
        };
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'bit-crusher-plugin-ui plugin-parameter-ui';

        // Bit Depth control
        const bitDepthLabel = document.createElement('label');
        bitDepthLabel.textContent = 'Bit Depth:';
        const bitDepthSlider = document.createElement('input');
        bitDepthSlider.type = 'range';
        bitDepthSlider.min = 4;
        bitDepthSlider.max = 24;
        bitDepthSlider.step = 1;
        bitDepthSlider.value = this.bd;
        bitDepthSlider.addEventListener('input', (e) => {
            this.setBd(parseInt(e.target.value));
            bitDepthValue.value = e.target.value;
        });
        const bitDepthValue = document.createElement('input');
        bitDepthValue.type = 'number';
        bitDepthValue.min = 4;
        bitDepthValue.max = 24;
        bitDepthValue.step = 1;
        bitDepthValue.value = this.bd;
        bitDepthValue.addEventListener('input', (e) => {
            const value = Math.max(4, Math.min(24, parseInt(e.target.value) || 4));
            this.setBd(value);
            bitDepthSlider.value = value;
            e.target.value = value;
        });

        // TPDF Dither control
        const tpdfLabel = document.createElement('label');
        tpdfLabel.textContent = 'TPDF Dither:';
        const tpdfCheckbox = document.createElement('input');
        tpdfCheckbox.type = 'checkbox';
        tpdfCheckbox.checked = this.td;
        tpdfCheckbox.addEventListener('change', (e) => {
            this.setTd(e.target.checked);
        });

        // ZOH Frequency control
        const zohFreqLabel = document.createElement('label');
        zohFreqLabel.textContent = 'ZOH Frequency (Hz):';
        const zohFreqSlider = document.createElement('input');
        zohFreqSlider.type = 'range';
        zohFreqSlider.min = 4000;
        zohFreqSlider.max = 96000;
        zohFreqSlider.step = 100;
        zohFreqSlider.value = this.zf;
        zohFreqSlider.addEventListener('input', (e) => {
            this.setZf(parseInt(e.target.value));
            zohFreqValue.value = e.target.value;
        });
        const zohFreqValue = document.createElement('input');
        zohFreqValue.type = 'number';
        zohFreqValue.min = 4000;
        zohFreqValue.max = 96000;
        zohFreqValue.step = 100;
        zohFreqValue.value = this.zf;
        zohFreqValue.addEventListener('input', (e) => {
            const value = Math.max(4000, Math.min(96000, parseInt(e.target.value) || 4000));
            this.setZf(value);
            zohFreqSlider.value = value;
            e.target.value = value;
        });

        // Bit Error control
        const beLabel = document.createElement('label');
        beLabel.textContent = 'Bit Error (%):';
        const beSlider = document.createElement('input');
        beSlider.type = 'range';
        beSlider.min = 0;
        beSlider.max = 10;
        beSlider.step = 0.01;
        beSlider.value = this.be;
        beSlider.addEventListener('input', (e) => {
            this.setBe(parseFloat(e.target.value));
            beValue.value = e.target.value;
        });
        const beValue = document.createElement('input');
        beValue.type = 'number';
        beValue.min = 0;
        beValue.max = 10;
        beValue.step = 0.01;
        beValue.value = this.be;
        beValue.addEventListener('input', (e) => {
            const value = Math.max(0, Math.min(10, parseFloat(e.target.value) || 0));
            this.setBe(value);
            beSlider.value = value;
            e.target.value = value;
        });

        // Seed control
        const seedLabel = document.createElement('label');
        seedLabel.textContent = 'Random Seed:';
        const seedSlider = document.createElement('input');
        seedSlider.type = 'range';
        seedSlider.min = 0;
        seedSlider.max = 1000;
        seedSlider.step = 1;
        seedSlider.value = this.sd;
        seedSlider.addEventListener('input', (e) => {
            this.setSeed(parseInt(e.target.value));
            seedValue.value = e.target.value;
        });
        const seedValue = document.createElement('input');
        seedValue.type = 'number';
        seedValue.min = 0;
        seedValue.max = 1000;
        seedValue.step = 1;
        seedValue.value = this.sd;
        seedValue.addEventListener('input', (e) => {
            const value = Math.max(0, Math.min(1000, parseInt(e.target.value) || 0));
            this.setSeed(value);
            seedSlider.value = value;
            e.target.value = value;
        });

        // Assemble UI rows
        const bitDepthRow = document.createElement('div');
        bitDepthRow.className = 'parameter-row';
        bitDepthRow.appendChild(bitDepthLabel);
        bitDepthRow.appendChild(bitDepthSlider);
        bitDepthRow.appendChild(bitDepthValue);
        container.appendChild(bitDepthRow);

        const tpdfRow = document.createElement('div');
        tpdfRow.className = 'parameter-row';
        tpdfRow.appendChild(tpdfLabel);
        tpdfRow.appendChild(tpdfCheckbox);
        container.appendChild(tpdfRow);

        const zohFreqRow = document.createElement('div');
        zohFreqRow.className = 'parameter-row';
        zohFreqRow.appendChild(zohFreqLabel);
        zohFreqRow.appendChild(zohFreqSlider);
        zohFreqRow.appendChild(zohFreqValue);
        container.appendChild(zohFreqRow);
        
        const beRow = document.createElement('div');
        beRow.className = 'parameter-row';
        beRow.appendChild(beLabel);
        beRow.appendChild(beSlider);
        beRow.appendChild(beValue);
        container.appendChild(beRow);

        const seedRow = document.createElement('div');
        seedRow.className = 'parameter-row';
        seedRow.appendChild(seedLabel);
        seedRow.appendChild(seedSlider);
        seedRow.appendChild(seedValue);
        container.appendChild(seedRow);

        return container;
    }
}

// Register the plugin
window.BitCrusherPlugin = BitCrusherPlugin;
