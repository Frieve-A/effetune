/**
 * OfflineProcessor - Handles offline audio processing
 */
export class OfflineProcessor {
    /**
     * Create a new OfflineProcessor instance
     * @param {Object} contextManager - Reference to the AudioContextManager
     * @param {Object} audioEncoder - Reference to the AudioEncoder
     */
    constructor(contextManager, audioEncoder) {
        this.contextManager = contextManager;
        this.audioEncoder = audioEncoder;
        this.offlineContext = null;
        this.offlineWorkletNode = null;
        this.isOfflineProcessing = false;
        this.isCancelled = false;
    }
    
    /**
     * Process an audio file offline
     * @param {File} file - The audio file to process
     * @param {Array} pipeline - Array of plugin instances
     * @param {Function} progressCallback - Callback for progress updates
     * @returns {Promise<Blob>} - Processed audio as a WAV blob
     */
    async processAudioFile(file, pipeline, progressCallback = null) {
        this.isOfflineProcessing = true;
        this.isCancelled = false;
        try {
            // Read file as ArrayBuffer and decode audio data
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.contextManager.audioContext.decodeAudioData(arrayBuffer);

            // Check if there are any enabled plugins
            const hasEnabledPlugins = pipeline.some(plugin => 
                plugin.constructor.name !== 'SectionPlugin' && plugin.enabled
            );
            
            if (!hasEnabledPlugins) {
                return this.audioEncoder.encodeWAV(audioBuffer);
            }

            // Define the actual output channel count - may be higher than the file's channel count
            const { numberOfChannels, length: totalSamples, sampleRate } = audioBuffer;
            const outputChannelCount = this.getOfflineOutputChannelCount(numberOfChannels);
            
            // Create offline context for final rendering
            this.offlineContext = this.contextManager.createOfflineContext(
                outputChannelCount,
                totalSamples,
                sampleRate
            );
            
            // Store reference to pipeline for processing
            this.pipeline = pipeline;

            const BLOCK_SIZE = 128;
            // Create buffer for processed audio
            const processedBuffer = this.offlineContext.createBuffer(outputChannelCount, totalSamples, sampleRate);

            // Map to hold plugin-specific processing contexts
            const pluginContexts = new Map();
            const createContext = (pluginId) => {
                if (!pluginContexts.has(pluginId)) {
                    pluginContexts.set(pluginId, {
                        sampleRate,
                        currentTime: 0,
                        initialized: false
                    });
                }
                return pluginContexts.get(pluginId);
            };

            let lastProgressUpdate = 0;
            const PROGRESS_UPDATE_INTERVAL = 16; // ~60fps

            // Process audio in blocks
            for (let offset = 0; offset < totalSamples; offset += BLOCK_SIZE) {
                const remainingSamples = totalSamples - offset;
                const blockSize = remainingSamples < BLOCK_SIZE ? remainingSamples : BLOCK_SIZE;
                const totalSize = blockSize * outputChannelCount;
                const inputBlock = new Float32Array(totalSize);

                // Interleave channel data into a single block
                const inputChannelsToCopy = numberOfChannels < outputChannelCount ? numberOfChannels : outputChannelCount;
                for (let ch = 0; ch < inputChannelsToCopy; ch++) {
                    const channelData = audioBuffer.getChannelData(ch);
                    const channelOffset = ch * blockSize;
                    for (let i = 0; i < blockSize; i++) {
                        inputBlock[channelOffset + i] = channelData[offset + i];
                    }
                }

                // Initialize bus buffers
                const busBuffers = new Map();
                
                // Track active sections state during processing
                let activeSectionEnabled = true;
                let insideSection = false;
                
                // First, determine which buses are used
                const usedBuses = new Set([0]); // Main bus (index 0) is always used
                for (const plugin of pipeline) {
                    // Track section plugin state
                    if (plugin.constructor.name === 'SectionPlugin') {
                        insideSection = true;
                        activeSectionEnabled = plugin.enabled;
                        continue; // Section plugins don't process audio
                    }
                    
                    // Skip disabled plugins or plugins disabled by section
                    if (!plugin.enabled || (insideSection && !activeSectionEnabled)) {
                        continue;
                    }
                    
                    const pluginParameters = this.getPluginParameters(plugin, sampleRate);
                    const inputBus = this.getOfflineBusIndex(pluginParameters, plugin, 'inputBus');
                    const outputBus = this.getOfflineBusIndex(pluginParameters, plugin, 'outputBus');

                    usedBuses.add(inputBus);
                    usedBuses.add(outputBus);
                }
                
                // Initialize Main bus (index 0) with input data
                // Create a proper copy of the buffer to ensure Main bus is isolated
                const mainBusBuffer = new Float32Array(totalSize);
                mainBusBuffer.set(inputBlock);
                busBuffers.set(0, mainBusBuffer);
                
                // Initialize other used buses with silence
                for (const busIndex of usedBuses) {
                    if (busIndex !== 0) { // Skip Main bus as it's already initialized
                        busBuffers.set(busIndex, new Float32Array(totalSize));
                    }
                }
                
                // Reset section tracking variables for processing
                activeSectionEnabled = true;
                insideSection = false;
                
                // Process block through each plugin
                for (const plugin of pipeline) {
                    // Track section plugin state
                    if (plugin.constructor.name === 'SectionPlugin') {
                        insideSection = true;
                        activeSectionEnabled = plugin.enabled;
                        continue; // Section plugins don't process audio
                    }
                    
                    // Skip disabled plugins or plugins disabled by section
                    if (!plugin.enabled || (insideSection && !activeSectionEnabled)) {
                        continue;
                    }

                    const pluginParameters = this.getPluginParameters(plugin, sampleRate);
                    const inputBus = this.getOfflineBusIndex(pluginParameters, plugin, 'inputBus');
                    const outputBus = this.getOfflineBusIndex(pluginParameters, plugin, 'outputBus');
                    const channel = pluginParameters.channel ?? plugin.channel ?? null;
                    const routing = this.getOfflineChannelRouting(channel, outputChannelCount);
                    if (routing.processMode === 'skip') {
                        if (routing.invalid) {
                            console.warn(`Invalid channel specifier "${channel}" for plugin ${plugin.id}`);
                        }
                        continue;
                    }
                    
                    try {
                        const inputBuffer = busBuffers.get(inputBus);
                        let outputBuffer = busBuffers.get(outputBus);
                        if (!inputBuffer) {
                            console.error(`Offline Processor: input bus ${inputBus} not found for plugin ${plugin.id}`);
                            continue;
                        }
                        if (!outputBuffer) {
                            outputBuffer = new Float32Array(totalSize);
                            busBuffers.set(outputBus, outputBuffer);
                        }

                        const hasExistingContext = pluginContexts.has(plugin.id);
                        const pluginContext = createContext(plugin.id);
                        pluginContext.currentTime = offset / sampleRate;

                        let processingBuffer;
                        if (routing.processMode === 'all') {
                            processingBuffer = inputBus !== outputBus ? new Float32Array(inputBuffer) : inputBuffer;
                        } else if (routing.processMode === 'pair') {
                            processingBuffer = new Float32Array(blockSize * 2);
                            processingBuffer.set(
                                inputBuffer.subarray(routing.pairStartChannel * blockSize, (routing.pairStartChannel + 1) * blockSize),
                                0
                            );
                            processingBuffer.set(
                                inputBuffer.subarray((routing.pairStartChannel + 1) * blockSize, (routing.pairStartChannel + 2) * blockSize),
                                blockSize
                            );
                        } else {
                            processingBuffer = new Float32Array(blockSize);
                            processingBuffer.set(
                                inputBuffer.subarray(routing.singleChannelIndex * blockSize, (routing.singleChannelIndex + 1) * blockSize)
                            );
                        }

                        const parameters = {
                            ...pluginParameters,
                            id: plugin.id,
                            inputBus,
                            outputBus,
                            channel,
                            channelCount: routing.numProcessingChannels,
                            blockSize,
                            sampleRate,
                            initialized: hasExistingContext
                        };

                        const result = plugin.executeProcessor(
                            pluginContext,
                            processingBuffer,
                            parameters,
                            pluginContext.currentTime
                        );
                        const finalResultBuffer = result instanceof Float32Array ? result : processingBuffer;
                        const expectedLength = routing.processMode === 'all'
                            ? totalSize
                            : (routing.processMode === 'pair' ? blockSize * 2 : blockSize);

                        if (!(finalResultBuffer instanceof Float32Array) || finalResultBuffer.length !== expectedLength) {
                            throw new Error(`Invalid plugin output for plugin ${plugin.id}. Expected length ${expectedLength}, got ${finalResultBuffer ? finalResultBuffer.length : 'null'}`);
                        }

                        this.applyOfflineRoutingResult(outputBuffer, finalResultBuffer, routing, inputBus, outputBus, blockSize, totalSize);
                    } catch (error) {
                        console.error('Plugin processing error:', error);
                        // On error, if this plugin was using Main bus as output,
                        // pass through the original input to Main bus
                        if (outputBus === 0) {
                            busBuffers.set(0, new Float32Array(inputBlock));
                        }
                    }
                }

                // De-interleave processed data from Main bus back into the processed buffer
                const finalBlock = busBuffers.get(0) || inputBlock;
                for (let ch = 0; ch < outputChannelCount; ch++) {
                    const channelData = processedBuffer.getChannelData(ch);
                    const channelOffset = ch * blockSize;
                    for (let i = 0; i < blockSize; i++) {
                        channelData[offset + i] = finalBlock[channelOffset + i];
                    }
                }

                // Throttle progress updates (~60fps)
                const currentTime = performance.now();
                if (progressCallback && currentTime - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
                    const progress = Math.round(((offset + blockSize) / totalSamples) * 100);
                    await new Promise(resolve =>
                        requestAnimationFrame(() => {
                            progressCallback(progress);
                            resolve();
                        })
                    );
                    lastProgressUpdate = currentTime;
                }

                // Check for cancellation
                if (this.isCancelled) return null;

                // Yield to UI updates between blocks
                if (offset % (BLOCK_SIZE * 8) === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // Create source node for final offline rendering
            const sourceNode = this.offlineContext.createBufferSource();
            sourceNode.buffer = processedBuffer;
            sourceNode.connect(this.offlineContext.destination);

            try {
                sourceNode.start();
                const renderedBuffer = await this.offlineContext.startRendering();
                if (!renderedBuffer || renderedBuffer.length === 0) {
                    throw new Error('Rendering produced empty buffer');
                }
                if (progressCallback) {
                    await new Promise(resolve =>
                        requestAnimationFrame(() => {
                            progressCallback(100);
                            resolve();
                        })
                    );
                }
                return this.audioEncoder.encodeWAV(renderedBuffer);
            } catch (error) {
                throw new Error(`Processing failed: ${error.message}`);
            } finally {
                // Clean up offline nodes and context
                sourceNode.disconnect();
                if (this.offlineWorkletNode) {
                    this.offlineWorkletNode.disconnect();
                    this.offlineWorkletNode = null;
                }
                this.offlineContext = null;
            }
        } catch (error) {
            throw new Error(`File processing error: ${error.message}`);
        } finally {
            this.isOfflineProcessing = false;
        }
    }

    getOfflineOutputChannelCount(inputChannelCount) {
        let outputChannelCount = inputChannelCount > 2 ? inputChannelCount : 2;
        if (typeof window !== 'undefined') {
            const preferences = window.electronIntegration?.audioPreferences || window.audioPreferences;
            const preferredOutputChannels = Number(preferences?.outputChannels);
            if (Number.isFinite(preferredOutputChannels) && preferredOutputChannels > outputChannelCount) {
                outputChannelCount = preferredOutputChannels;
            }
        }
        return outputChannelCount;
    }

    getPluginParameters(plugin, sampleRate = null) {
        return typeof plugin.getParameters === 'function' ? plugin.getParameters({ sampleRate }) : {};
    }

    getOfflineBusIndex(parameters, plugin, property) {
        return parameters[property] ?? plugin[property] ?? 0;
    }

    getOfflineChannelRouting(channel, outputChannelCount) {
        const routing = {
            processMode: 'skip',
            numProcessingChannels: 0,
            pairStartChannel: -1,
            singleChannelIndex: -1,
            invalid: false
        };

        switch (channel) {
            case 'A':
                if (outputChannelCount > 0) {
                    routing.processMode = 'all';
                    routing.numProcessingChannels = outputChannelCount;
                }
                break;
            case 'L':
                if (outputChannelCount > 0) {
                    routing.processMode = 'single';
                    routing.singleChannelIndex = 0;
                    routing.numProcessingChannels = 1;
                }
                break;
            case 'R':
                if (outputChannelCount > 1) {
                    routing.processMode = 'single';
                    routing.singleChannelIndex = 1;
                    routing.numProcessingChannels = 1;
                }
                break;
            case null:
            case undefined:
                if (outputChannelCount >= 2) {
                    routing.processMode = 'pair';
                    routing.pairStartChannel = 0;
                    routing.numProcessingChannels = 2;
                }
                break;
            case '34':
                if (outputChannelCount >= 4) {
                    routing.processMode = 'pair';
                    routing.pairStartChannel = 2;
                    routing.numProcessingChannels = 2;
                }
                break;
            case '56':
                if (outputChannelCount >= 6) {
                    routing.processMode = 'pair';
                    routing.pairStartChannel = 4;
                    routing.numProcessingChannels = 2;
                }
                break;
            case '78':
                if (outputChannelCount >= 8) {
                    routing.processMode = 'pair';
                    routing.pairStartChannel = 6;
                    routing.numProcessingChannels = 2;
                }
                break;
            default: {
                const parsedChannel = parseInt(channel, 10);
                if (!isNaN(parsedChannel) && parsedChannel > 0 && parsedChannel <= outputChannelCount) {
                    routing.processMode = 'single';
                    routing.singleChannelIndex = parsedChannel - 1;
                    routing.numProcessingChannels = 1;
                } else {
                    routing.invalid = true;
                }
                break;
            }
        }

        return routing;
    }

    applyOfflineRoutingResult(outputBuffer, finalResultBuffer, routing, inputBus, outputBus, blockSize, totalSize) {
        if (inputBus !== outputBus) {
            if (routing.processMode === 'all') {
                for (let i = 0; i < totalSize; i++) {
                    outputBuffer[i] += finalResultBuffer[i];
                }
            } else if (routing.processMode === 'pair') {
                const offset1 = routing.pairStartChannel * blockSize;
                const offset2 = (routing.pairStartChannel + 1) * blockSize;
                for (let i = 0; i < blockSize; i++) {
                    outputBuffer[offset1 + i] += finalResultBuffer[i];
                    outputBuffer[offset2 + i] += finalResultBuffer[blockSize + i];
                }
            } else if (routing.processMode === 'single') {
                const offset = routing.singleChannelIndex * blockSize;
                for (let i = 0; i < blockSize; i++) {
                    outputBuffer[offset + i] += finalResultBuffer[i];
                }
            }
            return;
        }

        if (routing.processMode === 'all') {
            if (finalResultBuffer !== outputBuffer) {
                outputBuffer.set(finalResultBuffer);
            }
        } else if (routing.processMode === 'pair') {
            const offset1 = routing.pairStartChannel * blockSize;
            const offset2 = (routing.pairStartChannel + 1) * blockSize;
            outputBuffer.set(finalResultBuffer.subarray(0, blockSize), offset1);
            outputBuffer.set(finalResultBuffer.subarray(blockSize, blockSize * 2), offset2);
        } else if (routing.processMode === 'single') {
            outputBuffer.set(finalResultBuffer, routing.singleChannelIndex * blockSize);
        }
    }
    
    /**
     * Cancel the current offline processing
     */
    cancelProcessing() {
        this.isCancelled = true;
    }
    
    /**
     * Check if offline processing is in progress
     * @returns {boolean} - Whether offline processing is in progress
     */
    isProcessing() {
        return this.isOfflineProcessing;
    }

    /**
     * Get plugins that are effectively active considering Section plugin states
     * @param {Array} pipeline - The plugin pipeline
     * @returns {Array} Array of plugins that should be processed
     */
    getSectionAwareActivePlugins(pipeline) {
        let activeSectionEnabled = true;
        let insideSection = false;
        const result = [];

        for (const plugin of pipeline) {
            // If this is a section plugin, update section state
            if (plugin.constructor.name === 'SectionPlugin') {
                insideSection = true;
                activeSectionEnabled = plugin.enabled;
            }

            // Calculate effective enabled state
            const effectiveEnabled = plugin.enabled && 
                (!insideSection || (insideSection && activeSectionEnabled));

            // Only add effectively enabled plugins to the result
            if (effectiveEnabled) {
                result.push(plugin);
            }
        }

        return result;
    }
}
