class VolumePlugin extends PluginBase {
    constructor() {
        super('Volume', 'Adjusts the volume of the audio signal');
        this.temporalCapability = 'stateless';
        this.vl = 0;  // vl: Volume (formerly volume) - Range: -60 to +24 dB

        // Register processor function
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            // Map shortened parameter names to their original names for clarity
            const { 
                vl: volume,    // vl: Volume (formerly volume)
                channelCount, blockSize, type 
            } = parameters;
            
            const targetGain = Math.pow(10, volume / 20);
            const rampFrames = Math.max(1, Math.ceil(parameters.sampleRate * 0.005));
            if (context.currentGain === undefined) {
                context.currentGain = targetGain;
                context.targetGain = targetGain;
                context.gainStep = 0;
                context.rampRemaining = 0;
            } else if (context.targetGain !== targetGain) {
                context.targetGain = targetGain;
                context.gainStep = (targetGain - context.currentGain) / rampFrames;
                context.rampRemaining = rampFrames;
            }
            for (let frame = 0; frame < blockSize; frame++) {
                if (context.rampRemaining > 0) {
                    context.currentGain += context.gainStep;
                    if (--context.rampRemaining === 0) context.currentGain = context.targetGain;
                }
                for (let channel = 0; channel < channelCount; channel++) {
                    const index = channel * blockSize + frame;
                    data[index] *= context.currentGain;
                }
            }
            return data;
        `);
    }

    getPowerGainUpperBoundDb() {
        return this.vl;
    }

    // Set parameters
    setParameters(params) {
        if (params.vl !== undefined) {
            this.vl = this.parseFiniteNumber(params.vl, -60, 24, this.vl);
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        this.updateParameters();
    }

    // Set volume level (-60 to +24 dB)
    setVl(db) {
        this.setParameters({ vl: db });
    }

    getParameters() {
        return {
            type: this.constructor.name,
            vl: this.vl,
            enabled: this.enabled
        };
    }

    // Create UI elements for the plugin
    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        // Use helper to create volume control
        const volumeControl = this.createParameterControl(
            'Volume', -60, 24, 0.1, this.vl, 
            (value) => this.setVl(value), 'dB', 'vl'
        );
        container.appendChild(volumeControl);
        
        return container;
    }
}

// Register the plugin
window.VolumePlugin = VolumePlugin;
