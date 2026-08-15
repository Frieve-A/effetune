class CrossfeedFilterPlugin extends PluginBase {
    constructor() {
        super('Crossfeed Filter', 'Headphone crossfeed filter for natural stereo imaging');

        // Initialize parameters with defaults
        this.lv = -6;      // Level (dB) - Range: -60 to 0
        this.dl = 0.3;     // Delay (ms) - Range: 0 to 1
        this.lf = 700;     // LPF Freq (Hz) - Range: 100 to 20000

        // Register processor function
        this.registerProcessor(`
            // Skip processing if disabled
            if (!parameters.enabled) return data;

            const channelCount = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate;
            
            // Only process stereo signals
            if (channelCount !== 2) return data;
            
            // Initialize context state if needed
            if (!context.initialized || context.sampleRate !== sampleRate) {
                context.sampleRate = sampleRate;
                
                // Initialize delay buffers for left and right channels
                const maxDelaySamples = Math.ceil(sampleRate * 0.001) + 1;
                context.delayBufferL = new Float32Array(maxDelaySamples);
                context.delayBufferR = new Float32Array(maxDelaySamples);
                context.delayPos = 0;
                context.delayCurrent = Math.min(maxDelaySamples - 1,
                    Math.max(0, Math.floor(parameters.dl * sampleRate / 1000)));
                context.delayTarget = context.delayCurrent;
                context.delayStep = 0;
                context.delayRemaining = 0;
                
                // Initialize LPF states
                context.lpfStateL = 0;
                context.lpfStateR = 0;
                
                context.initialized = true;
            }

            // Pre-calculate coefficients
            const levelGain = Math.pow(10, parameters.lv / 20);
            const delayTarget = Math.min(context.delayBufferL.length - 1,
                Math.max(0, Math.floor(parameters.dl * sampleRate / 1000)));
            if (delayTarget !== context.delayTarget) {
                const frames = Math.max(1, Math.ceil(sampleRate * 0.005));
                context.delayTarget = delayTarget;
                context.delayStep = (delayTarget - context.delayCurrent) / frames;
                context.delayRemaining = frames;
            }
            
            // LPF coefficient
            const lpfFreq = parameters.lf;
            const lpfCoeff = Math.exp(-2 * Math.PI * lpfFreq / sampleRate);
            
            // Auto-level adjustment: Normalize to prevent clipping (New addition)
            const normalizeGain = 1 / (1 + levelGain);
            
            // Process stereo channels
            const leftOffset = 0;
            const rightOffset = blockSize;
            const size = context.delayBufferL.length;
            
            for (let i = 0; i < blockSize; i++) {
                const leftInput = data[leftOffset + i];
                const rightInput = data[rightOffset + i];
                
                context.delayBufferL[context.delayPos] = leftInput;
                context.delayBufferR[context.delayPos] = rightInput;
                
                const elapsed = Math.min(i + 1, context.delayRemaining);
                const delaySamples = context.delayCurrent + context.delayStep * elapsed;
                let read = context.delayPos - delaySamples;
                while (read < 0) read += size;
                const first = Math.floor(read) % size;
                const second = first + 1 === size ? 0 : first + 1;
                const fraction = read - Math.floor(read);
                const delayedLeft = context.delayBufferL[first] +
                    fraction * (context.delayBufferL[second] - context.delayBufferL[first]);
                const delayedRight = context.delayBufferR[first] +
                    fraction * (context.delayBufferR[second] - context.delayBufferR[first]);
                
                context.delayPos = (context.delayPos + 1) % size;
                
                context.lpfStateL = (1 - lpfCoeff) * delayedLeft + lpfCoeff * context.lpfStateL;
                context.lpfStateR = (1 - lpfCoeff) * delayedRight + lpfCoeff * context.lpfStateR;
                
                let leftOutput = leftInput + context.lpfStateR * levelGain;
                let rightOutput = rightInput + context.lpfStateL * levelGain;
                
                // Apply normalization (New addition)
                leftOutput *= normalizeGain;
                rightOutput *= normalizeGain;
                
                data[leftOffset + i] = leftOutput;
                data[rightOffset + i] = rightOutput;
            }

            if (blockSize >= context.delayRemaining) {
                context.delayCurrent = context.delayTarget;
                context.delayStep = 0;
                context.delayRemaining = 0;
            } else {
                context.delayCurrent += context.delayStep * blockSize;
                context.delayRemaining -= blockSize;
            }

            return data;
        `);
    }

    // Get current parameters
    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            lv: this.lv,    // Level
            dl: this.dl,    // Delay
            lf: this.lf     // LPF Freq
        };
    }

    // Set parameters with validation
    setParameters(params) {
        if (params.lv !== undefined) {
            const value = typeof params.lv === 'number' ? params.lv : parseFloat(params.lv);
            if (!isNaN(value)) {
                this.lv = Math.max(-60, Math.min(0, value));
            }
        }
        if (params.dl !== undefined) {
            const value = typeof params.dl === 'number' ? params.dl : parseFloat(params.dl);
            if (!isNaN(value)) {
                this.dl = Math.max(0, Math.min(1, value));
            }
        }
        if (params.lf !== undefined) {
            const value = typeof params.lf === 'number' ? params.lf : parseFloat(params.lf);
            if (!isNaN(value)) {
                this.lf = Math.max(100, Math.min(20000, value));
            }
        }
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        // Use the base class createParameterControl helper
        container.appendChild(this.createParameterControl('Level', -60, 0, 0.1, this.lv, (value) => this.setParameters({ lv: value }), 'dB'));
        container.appendChild(this.createParameterControl('Delay', 0, 1, 0.01, this.dl, (value) => this.setParameters({ dl: value }), 'ms'));
        container.appendChild(this.createParameterControl('LPF Freq', 100, 20000, 100, this.lf, (value) => this.setParameters({ lf: value }), 'Hz'));

        return container;
    }
}

// Register the plugin globally
window.CrossfeedFilterPlugin = CrossfeedFilterPlugin;
