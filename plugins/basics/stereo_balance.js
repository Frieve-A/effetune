class StereoBalancePlugin extends PluginBase {
    constructor() {
        super('Stereo Balance', 'Adjusts the balance between left and right channels');
        this.bl = 0;  // bl: Balance (formerly balance) - -1 (full left) to +1 (full right), 0 is center

        // Register processor function
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            if (parameters.channelCount < 2) return data; // Only process stereo signals
            
            // Map shortened parameter names to their original names for clarity
            const { 
                bl: balance,    // bl: Balance (formerly balance)
                channelCount, blockSize, type 
            } = parameters;
            
            // Process left and right channels
            const targetBalance = Math.fround(balance);
            const rampFrames = Math.max(1, Math.ceil(parameters.sampleRate * 0.005));
            if (context.currentBalance === undefined) {
                context.currentBalance = targetBalance;
                context.targetBalance = targetBalance;
                context.rampRemaining = 0;
            } else if (context.targetBalance !== targetBalance) {
                context.targetBalance = targetBalance;
                context.balanceStep = (targetBalance - context.currentBalance) / rampFrames;
                context.rampRemaining = rampFrames;
            }

            // Channels are stereo pairs: even index = left, odd index = right
            for (let i = 0; i < blockSize; i++) {
                if (context.rampRemaining > 0) {
                    context.currentBalance += context.balanceStep;
                    if (--context.rampRemaining === 0) context.currentBalance = context.targetBalance;
                }
                const leftGain = context.currentBalance <= 0 ? 1 : 1 - context.currentBalance;
                const rightGain = context.currentBalance >= 0 ? 1 : 1 + context.currentBalance;
                for (let ch = 0; ch < channelCount; ch++) {
                    const gain = (ch & 1) === 0 ? leftGain : rightGain;
                    data[ch * blockSize + i] *= gain;
                }
            }

            return data;
        `);
    }

    // Set parameters
    setParameters(params) {
        if (params.bl !== undefined) {
            this.bl = params.bl < -1 ? -1 : (params.bl > 1 ? 1 : params.bl);
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        this.updateParameters();
    }

    // Set balance value (-1 to +1)
    setBl(value) {
        this.setParameters({ bl: value });
    }

    getParameters() {
        return {
            type: this.constructor.name,
            bl: this.bl,
            enabled: this.enabled
        };
    }

    // Create UI elements for the plugin
    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        // Use helper to create balance control
        const balanceControl = this.createParameterControl(
            'Balance', -100, 100, 1, this.bl * 100, 
            (value) => this.setBl(value / 100), '%' // Divide by 100 in setter
        );
        container.appendChild(balanceControl);
        
        return container;
    }
}

// Register the plugin
window.StereoBalancePlugin = StereoBalancePlugin;
