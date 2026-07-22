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

            if (!this.processorState.lastSample || this.processorState.lastSample.length !== channelCount) {
                const previousLastSample = this.processorState.lastSample;
                const resizedLastSample = new Float32Array(channelCount);
                if (previousLastSample) {
                    const copyCount = previousLastSample.length < channelCount ? previousLastSample.length : channelCount;
                    for (let ch = 0; ch < copyCount; ch++) {
                        resizedLastSample[ch] = previousLastSample[ch];
                    }
                }
                this.processorState.lastSample = resizedLastSample;
            }
            
            // Calculate quantization levels based on bit depth: 0 ... (2^bd - 1)
            const levels = Math.pow(2, bitDepth) - 1;
            // Ideal full-scale DAC output (sum of ideal weights): 1 - 0.5^(bitDepth)
            const idealFullScale = 1 - Math.pow(0.5, bitDepth);
            
            const zohRatio = zohFreq / parameters.sampleRate;
            
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
            
            // Process samples in time order so shared dither RNG consumption is block-size invariant
            for (let i = 0; i < blockSize; i++) {
                const currentIndex = this.processorState.sampleCount + i;
                const sampleIndex = Math.floor(currentIndex * zohRatio);
                const reuseLastSample = sampleIndex === Math.floor((currentIndex - 1) * zohRatio);
                for (let ch = 0; ch < channelCount; ch++) {
                    const offset = ch * blockSize;
                    // Apply Zero-Order Hold: reuse sample if still within same ZOH window
                    if (reuseLastSample) {
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
                    if (code < 0) {
                        code = 0;
                    } else if (code > levels) {
                        code = levels;
                    }
                    
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
            const rounded = Math.round(this.parseFiniteNumber(params.bd, 4, 24, this.bd));
            this.bd = rounded < 4 ? 4 : (rounded > 24 ? 24 : rounded);
        }
        if (params.td !== undefined) {
            this.td = this.isAllowedEnum(params.td, [true, false], this.td);
        }
        if (params.zf !== undefined) {
            const value = this.parseFiniteNumber(params.zf, 4000, 96000, this.zf);
            const rounded = Math.round(value / 100) * 100;
            this.zf = rounded < 4000 ? 4000 : (rounded > 96000 ? 96000 : rounded);
        }
        if (params.be !== undefined) {
            // Clamp Bit Error (be) to 0.00 - 10.00% with 0.01% precision
            const newBe = this.parseFiniteNumber(params.be, 0.00, 10.00, this.be);
            const rounded = Math.round(newBe * 100) / 100;
            this.be = rounded < 0.00 ? 0.00 : (rounded > 10.00 ? 10.00 : rounded);
        }
        if (params.sd !== undefined) {
            // Clamp seed to 0-1000 (integer steps)
            const newSeed = Math.round(this.parseFiniteNumber(params.sd, 0, 1000, this.sd));
            this.sd = newSeed < 0 ? 0 : (newSeed > 1000 ? 1000 : newSeed);
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

        // Use helper for Bit Depth control
        container.appendChild(this.createParameterControl(
            'Bit Depth', 4, 24, 1, this.bd, 
            (value) => this.setBd(value), ''
        ));

        // TPDF Dither control (keep checkbox)
        const tpdfRow = document.createElement('div');
        tpdfRow.className = 'parameter-row';
        const tpdfLabel = document.createElement('label');
        tpdfLabel.textContent = 'TPDF Dither:';
        const tpdfCheckboxId = `${this.id}-${this.name}-tpdf-dither`;
        tpdfLabel.htmlFor = tpdfCheckboxId;
        const tpdfCheckbox = document.createElement('input');
        tpdfCheckbox.type = 'checkbox';
        tpdfCheckbox.id = tpdfCheckboxId;
        tpdfCheckbox.name = tpdfCheckboxId;
        tpdfCheckbox.checked = this.td;
        tpdfCheckbox.autocomplete = "off";
        tpdfCheckbox.addEventListener('change', (e) => {
            this.setTd(e.target.checked);
        });
        tpdfRow.appendChild(tpdfLabel);
        tpdfRow.appendChild(tpdfCheckbox);
        container.appendChild(tpdfRow);

        // Use helper for ZOH Frequency control
        container.appendChild(this.createParameterControl(
            'ZOH Frequency', 4000, 96000, 100, this.zf, 
            (value) => this.setZf(value), 'Hz'
        ));
        
        // Use helper for Bit Error control
        container.appendChild(this.createParameterControl(
            'Bit Error', 0, 10, 0.01, this.be, 
            (value) => this.setBe(value), '%'
        ));

        // Use helper for Seed control
        container.appendChild(this.createParameterControl(
            'Random Seed', 0, 1000, 1, this.sd, 
            (value) => this.setSeed(value), ''
        ));

        return container;
    }
}

// Register the plugin
window.BitCrusherPlugin = BitCrusherPlugin;
