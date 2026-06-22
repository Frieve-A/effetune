// IMPORTANT: Do not add individual plugin implementations directly in this file.
// This file contains the core audio processing infrastructure.
// Plugin implementations should be created in their own files under the plugins directory.
// See docs/plugin-development.md for plugin development guidelines.

class PluginProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.plugins = [];
        this.FADE_DURATION = 0.010; // 10ms fade for smoother transitions (Not used in process, but kept for context)
        this.currentFrame = 0;
        this.pluginProcessors = new Map();
        this.pluginContexts = new Map();
        this.processorRegistrationErrors = new Set();
        this.reportedMissingProcessors = new Set();
        this.masterBypass = false;

        // Audio configuration
        this.outputChannelCount = options?.processorOptions?.initialOutputChannelCount ?? 2;
        this.lowLatencyMode = options?.processorOptions?.lowLatencyMode ?? false;

        // Message control
        this.lastMessageTime = 0;
        this.messageQueue = new Map();
        this.MESSAGE_INTERVAL = this.lowLatencyMode ? 8 : 16; // ms

        // Buffer management - blockSize will be updated in process
        this.blockSize = 128; // Default/initial block size
        this.combinedBuffer = null;
        // this.lastChannelCount = 0; // Not used in the provided process function

        // Bus management
        this.busBuffers = new Map(); // Map to store buffers for each bus
        this.MAX_BUSES = 4; // Maximum number of buses (Informational, not directly used in process optimization)

        // Buffer Pool for performance optimization
        this.bufferPool = {
            // Pre-allocated buffers for different use cases
            combined: new Float32Array(8 * 128), // Max 8 channels support
            stereo: new Float32Array(2 * 128),   // Stereo pair processing
            mono: new Float32Array(128),         // Mono channel processing
            mixing: new Float32Array(8 * 128),   // Dedicated buffer for additive mixing operations
            buses: new Map()                     // Bus buffers
        };
        
        // Pre-allocate bus buffers (up to 4 buses)
        for (let i = 0; i < 4; i++) {
            this.bufferPool.buses.set(i, new Float32Array(8 * 128));
        }

        // Offline processing flag (Not used in process, but kept for context)
        // this.isOfflineProcessing = false;

        // Audio level monitoring for sleep mode
        this.audioLevelMonitoring = {
            lastInputActiveTime: 0,     // Last time input signal was detected
            lastOutputActiveTime: 0,    // Last time output signal was detected
            lastUserActivityTime: 0,    // Will be updated from main thread
            isSleepMode: false,
            SILENCE_THRESHOLD: -84,     // -84dB threshold for silence
            SILENCE_DURATION: 60,       // 60 seconds of silence before sleep
            // Cache the threshold in amplitude form
            _silenceThresholdAmplitude: Math.pow(10, -84 / 20)
        };

        // Message handler
        this.port.onmessage = (event) => {
            const data = event.data;
            switch(data.type) {
                case 'updatePlugin':
                    this.updatePlugin(data.plugin);
                    break;
                case 'updatePlugins':
                    // this.isOfflineProcessing = data.isOfflineProcessing ?? false; // Store if needed elsewhere
                    this.masterBypass = data.masterBypass ?? false;
                    this.updatePlugins(data.plugins);
                    break;
                case 'updateAudioConfig':
                    if (data.outputChannels !== undefined) {
                        this.outputChannelCount = data.outputChannels;
                        // Invalidate combined buffer if channel count changes drastically
                        this.combinedBuffer = null;
                        console.log(`Audio config updated: output channels = ${this.outputChannelCount}`);
                    }
                    if (data.lowLatencyMode !== undefined) {
                        this.lowLatencyMode = data.lowLatencyMode;
                        this.MESSAGE_INTERVAL = this.lowLatencyMode ? 8 : 16;
                    }
                    break;
                case 'registerProcessor':
                    this.registerPluginProcessor(data.pluginType, data.processor);
                    break;
                case 'batchUpdatePlugins':
                    this.batchUpdatePlugins(data.plugins || []);
                    break;
                case 'addPlugin':
                    this.addPlugin(data.plugin, data.index);
                    break;
                case 'removePlugin':
                    this.removePlugin(data.pluginId);
                    break;
                case 'reorderPlugin':
                    this.reorderPlugin(data.fromIndex, data.toIndex);
                    break;
                case 'reset':
                    this.plugins = [];
                    this.pluginContexts.clear();
                    this.masterBypass = false;
                    break;
                case 'userActivity':
                    { // Block scope for const time
                        // Use performance.now() or a similar high-resolution timer if available and appropriate
                        // For AudioWorklet, using currentFrame / sampleRate is standard practice.
                        const time = this.currentFrame / globalThis.sampleRate;
                        const monitoring = this.audioLevelMonitoring;
                        monitoring.lastUserActivityTime = time;

                        if (monitoring.isSleepMode) {
                            console.log("User activity detected, exiting sleep mode.");
                            monitoring.isSleepMode = false;
                            this.port.postMessage({
                                type: 'sleepModeChanged',
                                isSleepMode: false
                            });
                        }
                    }
                    break;
                // Add a case to update SILENCE_THRESHOLD dynamically if needed
                case 'updateSilenceThreshold':
                    if (typeof data.threshold === 'number') {
                         this.audioLevelMonitoring.SILENCE_THRESHOLD = data.threshold;
                         this.audioLevelMonitoring._silenceThresholdAmplitude = Math.pow(10, data.threshold / 20);
                    }
                     break;
                case 'setLowLatencyMode':
                    this.lowLatencyMode = !!data.enabled;
                    this.MESSAGE_INTERVAL = this.lowLatencyMode ? 8 : 16;
                    break;
            }
        };
    }

    registerPluginProcessor(pluginType, processorFunction) {
        try {
            // Compile function once during registration
            const compiledFunction = new Function('context', 'data', 'parameters', 'time',
                // Use strict mode for potentially better optimization and error checking
                `'use strict';
                 // Avoid 'with' statement as it's deprecated and hurts performance/optimization
                 // Instead, necessary context properties should be explicitly passed or accessed.
                 // Assuming 'context' holds necessary methods/properties directly.
                 try {
                     // The processor function string is directly embedded here
                     ${processorFunction}
                     // Ensure the function returns the processed data or modifies it in place
                     return data; // Or return modified data if the plugin creates a new buffer
                 } catch (error) {
                     console.error('Error in processor function (${pluginType}):', error);
                     // Return original data on error to prevent chain breakage
                     return data;
                 }`
            );
            this.pluginProcessors.set(pluginType, compiledFunction);
            this.processorRegistrationErrors.delete(pluginType);
            this.reportedMissingProcessors.delete(pluginType);
            // console.log(`Registered processor for type: ${pluginType}`);
        } catch (error) {
             console.error(`Failed to compile processor function for ${pluginType}:`, error);
             this.pluginProcessors.delete(pluginType);
             this.processorRegistrationErrors.add(pluginType);
        }
    }

    normalizePluginConfig(pluginConfig) {
        const params = pluginConfig?.parameters ?? {};
        return {
            ...pluginConfig,
            inputBus: params.inputBus ?? pluginConfig?.inputBus ?? 0,
            outputBus: params.outputBus ?? pluginConfig?.outputBus ?? 0,
            channel: params.channel ?? pluginConfig?.channel ?? null,
        };
    }

    updatePlugin(pluginConfig) {
        if (!pluginConfig) return;
        const index = this.plugins.findIndex(p => p.id === pluginConfig.id);
        if (index !== -1) {
            // Update plugin config - ensure essential properties are correctly nested/accessed
            this.plugins[index] = this.normalizePluginConfig(pluginConfig);

            // console.log(`Updated plugin: ${pluginConfig.id}`);
        } else {
            // console.warn(`Plugin with id ${pluginConfig.id} not found for updating.`);
            // Optionally add the plugin if it's meant to be dynamic
            // this.plugins.push(pluginConfig);
            // this.updatePlugin(pluginConfig); // Re-run to normalize properties
        }
    }

    updatePlugins(pluginConfigs) {
        // Perform a full update, potentially optimizing property access during update
        this.plugins = pluginConfigs.map(p => this.normalizePluginConfig(p));
        // Clear contexts for plugins that might have been removed?
        // Or handle context cleanup based on removed IDs.
        // For simplicity, we keep existing contexts; they won't be used if plugin is gone.
        // console.log(`Updated plugin chain (${this.plugins.length} plugins)`);
    }

    batchUpdatePlugins(pluginConfigs) {
        for (const pluginConfig of pluginConfigs) {
            this.updatePlugin(pluginConfig);
        }
    }

    addPlugin(pluginConfig, index) {
        if (!pluginConfig) return;
        const normalizedPlugin = this.normalizePluginConfig(pluginConfig);
        const existingIndex = this.plugins.findIndex(p => p.id === normalizedPlugin.id);
        if (existingIndex !== -1) {
            this.plugins[existingIndex] = normalizedPlugin;
            return;
        }

        const insertIndex = Number.isInteger(index)
            ? (index < 0 ? 0 : (index > this.plugins.length ? this.plugins.length : index))
            : this.plugins.length;
        this.plugins.splice(insertIndex, 0, normalizedPlugin);
    }

    removePlugin(pluginId) {
        const index = this.plugins.findIndex(p => p.id === pluginId);
        if (index === -1) return;
        this.plugins.splice(index, 1);
        this.pluginContexts.delete(pluginId);
    }

    reorderPlugin(fromIndex, toIndex) {
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
        if (fromIndex < 0 || fromIndex >= this.plugins.length) return;
        const targetIndex = toIndex < 0 ? 0 : (toIndex >= this.plugins.length ? this.plugins.length - 1 : toIndex);
        const [plugin] = this.plugins.splice(fromIndex, 1);
        this.plugins.splice(targetIndex, 0, plugin);
    }

    // Optimized process method
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        // --- 1. Basic Checks & Early Exit ---
        // Check if input/output streams exist and have data
        if (!input || !output || !input[0] || input[0].length === 0) {
            // If input is invalid/empty, zero out output to ensure silence and return.
            if (output && output.length > 0) {
                for (let i = 0; i < output.length; i++) {
                    // Ensure channel exists before filling
                    output[i]?.fill(0);
                }
            }
            // Keep processor alive, even with no input, as input might appear later.
            return true;
        }

        // --- 2. Cache Frequently Accessed Properties & State ---
        const blockSize = input[0].length; // Critical: Block size from actual input buffer
        const currentFrame = this.currentFrame;
        const sampleRate = globalThis.sampleRate; // Standard way to get sample rate in AudioWorklet
        const audioLevelMonitoring = this.audioLevelMonitoring;
        const plugins = this.plugins; // Array of plugin configurations
        const pluginProcessors = this.pluginProcessors; // Map of compiled processor functions
        const pluginContexts = this.pluginContexts; // Map for plugin state/context
        const port = this.port; // For messaging back to the main thread
        const masterBypass = this.masterBypass;
        let isSleepMode = audioLevelMonitoring.isSleepMode; // Cache current sleep state
        // Get configured output channels, default to 2 if not set
        const outputChannelCount = this.outputChannelCount;
        // Use the cached amplitude threshold
        const silenceThresholdAmplitude = audioLevelMonitoring._silenceThresholdAmplitude;


        // --- 3. Calculate Current Time ---
        const time = currentFrame / sampleRate; // Time in seconds

        // --- 4. Input Level Monitoring & Sleep Mode Update ---
        // We treat a channel as silent only if its AC component (peak-to-peak
        // range with the DC offset removed) is below 2 * threshold. This
        // matters because some plugins (e.g. Exciter with a non-zero bias)
        // emit a constant DC component for a silent input, which would
        // otherwise be classified as "signal" and forever prevent sleep mode.
        let hasInputSignal = false;
        const inputChannelsToCheck = Math.min(input.length, outputChannelCount);
        const acThreshold = 2 * silenceThresholdAmplitude;
        for (let channel = 0; channel < inputChannelsToCheck; channel++) {
            const channelData = input[channel];
            let cmin = Infinity, cmax = -Infinity;
            for (let i = 0; i < channelData.length; i++) {
                const v = channelData[i];
                if (v < cmin) cmin = v;
                if (v > cmax) cmax = v;
                if (cmax - cmin > acThreshold) break; // early exit
            }
            if (cmax - cmin > acThreshold) {
                hasInputSignal = true;
                break;
            }
        }

        if (hasInputSignal) {
            audioLevelMonitoring.lastInputActiveTime = time;
            if (isSleepMode) {
                // Exit sleep mode if needed
                isSleepMode = false;
                audioLevelMonitoring.isSleepMode = false;
                port.postMessage({ type: 'sleepModeChanged', isSleepMode: false });
                 console.log(`Input signal detected at ${time}s, exiting sleep mode.`);
            }
        } else {
            // Only check for entering sleep mode if currently NOT sleeping
            if (!isSleepMode) {
                const inputSilenceDuration = time - audioLevelMonitoring.lastInputActiveTime;
                const outputSilenceDuration = time - audioLevelMonitoring.lastOutputActiveTime;
                // Initialize lastUserActivityTime on the first run if it hasn't been set
                if (audioLevelMonitoring.lastUserActivityTime === 0) {
                    audioLevelMonitoring.lastUserActivityTime = time;
                }
                const userInactivityDuration = time - audioLevelMonitoring.lastUserActivityTime;
                const silenceDurationThreshold = audioLevelMonitoring.SILENCE_DURATION;

                // Check if all conditions for sleep are met
                if (inputSilenceDuration >= silenceDurationThreshold &&
                    outputSilenceDuration >= silenceDurationThreshold &&
                    userInactivityDuration >= silenceDurationThreshold)
                {
                    isSleepMode = true;
                    audioLevelMonitoring.isSleepMode = true;
                    port.postMessage({ type: 'sleepModeChanged', isSleepMode: true });
                    console.log(`Entering sleep mode at ${time}s due to inactivity.`);
                }
            }
        }

        // --- 5. Master Bypass or Sleep Mode Handling ---
        if (masterBypass || isSleepMode) {
            const numInputChannels = input.length;
            const numOutputChannels = output.length;
            const channelsToCopy = Math.min(numInputChannels, numOutputChannels);

            // Copy input to output efficiently for matching channels
            for (let channel = 0; channel < channelsToCopy; channel++) {
                // Use Float32Array.prototype.set for fast block copy
                output[channel].set(input[channel]);
            }
            // Zero out any remaining output channels if output has more channels than input
            for (let channel = channelsToCopy; channel < numOutputChannels; channel++) {
                 output[channel].fill(0);
            }

            // IMPORTANT: Still need to advance the frame counter even when bypassed/sleeping
            this.currentFrame += blockSize;
            return true; // Keep processor alive
        }

        // --- 6. Update Processor State ---
        // this.blockSize = blockSize; // Update instance property if it's used elsewhere
        this.currentFrame += blockSize; // Advance frame counter


        // --- 7. Prepare Combined Multichannel Buffer (Optimized with Buffer Pool) ---
        const totalSize = blockSize * outputChannelCount;
        let combinedBuffer;
        
        // Use pre-allocated buffer pool for better performance
        if (outputChannelCount <= 8 && blockSize === 128) {
            // Use pre-allocated buffer from pool
            combinedBuffer = this.bufferPool.combined;
            // Zero out only the portion we'll use
            combinedBuffer.fill(0, 0, totalSize);
        } else {
            // Fallback to dynamic allocation for non-standard sizes
            if (!this.combinedBuffer || this.combinedBuffer.length !== totalSize) {
                this.combinedBuffer = new Float32Array(totalSize);
                console.log(`Reallocated combinedBuffer: ${outputChannelCount} channels, size ${totalSize}`);
            }
            combinedBuffer = this.combinedBuffer;
        }

        // Copy input data (up to 2 channels) to the combined buffer.
        // This assumes a standard stereo input source or taking the first 2 channels.
        const inputChannelsToUse = Math.min(input.length, 2, outputChannelCount);
        for (let i = 0; i < inputChannelsToUse; i++) {
            combinedBuffer.set(input[i], i * blockSize);
        }
        // Zero out remaining channels in the combined buffer if necessary
        if (outputChannelCount > inputChannelsToUse) {
            for (let i = inputChannelsToUse; i < outputChannelCount; i++) {
                // Calculate start and end indices for fill
                const offset = i * blockSize;
                // Use fill for efficiency
                combinedBuffer.fill(0, offset, offset + blockSize);
            }
        }


        // --- 8. Bus Buffer Management ---
        const busBuffers = this.busBuffers; // Local reference
        busBuffers.clear(); // Clear previous buffers

        // Determine which buses are actively used by enabled plugins
        const usedBuses = new Set([0]); // Main bus (0) is implicitly used for input/output
        let activeSectionEnabled = true; // Tracks if the current section is active
        let insideSection = false; // Tracks if currently inside a section definition

        for (const plugin of plugins) {
            // Handle section start/end markers
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                activeSectionEnabled = plugin.enabled; // Section is active if the plugin is enabled
                continue; // Section plugins don't process audio or use buses
            }

            // Skip processing logic for disabled plugins or plugins within a disabled section
            if (!plugin.enabled || (insideSection && !activeSectionEnabled)) {
                continue;
            }

            // Add the input and output buses of this active plugin to the set
            // Access normalized properties directly
            usedBuses.add(plugin.inputBus);
            usedBuses.add(plugin.outputBus);
        }

        // Set the main bus (0) buffer to our prepared combinedBuffer
        busBuffers.set(0, combinedBuffer);

        // Allocate and zero-fill buffers for other used buses (Optimized with Buffer Pool)
        for (const busIndex of usedBuses) {
            if (busIndex !== 0) {
                let busBuffer;
                
                // Use pre-allocated buffer from pool if available
                if (outputChannelCount <= 8 && blockSize === 128 && this.bufferPool.buses.has(busIndex)) {
                    busBuffer = this.bufferPool.buses.get(busIndex);
                    // Zero out only the portion we'll use
                    busBuffer.fill(0, 0, totalSize);
                } else {
                    // Fallback to dynamic allocation for non-standard sizes or bus indices
                    busBuffer = new Float32Array(totalSize);
                }
                
                busBuffers.set(busIndex, busBuffer);
            }
        }

        // --- 9. Process Audio Through Plugins ---
        // Reset section state for the processing loop
        activeSectionEnabled = true;
        insideSection = false;
        let lastMessageTime = this.lastMessageTime; // Cache for message throttling
        const messageQueue = this.messageQueue; // Cache message queue
        const MESSAGE_INTERVAL = this.MESSAGE_INTERVAL; // Cache interval

        for (const plugin of plugins) {
            // Handle section start/end
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                activeSectionEnabled = plugin.enabled;
                continue;
            }

            // Skip disabled or section-disabled plugins
            if (!plugin.enabled || (insideSection && !activeSectionEnabled)) {
                continue;
            }

            // Get the compiled processor function for this plugin type
            const processor = pluginProcessors.get(plugin.type);
            if (!processor) {
                if (!this.reportedMissingProcessors.has(plugin.type)) {
                    this.reportedMissingProcessors.add(plugin.type);
                    console.warn(`Processor function not found for type: ${plugin.type}`);
                    port.postMessage({
                        type: 'processorMissing',
                        pluginId: plugin.id,
                        pluginType: plugin.type
                    });
                }
                for (let ch = 0; ch < output.length; ch++) {
                    output[ch].fill(0);
                }
                this.lastMessageTime = lastMessageTime;
                return true;
            }

            // Get or initialize plugin state/context
            let pluginContext = pluginContexts.get(plugin.id);
            if (!pluginContext) {
                pluginContext = {}; // Initialize empty context
                pluginContexts.set(plugin.id, pluginContext);
            }
            // Prepare the context object for the processor call.
            // Avoid spreading unless necessary; pass specific needed properties.
            // Here, we keep the original structure for compatibility.
            const context = { ...pluginContext, port: port }; // Pass port for potential messaging from plugin


            // Determine input and output buses for this plugin
            const inputBus = plugin.inputBus; // Use normalized property
            const outputBus = plugin.outputBus; // Use normalized property

            // Get the corresponding buffers
            const inputBuffer = busBuffers.get(inputBus);
            const outputBuffer = busBuffers.get(outputBus);

            // Skip if buses are invalid (should not happen if usedBuses logic is correct)
            if (!inputBuffer || !outputBuffer) {
                 console.error(`Invalid bus index for plugin ${plugin.id}: inputBus=${inputBus}, outputBus=${outputBus}`);
                 continue;
            }

            // --- 9a. Channel Processing Logic ---
            const targetChannelSpec = plugin.channel; // Use normalized property (null, "A", "L", "R", "34", etc.)
            let processingBuffer; // The buffer data passed TO the plugin processor
            let resultTargetBuffer; // The buffer where the result should ultimately be written (usually outputBuffer)
            let numProcessingChannels = 0; // How many channels the plugin processor function expects
            let tempBuffer;       // Temporary buffer if needed for isolation/copying
            let processMode = 'skip'; // 'all', 'pair', 'single', 'skip'
            let pairStartChannel = -1; // Starting channel index (0-based) for pairs
            let singleChannelIndex = -1;// Channel index (0-based) for single channel

            // Determine processing mode based on targetChannelSpec
            switch (targetChannelSpec) {
                case 'A': // Process all available channels
                    if (outputChannelCount > 0) {
                        processMode = 'all';
                        numProcessingChannels = outputChannelCount;
                    }
                    break;
                case 'L': // Process Left channel (index 0)
                    if (outputChannelCount > 0) {
                        processMode = 'single';
                        singleChannelIndex = 0;
                        numProcessingChannels = 1;
                    }
                    break;
                case 'R': // Process Right channel (index 1)
                    if (outputChannelCount > 1) {
                        processMode = 'single';
                        singleChannelIndex = 1;
                        numProcessingChannels = 1;
                    }
                    break;
                case null: // Default: process stereo pair (channels 0, 1)
                case undefined:
                    if (outputChannelCount >= 2) {
                        processMode = 'pair';
                        pairStartChannel = 0;
                        numProcessingChannels = 2;
                    }
                    break;
                case '34': // Process pair (channels 2, 3)
                    if (outputChannelCount >= 4) {
                        processMode = 'pair';
                        pairStartChannel = 2;
                        numProcessingChannels = 2;
                    }
                    break;
                case '56': // Process pair (channels 4, 5)
                     if (outputChannelCount >= 6) {
                        processMode = 'pair';
                        pairStartChannel = 4;
                        numProcessingChannels = 2;
                    }
                    break;
                 case '78': // Process pair (channels 6, 7)
                     if (outputChannelCount >= 8) {
                        processMode = 'pair';
                        pairStartChannel = 6;
                        numProcessingChannels = 2;
                    }
                    break;
                default:
                    // Check for specific numeric channel (e.g., "3")
                    const parsedChannel = parseInt(targetChannelSpec, 10);
                    if (!isNaN(parsedChannel) && parsedChannel > 0 && parsedChannel <= outputChannelCount) {
                        processMode = 'single';
                        singleChannelIndex = parsedChannel - 1; // Convert to 0-based index
                        numProcessingChannels = 1;
                    } else {
                        console.warn(`Invalid channel specifier "${targetChannelSpec}" for plugin ${plugin.id}`);
                    }
                    break;
            }

            if (processMode === 'skip') continue; // Skip plugin if channel spec is invalid for current config

            // --- 9b. Prepare Buffers for Plugin Execution ---
             const requiresCopy = (inputBus !== outputBus) || (processMode === 'pair') || (processMode === 'single');

            if (processMode === 'all') {
                if (requiresCopy) {
                    // Use Buffer Pool for all-channel processing when possible (Optimized)
                    if (outputChannelCount <= 8 && blockSize === 128) {
                        // Use pre-allocated buffer from pool
                        tempBuffer = this.bufferPool.combined;
                        // Zero out only the portion we'll use
                        const totalSize = blockSize * outputChannelCount;
                        tempBuffer.fill(0, 0, totalSize);
                        // Copy input data to the buffer
                        tempBuffer.set(inputBuffer.subarray(0, totalSize));
                    } else {
                        // Fallback to dynamic allocation for non-standard sizes
                        tempBuffer = new Float32Array(inputBuffer); // Full copy
                    }
                    processingBuffer = tempBuffer;
                } else {
                    // Process directly in the input/output buffer (which are the same)
                    processingBuffer = inputBuffer; // Reference, no copy
                }
                resultTargetBuffer = outputBuffer; // Result goes directly to the output bus buffer
            } else if (processMode === 'pair') {
                // Use pre-allocated stereo buffer for pair processing (Optimized)
                if (blockSize === 128) {
                    tempBuffer = this.bufferPool.stereo;
                    // Zero out the buffer before use
                    tempBuffer.fill(0);
                } else {
                    // Fallback for non-standard block sizes
                    const stereoSize = blockSize * 2;
                    tempBuffer = new Float32Array(stereoSize);
                }
                // Copy the selected pair from inputBuffer to the temporary stereo buffer efficiently
                tempBuffer.set(inputBuffer.subarray(pairStartChannel * blockSize, (pairStartChannel + 1) * blockSize), 0); // Ch 1
                tempBuffer.set(inputBuffer.subarray((pairStartChannel + 1) * blockSize, (pairStartChannel + 2) * blockSize), blockSize); // Ch 2
                processingBuffer = tempBuffer; // Plugin processes this temp buffer
                // Result will be written back from tempBuffer to the correct place in outputBuffer later
            } else if (processMode === 'single') {
                // Use pre-allocated mono buffer for single channel processing (Optimized)
                if (blockSize === 128) {
                    tempBuffer = this.bufferPool.mono;
                    // Zero out the buffer before use
                    tempBuffer.fill(0);
                } else {
                    // Fallback for non-standard block sizes
                    tempBuffer = new Float32Array(blockSize);
                }
                // Copy the selected channel from inputBuffer to the temporary mono buffer
                tempBuffer.set(inputBuffer.subarray(singleChannelIndex * blockSize, (singleChannelIndex + 1) * blockSize));
                processingBuffer = tempBuffer; // Plugin processes this temp buffer
                 // Result will be written back from tempBuffer later
            }

            // --- 9c. Prepare Parameters for Plugin ---
            const processingParams = {
                ...(plugin.parameters ?? {}), // Include plugin-specific parameters
                id: plugin.id, // Pass plugin ID for context/logging
                channelCount: numProcessingChannels, // Tell plugin how many channels it's getting
                blockSize: blockSize,
                sampleRate: sampleRate
            };

            // --- 9d. Execute Plugin Processor Function ---
            let result; // Can be the modified processingBuffer or a new buffer returned by processor
            try {
                 result = processor.call(context, context, processingBuffer, processingParams, time);
                 // Update context state potentially modified by the processor
                 pluginContexts.set(plugin.id, context);
            } catch(e) {
                 console.error(`Error executing plugin ${plugin.id} (${plugin.type}):`, e);
                 result = processingBuffer; // On error, pass through the original buffer data
            }


             // Determine the actual buffer containing the processed result
             // Plugins might modify `processingBuffer` in-place or return a new buffer instance.
             // Assume modification in-place unless result is a Float32Array.
             const finalResultBuffer = (result instanceof Float32Array) ? result : processingBuffer;

             if (!finalResultBuffer) continue; // Skip if result is invalid

             // --- 9e. Apply Result to Output Bus Buffer ---
             if (inputBus !== outputBus) {
                 // Additive mixing: Add the processed result to the output buffer
                 if (processMode === 'all') {
                     // Optimized: Use dedicated mixing buffer for better performance
                     // Avoid read/write overlap issues with separate mixing buffer
                     if (outputChannelCount <= 8 && blockSize === 128) {
                         // Use dedicated pre-allocated mixing buffer from pool
                         const mixBuffer = this.bufferPool.mixing;
                         // Copy current output state to mixing buffer
                         mixBuffer.set(outputBuffer.subarray(0, totalSize));
                         // Add the processed result using optimized loop
                         for (let i = 0; i < totalSize; i++) {
                             mixBuffer[i] += finalResultBuffer[i];
                         }
                         // Copy mixed result back to output buffer
                         outputBuffer.set(mixBuffer.subarray(0, totalSize));
                     } else {
                         // Fallback for non-standard sizes - direct addition
                         for (let i = 0; i < totalSize; i++) {
                             outputBuffer[i] += finalResultBuffer[i];
                         }
                     }
                 } else if (processMode === 'pair') {
                     const offset1 = pairStartChannel * blockSize;
                     const offset2 = (pairStartChannel + 1) * blockSize;
                     // Optimized: Use subarray views and set() for channel processing
                     const ch1Output = outputBuffer.subarray(offset1, offset1 + blockSize);
                     const ch2Output = outputBuffer.subarray(offset2, offset2 + blockSize);
                     const ch1Input = finalResultBuffer.subarray(0, blockSize);
                     const ch2Input = finalResultBuffer.subarray(blockSize, blockSize * 2);
                     
                     // Add result using optimized loop (vectorizable)
                     for (let i = 0; i < blockSize; i++) {
                         ch1Output[i] += ch1Input[i]; // Add Ch1
                         ch2Output[i] += ch2Input[i]; // Add Ch2
                     }
                 } else if (processMode === 'single') {
                     const offset = singleChannelIndex * blockSize;
                     // Optimized: Use subarray view for better cache efficiency
                     const channelOutput = outputBuffer.subarray(offset, offset + blockSize);
                     
                     // Add result using optimized loop (vectorizable)
                     for (let i = 0; i < blockSize; i++) {
                         channelOutput[i] += finalResultBuffer[i];
                     }
                 }
             } else {
                 // Same input/output bus: Replace content in the output buffer
                 if (processMode === 'all') {
                     // If processing was done in-place (processingBuffer === outputBuffer) and result wasn't a new array,
                     // the outputBuffer is already updated.
                     // If a new buffer was returned by the plugin, copy it back.
                     if (finalResultBuffer !== outputBuffer) {
                         outputBuffer.set(finalResultBuffer);
                     }
                     // If requiresCopy was true (shouldn't be if inputBus === outputBus),
                     // this means tempBuffer was used, so copy finalResultBuffer back.
                     // This logic path needs careful review based on processor guarantees. Assuming direct modification or return.

                 } else if (processMode === 'pair') {
                     // Optimized: Copy the processed stereo pair using subarray views for better performance
                     const ch1Target = outputBuffer.subarray(pairStartChannel * blockSize, (pairStartChannel + 1) * blockSize);
                     const ch2Target = outputBuffer.subarray((pairStartChannel + 1) * blockSize, (pairStartChannel + 2) * blockSize);
                     
                     // Use set() for efficient block copy
                     ch1Target.set(finalResultBuffer.subarray(0, blockSize)); // Ch 1
                     ch2Target.set(finalResultBuffer.subarray(blockSize, blockSize * 2)); // Ch 2
                 } else if (processMode === 'single') {
                     // Optimized: Copy the processed mono channel using subarray view
                     const channelTarget = outputBuffer.subarray(singleChannelIndex * blockSize, (singleChannelIndex + 1) * blockSize);
                     channelTarget.set(finalResultBuffer);
                 }
             }


            // --- 9f. Handle Measurements & Message Throttling ---
            // Check if the plugin's context or result contains measurements
            // Assuming measurements are attached to the context object after processing
            const measurements = result.measurements;
            if (measurements) {
                const currentTimeMs = time * 1000;
                if (currentTimeMs - lastMessageTime >= MESSAGE_INTERVAL) {
                    // Drain queue first
                    if (messageQueue.size > 0) {
                        for (const [pluginId, data] of messageQueue) {
                            port.postMessage({ type: 'processBuffer', pluginId, ...data });
                        }
                        messageQueue.clear();
                    }
                    // Send current message immediately
                    port.postMessage({ type: 'processBuffer', pluginId: plugin.id, measurements });
                    lastMessageTime = currentTimeMs; // Update last sent time
                } else {
                    // Queue the message if interval hasn't passed
                    messageQueue.set(plugin.id, { measurements });
                }
                // Clear measurements from context after handling to avoid re-sending
                result.measurements = null;
                // pluginContexts.set(plugin.id, context); // Ensure context update if not done implicitly
            }
        } // End of plugin processing loop

        // Update the instance's last message time state
        this.lastMessageTime = lastMessageTime;

        // --- 10. Final Output Generation ---
        const mainBusBuffer = busBuffers.get(0); // Get the final state of the main bus

        if (mainBusBuffer) {
            // Determine the number of channels to actually copy to the physical output
            const outputChannelsToWrite = Math.min(output.length, outputChannelCount);

            // Optimization: Clear only the channels we are about to write?
            // Safer: Clear all physical output channels to prevent stale data.
            for (let ch = 0; ch < output.length; ch++) {
                output[ch].fill(0);
            }

            // Copy the processed data from the main bus to the physical output buffers
            for (let ch = 0; ch < outputChannelsToWrite; ch++) {
                const srcOffset = ch * blockSize;
                // Defensive check: ensure source offset is within bounds
                if (srcOffset < mainBusBuffer.length) {
                    // Use subarray and set for efficient block copy
                    output[ch].set(mainBusBuffer.subarray(srcOffset, Math.min(srcOffset + blockSize, mainBusBuffer.length)));
                } else {
                    // This case indicates a mismatch between outputChannelCount and mainBusBuffer size.
                    // Output channel will already be zeroed from the loop above.
                    console.warn(`Source offset ${srcOffset} out of bounds for mainBusBuffer (length ${mainBusBuffer.length}) when writing output channel ${ch}.`);
                }
            }
        } else {
            // Should not happen if bus 0 is always initialized. Fallback: zero out physical output.
            console.error("Main bus (0) buffer not found at the end of processing!");
            for (let ch = 0; ch < output.length; ch++) {
                output[ch].fill(0);
            }
        }


        // --- 11. Output Level Monitoring ---
        // Same AC-only check as input monitoring (see section 4) so that a
        // constant DC offset on the output (e.g. introduced by Exciter with
        // a non-zero bias) does not block sleep mode entry.
        let hasOutputSignal = false;
        const outputChannelsToCheck = Math.min(output.length, outputChannelCount);
        const outAcThreshold = 2 * silenceThresholdAmplitude;
        for (let channel = 0; channel < outputChannelsToCheck; channel++) {
            const channelData = output[channel];
            let cmin = Infinity, cmax = -Infinity;
            for (let i = 0; i < channelData.length; i++) {
                const v = channelData[i];
                if (v < cmin) cmin = v;
                if (v > cmax) cmax = v;
                if (cmax - cmin > outAcThreshold) break; // early exit
            }
            if (cmax - cmin > outAcThreshold) {
                hasOutputSignal = true;
                break;
            }
        }

        // Update last output active time if signal detected
        if (hasOutputSignal) {
            audioLevelMonitoring.lastOutputActiveTime = time;
        }

        // --- 12. Return Status ---
        // Return true to keep the processor alive
        return true;
    }
}

// Ensure the processor is registered with the correct name
try {
    registerProcessor('plugin-processor', PluginProcessor);
} catch (error) {
    console.error("Failed to register PluginProcessor:", error);
    // Fallback or error handling
}
