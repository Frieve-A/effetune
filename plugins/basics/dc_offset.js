class DCOffsetPlugin extends PluginBase {
    constructor() {
        super('DC Offset', 'Adds DC offset to the audio signal');
        this.of = 0;  // of: Offset (formerly offset) - Range: -1.0 to 1.0

        // Register processor function
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            // Map shortened parameter names to their original names for clarity
            const { 
                of: offset,    // of: Offset (formerly offset)
                channelCount, blockSize, type 
            } = parameters;
            
            const len = data.length
            for (let i = 0; i < len; i++) {
                data[i] += offset;
            }
            return data;
        `);
    }

    // Set parameters
    setParameters(params) {
        if (params.of !== undefined) {
            this.of = params.of < -1 ? -1 : (params.of > 1 ? 1 : params.of);
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        this.updateParameters();
    }

    // Set DC offset value (-1.0 to 1.0)
    setOf(value) {
        this.setParameters({ of: value });
    }

    getParameters() {
        return {
            type: this.constructor.name,
            of: this.of,
            enabled: this.enabled
        };
    }

    // Create UI elements for the plugin
    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        // Use helper to create DC offset control
        const offsetControl = this.createParameterControl(
            'Offset', -1, 1, 0.01, this.of, 
            (value) => this.setOf(value), '', 'of'
        );
        container.appendChild(offsetControl);

        return container;
    }
}

// Register the plugin
window.DCOffsetPlugin = DCOffsetPlugin;
