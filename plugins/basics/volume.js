class VolumePlugin extends PluginBase {
    constructor() {
        super('Volume', 'Adjusts the volume of the audio signal');
        this.vl = 0;  // vl: Volume (formerly volume) - Range: -60 to +24 dB

        // Register processor function
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            // Map shortened parameter names to their original names for clarity
            const { 
                vl: volume,    // vl: Volume (formerly volume)
                channelCount, blockSize, type 
            } = parameters;
            
            const gain = Math.pow(10, volume / 20);
            const len = data.length;
            for (let i = 0; i < len ; i++) {
                data[i] *= gain;
            }
            return data;
        `);
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
            (value) => this.setVl(value), 'dB'
        );
        container.appendChild(volumeControl);
        
        return container;
    }
}

// Register the plugin
window.VolumePlugin = VolumePlugin;
