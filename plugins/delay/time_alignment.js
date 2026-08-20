class TimeAlignmentPlugin extends PluginBase {
    constructor() {
        super('Time Alignment', 'Time alignment effect');

        // Maximum delay time in milliseconds
        this.maxDelayTime = 100;

        // Initialize parameters
        this.dl = 0.00;  // dl: Delay (formerly delay) - 0 to 100 ms

        this.lastProcessTime = performance.now() / 1000;

        // Initialize delay buffers in the processor
        this.registerProcessor(`
            if (!parameters.enabled) return data;

            // Define max delay time constant (ms)
            const maxDelayTime = 100;

            const maxDelaySamplesRaw = Math.ceil(parameters.sampleRate * maxDelayTime * 0.001);
            const maxDelaySamples = maxDelaySamplesRaw > 0 ? maxDelaySamplesRaw : 1;

            // Initialize delay buffers if needed
            if (!context.delayBuffers ||
                context.delayBuffers.length !== parameters.channelCount ||
                context.sampleRate !== parameters.sampleRate ||
                context.maxDelaySamples !== maxDelaySamples) {
                context.delayBuffers = Array.from({ length: parameters.channelCount }, () => new Float32Array(maxDelaySamples));
                context.delayIndices = Array.from({ length: parameters.channelCount }, () => 0);
                context.sampleRate = parameters.sampleRate;
                context.maxDelaySamples = maxDelaySamples;
                context.currentDelaySamples = undefined;
            }

            // Retarget a short fractional-delay ramp. Adjacent reads form a bounded two-tap fade.
            const rawDelaySamples = Math.fround(parameters.dl) * parameters.sampleRate / 1000;
            const targetDelaySamples = rawDelaySamples < 0 ? 0 : (rawDelaySamples > maxDelaySamples ? maxDelaySamples : rawDelaySamples);
            const rampFrames = Math.max(1, Math.ceil(parameters.sampleRate * 0.005));
            if (context.currentDelaySamples === undefined) {
                context.currentDelaySamples = context.targetDelaySamples = targetDelaySamples;
                context.delayStep = 0;
                context.delayRampRemaining = 0;
            } else if (context.targetDelaySamples !== targetDelaySamples) {
                context.targetDelaySamples = targetDelaySamples;
                context.delayStep = (targetDelaySamples - context.currentDelaySamples) / rampFrames;
                context.delayRampRemaining = rampFrames;
            }

            // Always process all channels
            for (let ch = 0; ch < parameters.channelCount; ch++) {
                const offset = ch * parameters.blockSize;
                const delayBuffer = context.delayBuffers[ch];
                let writeIndex = context.delayIndices[ch];

                for (let i = 0; i < parameters.blockSize; i++) {
                    const currentSample = data[offset + i];
                    const progressed = Math.min(i + 1, context.delayRampRemaining);
                    const delaySamples = context.delayRampRemaining === 0 ? context.currentDelaySamples :
                        (progressed === context.delayRampRemaining && i + 1 >= context.delayRampRemaining ?
                            context.targetDelaySamples : context.currentDelaySamples + context.delayStep * progressed);
                    const lower = Math.floor(delaySamples);
                    const fraction = delaySamples - lower;
                    const lowerSample = lower === 0 ? currentSample :
                        delayBuffer[(writeIndex + delayBuffer.length - lower) % delayBuffer.length];
                    const upperSample = fraction === 0 || lower >= maxDelaySamples ? lowerSample :
                        delayBuffer[(writeIndex + delayBuffer.length - lower - 1) % delayBuffer.length];
                    data[offset + i] = lowerSample + (upperSample - lowerSample) * fraction;
                    delayBuffer[writeIndex] = currentSample;
                    writeIndex = (writeIndex + 1) % delayBuffer.length;
                }
                // Save updated write index for next block processing
                context.delayIndices[ch] = writeIndex;
            }

            const advanced = Math.min(parameters.blockSize, context.delayRampRemaining);
            context.currentDelaySamples += context.delayStep * advanced;
            context.delayRampRemaining -= advanced;
            if (context.delayRampRemaining === 0) context.currentDelaySamples = context.targetDelaySamples;

            return data;
        `);
    }

    setParameters(params) {
        // Map shortened parameter names to their original names for clarity
        const { 
            dl: delay,  // dl: Delay (formerly delay)
        } = params;

        // Update delay parameter with type checking
        if (delay !== undefined) {
            const value = typeof delay === 'number' ? delay : parseFloat(delay);
            if (!isNaN(value)) {
                this.dl = value < 0 ? 0 : (value > this.maxDelayTime ? this.maxDelayTime : value);
            }
        }

        if (params.enabled !== undefined) this.enabled = params.enabled;

        this.updateParameters();
    }

    // Parameter setters
    setDelay(value) { this.setParameters({ dl: value }); }

    getParameters() {
        return {
            type: this.constructor.name,
            dl: this.dl,
            enabled: this.enabled
        };
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'time-alignment-plugin-ui plugin-parameter-ui';

        // Use helper to create delay control
        const delayControl = this.createParameterControl(
            'Delay', 0, this.maxDelayTime, 0.01, this.dl,
            (value) => this.setDelay(value), 'ms', 'dl'
        );
        container.appendChild(delayControl);

        return container;
    }
}

window.TimeAlignmentPlugin = TimeAlignmentPlugin;
