// IMPORTANT: Do not add individual plugin implementations directly in this file.
// This file contains the core audio processing infrastructure.
// Plugin implementations should be created in their own files under the plugins directory.
// See docs/plugin-development.md for plugin development guidelines.

class PluginProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.plugins = [];
        this.fadeStates = new Map();
        this.FADE_DURATION = 0.010; // 10ms fade for smoother transitions
        this.currentFrame = 0;
        this.pluginProcessors = new Map();
        this.pluginContexts = new Map();
        this.masterBypass = false;
        
        // Message control
        this.lastMessageTime = 0;
        this.messageQueue = new Map();
        this.MESSAGE_INTERVAL = 16;

        // Buffer management
        this.blockSize = 128;
        this.combinedBuffer = null;
        this.lastChannelCount = 0;
        
        // Offline processing flag
        this.isOfflineProcessing = false;
        
        // Message handler for plugin updates and processor registration
        this.port.onmessage = (event) => {
            const data = event.data;
            switch(data.type) {
                case 'updatePlugin':
                    this.updatePlugin(data.plugin);
                    break;
                case 'updatePlugins':
                    this.isOfflineProcessing = data.isOfflineProcessing || false;
                    this.masterBypass = data.masterBypass || false;
                    this.updatePlugins(data.plugins);
                    break;
                case 'registerProcessor':
                    this.registerPluginProcessor(data.pluginType, data.processor);
                    break;
            }
        };
    }

    registerPluginProcessor(pluginType, processorFunction) {
        // Compile processor function with provided context
        const compiledFunction = new Function('context', 'data', 'parameters', 'time',
            `with (context) {
                try {
                    if (parameters.channelCount < 1) {
                        console.error('Invalid channel count');
                        return data;
                    }
                    if (data.length !== parameters.channelCount * parameters.blockSize) {
                        console.error('Buffer size mismatch');
                        return data;
                    }
                    ${processorFunction}
                } catch (error) {
                    console.error('Error in processor function:', error);
                    return data;
                }
            }`
        );
        this.pluginProcessors.set(pluginType, compiledFunction);
    }

    updatePlugin(pluginConfig) {
        const index = this.plugins.findIndex(p => p.id === pluginConfig.id);
        if (index !== -1) {
            this.plugins[index] = pluginConfig;
        }
    }

    updatePlugins(pluginConfigs) {
        this.plugins = pluginConfigs;
        for (const plugin of this.plugins) {
            if (!this.fadeStates.has(plugin.id)) {
                this.fadeStates.set(plugin.id, {
                    prevValue: null,
                    targetValue: null,
                    startTime: 0
                });
            }
        }
    }

    getFadeValue(pluginId, currentValue, time) {
        let fadeState = this.fadeStates.get(pluginId);
        if (!fadeState) {
            fadeState = {
                prevValue: currentValue,
                targetValue: currentValue,
                startTime: time
            };
            this.fadeStates.set(pluginId, fadeState);
            return currentValue;
        }
        if (fadeState.prevValue === null) {
            fadeState.prevValue = currentValue;
            fadeState.targetValue = currentValue;
        } else if (fadeState.targetValue !== currentValue) {
            fadeState.prevValue = fadeState.targetValue;
            fadeState.targetValue = currentValue;
            fadeState.startTime = time;
        }
        const fadeProgress = Math.min(1, (time - fadeState.startTime) / this.FADE_DURATION);
        return fadeState.prevValue + (fadeState.targetValue - fadeState.prevValue) * fadeProgress;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output) return true;

        // Master bypass: copy input directly to output
        if (this.masterBypass) {
            for (let channel = 0; channel < input.length; channel++) {
                output[channel].set(input[channel]);
            }
            return true;
        }

        if (!input[0]) {
            console.warn('Audio processor: Input channel data is missing');
            return true;
        }

        // Update block size from input buffer length
        this.blockSize = input[0].length;
        const time = this.currentFrame / sampleRate;
        this.currentFrame += this.blockSize;

        const channelCount = input.length;
        const requiredSize = this.blockSize * channelCount;
        if (!this.combinedBuffer || this.lastChannelCount !== channelCount || this.combinedBuffer.length !== requiredSize) {
            this.combinedBuffer = new Float32Array(requiredSize);
            this.lastChannelCount = channelCount;
        }
        
        // Copy input data to combined buffer
        for (let i = 0; i < channelCount; i++) {
            this.combinedBuffer.set(input[i], i * this.blockSize);
        }

        // Process through all plugins in order
        for (const plugin of this.plugins) {
            const processor = this.pluginProcessors.get(plugin.type);
            if (!processor) continue;
            // Get or initialize plugin context
            if (!this.pluginContexts.has(plugin.id)) {
                this.pluginContexts.set(plugin.id, {});
            }
            const pluginContext = this.pluginContexts.get(plugin.id);
            const context = {
                ...pluginContext,
                fadeStates: this.fadeStates,
                port: this.port,
                getFadeValue: (pluginId, value, time) => this.getFadeValue(pluginId, value, time)
            };
            this.pluginContexts.set(plugin.id, context);

            const params = {
                ...plugin.parameters,
                id: plugin.id,
                channelCount: channelCount,
                blockSize: this.blockSize,
                sampleRate: sampleRate
            };

            const result = processor.call(null, context, this.combinedBuffer, params, time);
            if (result && result.length === this.combinedBuffer.length) {
                this.combinedBuffer.set(result);
            }

            // Message sending control
            const currentTime = (this.currentFrame / sampleRate) * 1000; // ms
            if (result && result.measurements) {
                if (currentTime - this.lastMessageTime >= this.MESSAGE_INTERVAL) {
                    for (const [pluginId, data] of this.messageQueue) {
                        this.port.postMessage({
                            type: 'processBuffer',
                            pluginId: pluginId,
                            ...data
                        });
                    }
                    this.messageQueue.clear();
                    this.port.postMessage({
                        type: 'processBuffer',
                        pluginId: plugin.id,
                        buffer: result,
                        measurements: result.measurements
                    });
                    this.lastMessageTime = currentTime;
                } else {
                    this.messageQueue.set(plugin.id, {
                        buffer: result,
                        measurements: result.measurements
                    });
                }
            }
        }

        // Copy final combined buffer to output channels
        for (let i = 0; i < channelCount; i++) {
            output[i].set(this.combinedBuffer.subarray(i * this.blockSize, (i + 1) * this.blockSize));
        }
        return true;
    }
}

registerProcessor('plugin-processor', PluginProcessor);
