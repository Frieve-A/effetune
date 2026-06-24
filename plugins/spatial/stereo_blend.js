class StereoBlendPlugin extends PluginBase {
    constructor() {
        super('Stereo Blend', 'Stereo width control for natural sound field adjustment');
        
        // Initialize parameters
        this.stereo = 60;  // stereo: Stereo width (-200-200%)
        // Common use cases:
        // - 60-90%: Reduce stereo width for more natural headphone listening
        // - 100%: Original stereo image (neutral)
        // - 110-130%: Enhance stereo separation for speaker listening

        // Register the audio processing function
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            if (parameters.channelCount < 2) return data; // Only process stereo signals

            // Pre-calculate all constants for efficiency
            const { 
                stereo,    // Stereo width percentage
                channelCount, blockSize 
            } = parameters;
            
            // Use original data directly
            const tempBuffer = data;

            // 0%: Full mono
            // 60-90%: Reduced width for headphone listening (more natural soundstage)
            // 100%: Original stereo image
            // 110-130%: Enhanced stereo for speaker listening
            // 200%: Maximum stereo width (use with caution)
            const sideGain = stereo / 100;

            const rightOffset = blockSize;
            
            // Process both channels
            for (let i = 0; i < blockSize; i++) {
                const leftSample = tempBuffer[i];
                const rightSample = tempBuffer[rightOffset + i];
                
                // Calculate mid/side components
                const mid = (leftSample + rightSample) * 0.5;
                const side = (leftSample - rightSample) * 0.5;
                
                // Apply side gain
                const scaledSide = side * sideGain;
                
                // Reconstruct stereo
                data[i] = mid + scaledSide;
                data[rightOffset + i] = mid - scaledSide;
            }

            return data;
        `);
    }

    // Get current parameters
    getParameters() {
        return {
            type: this.constructor.name,
            stereo: this.stereo,
            enabled: this.enabled
        };
    }

    // Set parameters
    setParameters(params) {
        if (params.stereo !== undefined) {
            this.stereo = params.stereo < -200 ? -200 : (params.stereo > 200 ? 200 : params.stereo);
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        this.updateParameters();
    }

    // Set stereo width percentage (-200-200%)
    setStereo(value) {
        this.setParameters({ stereo: value });
    }

    // Create UI elements
    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        // Use base helper for Stereo width control
        container.appendChild(this.createParameterControl(
            'Stereo', -200, 200, 1, this.stereo,
            this.setStereo.bind(this), '%'
        ));

        return container;
    }
}

// Register the plugin globally
window.StereoBlendPlugin = StereoBlendPlugin;
