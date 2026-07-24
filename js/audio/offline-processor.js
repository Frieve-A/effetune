import { instantiateDsp, loadDspModule } from './dsp-wasm-loader.js';
import { getDspRolloutConfig } from './dsp-rollout.js';
import { buildDspPipelineDescriptor } from './dsp-pipeline-descriptor.js';

const OFFLINE_BLOCK_SIZE = 128;
const OFFLINE_MAX_WASM_CHANNELS = 8;
// Match the live host's half-module asset budget for the 256 MiB WASM ceiling.
const OFFLINE_DSP_ASSET_BUDGET_BYTES = 128 * 1024 * 1024;

/**
 * OfflineProcessor - Handles offline audio processing
 */
export class OfflineProcessor {
    /**
     * Create a new OfflineProcessor instance
     * @param {Object} contextManager - Reference to the AudioContextManager
     * @param {Object} audioEncoder - Reference to the AudioEncoder
     * @param {Object} dspDependencies - Injectable WASM host dependencies
     */
    constructor(contextManager, audioEncoder, dspDependencies = {}) {
        this.contextManager = contextManager;
        this.audioEncoder = audioEncoder;
        this.offlineContext = null;
        this.offlineWorkletNode = null;
        this.isOfflineProcessing = false;
        this.isCancelled = false;
        this.dspDependencies = {
            loadDspModule: dspDependencies.loadDspModule || loadDspModule,
            instantiateDsp: dspDependencies.instantiateDsp || instantiateDsp,
            getDspRolloutConfig: dspDependencies.getDspRolloutConfig || getDspRolloutConfig,
            getModuleInfo: dspDependencies.getModuleInfo || (() => globalThis.window?.audioManager?.dspModuleInfo || null),
            warning: dspDependencies.warning || (message => globalThis.console?.warn?.(message))
        };
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
        let requiredOfflineDspAssetPlugins = null;
        let processingError = null;
        let dspSession = null;
        try {
            const offlineDspAssetCandidates = this.captureOfflineDspAssetCandidates(pipeline);
            // Read file as ArrayBuffer and decode audio data
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.contextManager.audioContext.decodeAudioData(arrayBuffer);

            // Resolve required assets against the actual render width, while retaining
            // the section-aware plugin membership captured at render start.
            const { numberOfChannels, length: totalSamples, sampleRate } = audioBuffer;
            const outputChannelCount = this.getOfflineOutputChannelCount(numberOfChannels);
            requiredOfflineDspAssetPlugins = this.captureRequiredOfflineDspAssetPlugins(
                offlineDspAssetCandidates,
                { sampleRate, outputChannelCount }
            );
            const offlineDspAssetRequirements = await this.resolveOfflineDspAssetRequirements(
                offlineDspAssetCandidates,
                { sampleRate, outputChannelCount, isCurrent: () => !this.isCancelled },
                requiredOfflineDspAssetPlugins
            );
            if (this.isCancelled) return null;

            // Check if there are any enabled plugins
            const hasEnabledPlugins = pipeline.some(plugin => 
                plugin.constructor.name !== 'SectionPlugin' && plugin.enabled
            );
            
            if (!hasEnabledPlugins) {
                this.ensureRequiredOfflineDspAssetsReady(requiredOfflineDspAssetPlugins, null);
                return this.audioEncoder.encodeWAV(audioBuffer);
            }

            // Define the actual output channel count - may be higher than the file's channel count
            // Create offline context for final rendering
            this.offlineContext = this.contextManager.createOfflineContext(
                outputChannelCount,
                totalSamples,
                sampleRate
            );
            
            // Store reference to pipeline for processing
            this.pipeline = pipeline;

            // Create buffer for processed audio
            const processedBuffer = this.offlineContext.createBuffer(outputChannelCount, totalSamples, sampleRate);

            dspSession = await this.createOfflineDspSession(
                pipeline,
                sampleRate,
                outputChannelCount,
                requiredOfflineDspAssetPlugins,
                offlineDspAssetRequirements
            );
            if (this.isCancelled) {
                this.cleanupOfflineResources();
                return null;
            }
            this.ensureRequiredOfflineDspAssetsReady(requiredOfflineDspAssetPlugins, dspSession);

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
            for (let offset = 0; offset < totalSamples; offset += OFFLINE_BLOCK_SIZE) {
                this.ensureRequiredOfflineDspAssetsReady(requiredOfflineDspAssetPlugins, dspSession);
                const remainingSamples = totalSamples - offset;
                const blockSize = remainingSamples < OFFLINE_BLOCK_SIZE ? remainingSamples : OFFLINE_BLOCK_SIZE;
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

                const finalBlock = this.tryProcessOfflineDspPipeline({
                    session: dspSession,
                    pipeline,
                    inputBlock,
                    sampleRate,
                    outputChannelCount,
                    blockSize,
                    offset
                }) || this.processOfflineHybridBlock({
                    session: dspSession,
                    pipeline,
                    inputBlock,
                    sampleRate,
                    outputChannelCount,
                    blockSize,
                    offset,
                    pluginContexts,
                    createContext
                });

                // De-interleave processed data from Main bus back into the processed buffer
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
                if (this.isCancelled) {
                    this.cleanupOfflineResources();
                    return null;
                }

                // Yield to UI updates between blocks
                if (offset % (OFFLINE_BLOCK_SIZE * 8) === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // Create source node for final offline rendering
            const sourceNode = this.offlineContext.createBufferSource();
            sourceNode.buffer = processedBuffer;
            sourceNode.connect(this.offlineContext.destination);

            let renderError = null;
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
                renderError = error;
            } finally {
                this.cleanupOfflineResources(sourceNode);
            }

            throw new Error(`Processing failed: ${renderError.message}`);
        } catch (error) {
            this.cleanupOfflineResources();
            processingError = error;
        } finally {
            this.destroyOfflineDspSession(dspSession);
            this.isOfflineProcessing = false;
        }

        if (processingError?.userMessageKey) throw processingError;
        throw new Error(`File processing error: ${processingError.message}`);
    }

    captureOfflineDspAssetCandidates(pipeline) {
        return this.getSectionAwareActivePlugins(pipeline).filter(
            plugin => plugin.constructor.name !== 'SectionPlugin'
        );
    }

    captureRequiredOfflineDspAssetPlugins(candidates, context = {}) {
        return new Set(candidates.filter(plugin => {
            if (typeof plugin.isOfflineDspAssetRequired === 'function') {
                return plugin.isOfflineDspAssetRequired(context) === true;
            }
            return plugin.offlineDspAssetRequired === true;
        }));
    }

    async resolveOfflineDspAssetRequirements(candidates, context, requiredPlugins) {
        const results = new Map();
        for (const plugin of candidates) {
            if (typeof plugin.resolveOfflineDspAssetRequirement !== 'function') continue;
            try {
                const requirement = await plugin.resolveOfflineDspAssetRequirement(context);
                results.set(plugin, { requirement });
                if (requirement?.required === true) requiredPlugins.add(plugin);
                else if (requirement?.required === false) requiredPlugins.delete(plugin);
            } catch (error) {
                results.set(plugin, { error });
            }
        }
        return results;
    }

    ensureRequiredOfflineDspAssetsReady(requiredPlugins, session) {
        for (const plugin of requiredPlugins) {
            const entry = session && !session.closed ? session.entries.get(plugin) : null;
            if (entry && !entry.disabled && entry.offlineAssetsReady) continue;
            const typeName = plugin?.constructor?.name || 'plugin';
            this.dspDependencies.warning(
                `[dsp-wasm] offline required asset preparation failed for ${typeName}`
            );
            const error = new Error(`Required offline DSP asset was not prepared for ${typeName}`);
            error.userMessageKey = plugin?.offlineDspAssetErrorMessageKey || 'irReverb.error.prepare';
            throw error;
        }
    }

    isRequiredOfflineDspAssetPlugin(session, plugin) {
        return session?.requiredAssetPlugins?.has(plugin) === true;
    }

    requiredOfflineDspExecutionError(session, plugin) {
        const typeName = plugin?.constructor?.name || 'plugin';
        this.warnOfflineDspOnce(
            session,
            `required-execution:${plugin?.id ?? typeName}`,
            `required asset execution failed for ${typeName}`
        );
        const error = new Error(`Required offline DSP asset stopped executing for ${typeName}`);
        error.userMessageKey = plugin?.offlineDspAssetErrorMessageKey || 'irReverb.error.prepare';
        return error;
    }

    ensureRequiredOfflineDspHybridExecution(session, pipeline) {
        if (!session?.requiredAssetPlugins?.size) return;
        const activePlugins = new Set(this.getSectionAwareActivePlugins(pipeline));
        for (const plugin of session.requiredAssetPlugins) {
            const entry = !session.closed ? session.entries.get(plugin) : null;
            if (activePlugins.has(plugin) && entry && !entry.disabled && entry.offlineAssetsReady) {
                continue;
            }
            throw this.requiredOfflineDspExecutionError(session, plugin);
        }
    }

    async createOfflineDspSession(
        pipeline,
        sampleRate,
        outputChannelCount,
        requiredAssetPlugins = new Set(),
        offlineDspAssetRequirements = new Map()
    ) {
        if (outputChannelCount < 1 || outputChannelCount > OFFLINE_MAX_WASM_CHANNELS) return null;

        const activePlugins = this.getSectionAwareActivePlugins(pipeline).filter(
            plugin => plugin.constructor.name !== 'SectionPlugin'
        );
        if (activePlugins.length === 0) return null;

        const session = {
            binding: null,
            arena: null,
            entries: new Map(),
            activePlugins,
            requiredAssetPlugins,
            sampleRate,
            descriptorEligible: false,
            descriptorConfigured: false,
            descriptorBytes: null,
            residentAssetBytes: 0,
            closed: false,
            warnings: new Set()
        };

        try {
            const windowObject = globalThis.window;
            const preference = windowObject?.audioPreferences ||
                windowObject?.electronIntegration?.audioPreferences || {};
            const location = windowObject?.location || globalThis.location;
            const preflightRollout = this.dspDependencies.getDspRolloutConfig({ preference, location });
            if (preflightRollout.forceOff || preference.useWasmDsp === false) return null;

            let moduleInfo = await this.dspDependencies.getModuleInfo();
            if (!moduleInfo) {
                const pathname = location?.pathname || '';
                const basePath = pathname.substring(0, pathname.lastIndexOf('/'));
                moduleInfo = await this.dspDependencies.loadDspModule({ basePath });
            }
            if (!moduleInfo) return null;

            const rollout = this.dspDependencies.getDspRolloutConfig({
                meta: moduleInfo.meta,
                paramPackers: moduleInfo.paramPackers,
                preference,
                location
            });
            const enabledTypes = new Set(rollout.enabledTypes || []);
            const kernelHashes = new Map(
                (moduleInfo.meta?.kernels || []).map(kernel => [kernel.name, kernel.hash >>> 0])
            );
            const eligiblePackers = new Map();
            for (const typeName of enabledTypes) {
                const packer = moduleInfo.paramPackers?.get(typeName);
                const kernelHash = kernelHashes.get(typeName);
                if (packer && typeof packer.pack === 'function' && kernelHash !== undefined &&
                    (packer.hash >>> 0) === kernelHash) {
                    eligiblePackers.set(typeName, packer);
                }
            }
            if (!activePlugins.some(plugin => eligiblePackers.has(plugin.constructor.name))) return null;

            const moduleOrBytes = moduleInfo.module || moduleInfo.bytes;
            if (!moduleOrBytes) throw new Error('loaded module has no executable payload');
            session.binding = await this.dspDependencies.instantiateDsp(moduleOrBytes, {
                warning: this.dspDependencies.warning
            });
            if (!session.binding?.createEngine()) throw new Error('engine creation failed');
            const prepareStatus = session.binding.prepare(
                sampleRate,
                outputChannelCount,
                OFFLINE_BLOCK_SIZE,
                0
            );
            if (prepareStatus !== 0 || session.binding.live === false) {
                throw new Error(`engine preparation failed with status ${prepareStatus}`);
            }
            session.arena = session.binding.getArenaViews();

            for (const plugin of activePlugins) {
                const typeName = plugin.constructor.name;
                const packer = eligiblePackers.get(typeName);
                if (!packer) continue;

                let offlineState = null;
                const requirementResult = offlineDspAssetRequirements.get(plugin);
                if (requirementResult?.error) {
                    this.warnOfflineDspOnce(
                        session,
                        `offline-state:${plugin.id}`,
                        `${typeName} offline state preparation failed: ${
                            requirementResult.error?.message || String(requirementResult.error)
                        }`
                    );
                    continue;
                }
                if (typeof plugin.createOfflineDspState === 'function') {
                    try {
                        offlineState = await plugin.createOfflineDspState({
                            sampleRate,
                            outputChannelCount,
                            isCurrent: () => !session.closed && !this.isCancelled,
                            offlineDspAssetRequirement: requirementResult?.requirement
                        });
                        if (this.isCancelled) {
                            this.destroyOfflineDspSession(session);
                            return null;
                        }
                    } catch (error) {
                        if (this.isCancelled) {
                            this.destroyOfflineDspSession(session);
                            return null;
                        }
                        this.warnOfflineDspOnce(
                            session,
                            `offline-state:${plugin.id}`,
                            `${typeName} offline state preparation failed: ${error?.message || String(error)}`
                        );
                        continue;
                    }
                }
                if (offlineState?.offlineDspAssetRequired === true) {
                    session.requiredAssetPlugins.add(plugin);
                } else if (offlineState?.offlineDspAssetRequired === false) {
                    session.requiredAssetPlugins.delete(plugin);
                }
                const instanceId = session.binding.createInstance(typeName);
                session.arena = session.binding.getArenaViews();
                if (!instanceId) {
                    this.warnOfflineDspOnce(session, `create:${plugin.id}`, `instance creation failed for ${typeName}`);
                    continue;
                }
                const entry = {
                    plugin,
                    typeName,
                    packer,
                    instanceId,
                    disabled: false,
                    offlineState,
                    offlineAssetsReady: false,
                    residentAssetBytes: 0
                };
                session.entries.set(plugin, entry);
                const parameters = this.getOfflinePluginParameters(session, plugin, sampleRate);
                if (!this.updateOfflineDspParameters(session, entry, parameters)) continue;
                if (!this.stageOfflineDspAssets(session, entry, outputChannelCount)) continue;
            }

            const liveEntryCount = [...session.entries.values()].filter(entry => !entry.disabled).length;
            session.descriptorEligible = liveEntryCount === activePlugins.length && activePlugins.length > 0;
            if (liveEntryCount === 0) {
                this.destroyOfflineDspSession(session);
                return null;
            }
            return session;
        } catch (error) {
            this.warnOfflineDspOnce(session, 'setup', `offline setup failed: ${error?.message || String(error)}`);
            this.destroyOfflineDspSession(session);
            return null;
        }
    }

    stageOfflineDspAssets(session, entry, outputChannelCount) {
        const assets = entry.offlineState?.assets ?? entry.plugin.getWasmAssets?.();
        if (!(assets instanceof Map) || assets.size === 0) return true;
        let entryFootprintBytes = 0;
        for (const asset of assets.values()) {
            const payloadBytes = asset?.payload?.byteLength;
            const footprintBytes = asset?.footprintBytes;
            if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0 ||
                !Number.isSafeInteger(footprintBytes) || footprintBytes < payloadBytes ||
                entryFootprintBytes > OFFLINE_DSP_ASSET_BUDGET_BYTES - footprintBytes) {
                this.warnOfflineDspOnce(
                    session,
                    `asset-admission:${entry.plugin.id}`,
                    `asset admission failed for ${entry.typeName}`
                );
                this.disableOfflineDspEntry(session, entry);
                return false;
            }
            entryFootprintBytes += footprintBytes;
        }
        if (session.residentAssetBytes > OFFLINE_DSP_ASSET_BUDGET_BYTES - entryFootprintBytes) {
            this.warnOfflineDspOnce(
                session,
                `asset-budget:${entry.plugin.id}`,
                `asset budget exceeded for ${entry.typeName}`
            );
            this.disableOfflineDspEntry(session, entry);
            return false;
        }
        for (const [slot, asset] of assets) {
            let status = -1;
            let stagingError = null;
            try {
                status = session.binding.instanceSetAsset(
                    entry.instanceId,
                    slot,
                    asset.payload,
                    asset,
                    asset.formatTag
                );
            } catch (error) {
                stagingError = error;
            }
            try {
                session.arena = session.binding.getArenaViews();
            } catch (error) {
                stagingError ||= error;
            }
            if (stagingError || status !== 0) {
                this.warnOfflineDspOnce(
                    session,
                    `asset:${entry.plugin.id}:${slot}`,
                    `asset staging failed for ${entry.typeName}${
                        stagingError ? `: ${stagingError.message || String(stagingError)}` : ''
                    }`
                );
                this.disableOfflineDspEntry(session, entry);
                return false;
            }
            const silence = session.arena.scratch.allChannels.subarray(
                0,
                outputChannelCount * OFFLINE_BLOCK_SIZE
            );
            const pointer = session.binding.pointerForArenaView(silence);
            let state = session.binding.instanceAssetState(entry.instanceId, slot);
            const requestedWarmupSamples = Number.isSafeInteger(asset.warmupSamples) &&
                asset.warmupSamples > 0 ? asset.warmupSamples : 0;
            const maximumWarmupBlocks = Math.ceil(
                (2 * session.sampleRate + requestedWarmupSamples) / OFFLINE_BLOCK_SIZE
            );
            for (let block = 0; (state & 0xff) === 2 && block < maximumWarmupBlocks; block++) {
                silence.fill(0);
                const processStatus = session.binding.instanceProcess(
                    entry.instanceId,
                    pointer,
                    outputChannelCount,
                    OFFLINE_BLOCK_SIZE,
                    block * OFFLINE_BLOCK_SIZE / session.sampleRate
                );
                if (processStatus !== 0) break;
                state = session.binding.instanceAssetState(entry.instanceId, slot);
            }
            if ((state & 0xff) !== 3 || session.binding.resetInstance(entry.instanceId) !== 0) {
                this.warnOfflineDspOnce(
                    session,
                    `asset-prepare:${entry.plugin.id}:${slot}`,
                    `asset preparation did not complete for ${entry.typeName}`
                );
                this.disableOfflineDspEntry(session, entry);
                return false;
            }
        }
        entry.residentAssetBytes = entryFootprintBytes;
        session.residentAssetBytes += entryFootprintBytes;
        entry.offlineAssetsReady = true;
        return true;
    }

    tryProcessOfflineDspPipeline({
        session,
        pipeline,
        inputBlock,
        sampleRate,
        outputChannelCount,
        blockSize,
        offset
    }) {
        if (!session || session.closed || !session.descriptorEligible) return null;

        const activePlugins = this.getSectionAwareActivePlugins(pipeline).filter(
            plugin => plugin.constructor.name !== 'SectionPlugin'
        );
        for (const plugin of session.requiredAssetPlugins) {
            if (!activePlugins.includes(plugin)) {
                throw this.requiredOfflineDspExecutionError(session, plugin);
            }
        }
        if (activePlugins.length !== session.activePlugins.length ||
            activePlugins.some((plugin, index) => plugin !== session.activePlugins[index])) {
            session.descriptorEligible = false;
            return null;
        }

        let processingStarted = false;
        try {
            const parametersByPlugin = new Map();
            for (const plugin of activePlugins) {
                const entry = session.entries.get(plugin);
                if (!entry || entry.disabled) {
                    if (this.isRequiredOfflineDspAssetPlugin(session, plugin)) {
                        throw this.requiredOfflineDspExecutionError(session, plugin);
                    }
                    session.descriptorEligible = false;
                    return null;
                }
                const parameters = this.getOfflineDspParameters(entry, sampleRate);
                parametersByPlugin.set(plugin, parameters);
                if (!this.updateOfflineDspParameters(session, entry, parameters)) {
                    if (this.isRequiredOfflineDspAssetPlugin(session, plugin)) {
                        throw this.requiredOfflineDspExecutionError(session, plugin);
                    }
                    return null;
                }
            }

            const descriptor = buildDspPipelineDescriptor(pipeline, {
                getInstanceId: plugin => session.entries.get(plugin)?.instanceId,
                getParameters: plugin => parametersByPlugin.get(plugin) || {},
                omitInactive: true
            });
            if (!session.descriptorConfigured || !this.offlineDescriptorsEqual(descriptor, session.descriptorBytes)) {
                const configureStatus = session.binding.pipelineConfigure(descriptor);
                if (configureStatus !== 0) {
                    session.descriptorEligible = false;
                    this.warnOfflineDspOnce(
                        session,
                        'pipeline-configure',
                        `pipeline configuration failed with status ${configureStatus}`
                    );
                    return null;
                }
                session.descriptorBytes = descriptor;
                session.descriptorConfigured = true;
            }

            processingStarted = true;
            const combined = session.arena.combined.subarray(0, inputBlock.length);
            combined.set(inputBlock);
            const processStatus = session.binding.pipelineProcess(
                outputChannelCount,
                blockSize,
                offset / sampleRate,
                false
            );
            if (processStatus !== 0) {
                this.warnOfflineDspOnce(
                    session,
                    'pipeline-process',
                    `pipeline processing failed with status ${processStatus}`
                );
                this.destroyOfflineDspSession(session);
                const requiredPlugin = session.requiredAssetPlugins.values().next().value;
                if (requiredPlugin) {
                    throw this.requiredOfflineDspExecutionError(session, requiredPlugin);
                }
                return null;
            }
            return combined;
        } catch (error) {
            if (error?.userMessageKey) throw error;
            this.warnOfflineDspOnce(
                session,
                'pipeline-runtime',
                `pipeline execution failed: ${error?.message || String(error)}`
            );
            if (processingStarted) {
                this.destroyOfflineDspSession(session);
                const requiredPlugin = session.requiredAssetPlugins.values().next().value;
                if (requiredPlugin) {
                    throw this.requiredOfflineDspExecutionError(session, requiredPlugin);
                }
            } else {
                session.descriptorEligible = false;
            }
            return null;
        }
    }

    processOfflineHybridBlock({
        session,
        pipeline,
        inputBlock,
        sampleRate,
        outputChannelCount,
        blockSize,
        offset,
        pluginContexts,
        createContext
    }) {
        this.ensureRequiredOfflineDspHybridExecution(session, pipeline);
        const totalSize = inputBlock.length;
        const busBuffers = new Map();
        let activeSectionEnabled = true;
        let insideSection = false;
        const usedBuses = new Set([0]);

        for (const plugin of pipeline) {
            if (plugin.constructor.name === 'SectionPlugin') {
                insideSection = true;
                activeSectionEnabled = plugin.enabled;
                this.ensureRequiredOfflineDspHybridExecution(session, pipeline);
                continue;
            }
            if (!plugin.enabled || (insideSection && !activeSectionEnabled)) {
                if (this.isRequiredOfflineDspAssetPlugin(session, plugin)) {
                    throw this.requiredOfflineDspExecutionError(session, plugin);
                }
                continue;
            }

            const pluginParameters = this.getOfflinePluginParameters(session, plugin, sampleRate);
            usedBuses.add(this.getOfflineBusIndex(pluginParameters, plugin, 'inputBus'));
            usedBuses.add(this.getOfflineBusIndex(pluginParameters, plugin, 'outputBus'));
        }

        busBuffers.set(0, new Float32Array(inputBlock));
        for (const busIndex of usedBuses) {
            if (busIndex !== 0) busBuffers.set(busIndex, new Float32Array(totalSize));
        }

        activeSectionEnabled = true;
        insideSection = false;
        const executedRequiredPlugins = new Set();
        for (const plugin of pipeline) {
            if (plugin.constructor.name === 'SectionPlugin') {
                insideSection = true;
                activeSectionEnabled = plugin.enabled;
                this.ensureRequiredOfflineDspHybridExecution(session, pipeline);
                continue;
            }
            if (!plugin.enabled || (insideSection && !activeSectionEnabled)) {
                if (this.isRequiredOfflineDspAssetPlugin(session, plugin)) {
                    throw this.requiredOfflineDspExecutionError(session, plugin);
                }
                continue;
            }

            const pluginParameters = this.getOfflinePluginParameters(session, plugin, sampleRate);
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

                let processingBuffer;
                if (routing.processMode === 'all') {
                    processingBuffer = inputBus !== outputBus ? new Float32Array(inputBuffer) : inputBuffer;
                } else if (routing.processMode === 'pair') {
                    processingBuffer = new Float32Array(blockSize * 2);
                    processingBuffer.set(
                        inputBuffer.subarray(
                            routing.pairStartChannel * blockSize,
                            (routing.pairStartChannel + 1) * blockSize
                        ),
                        0
                    );
                    processingBuffer.set(
                        inputBuffer.subarray(
                            (routing.pairStartChannel + 1) * blockSize,
                            (routing.pairStartChannel + 2) * blockSize
                        ),
                        blockSize
                    );
                } else {
                    processingBuffer = new Float32Array(blockSize);
                    processingBuffer.set(
                        inputBuffer.subarray(
                            routing.singleChannelIndex * blockSize,
                            (routing.singleChannelIndex + 1) * blockSize
                        )
                    );
                }

                const wasmResult = this.tryProcessOfflineDspInstance({
                    session,
                    plugin,
                    pluginParameters,
                    processingBuffer,
                    routing,
                    blockSize,
                    currentTime: offset / sampleRate
                });

                let finalResultBuffer;
                if (wasmResult.processed) {
                    finalResultBuffer = wasmResult.result;
                } else {
                    const hasExistingContext = pluginContexts.has(plugin.id);
                    const pluginContext = createContext(plugin.id);
                    pluginContext.currentTime = offset / sampleRate;
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
                    finalResultBuffer = result instanceof Float32Array ? result : processingBuffer;
                }

                const expectedLength = routing.processMode === 'all'
                    ? totalSize
                    : (routing.processMode === 'pair' ? blockSize * 2 : blockSize);
                if (!(finalResultBuffer instanceof Float32Array) || finalResultBuffer.length !== expectedLength) {
                    throw new Error(
                        `Invalid plugin output for plugin ${plugin.id}. ` +
                        `Expected length ${expectedLength}, got ${finalResultBuffer.length}`
                    );
                }
                this.applyOfflineRoutingResult(
                    outputBuffer,
                    finalResultBuffer,
                    routing,
                    inputBus,
                    outputBus,
                    blockSize,
                    totalSize
                );
                if (wasmResult.processed && this.isRequiredOfflineDspAssetPlugin(session, plugin)) {
                    executedRequiredPlugins.add(plugin);
                }
            } catch (error) {
                if (error?.userMessageKey) throw error;
                console.error('Plugin processing error:', error);
                if (outputBus === 0) busBuffers.set(0, new Float32Array(inputBlock));
            }
        }

        this.ensureRequiredOfflineDspHybridExecution(session, pipeline);
        for (const plugin of session?.requiredAssetPlugins || []) {
            if (!executedRequiredPlugins.has(plugin)) {
                throw this.requiredOfflineDspExecutionError(session, plugin);
            }
        }

        return busBuffers.get(0);
    }

    tryProcessOfflineDspInstance({
        session,
        plugin,
        pluginParameters,
        processingBuffer,
        routing,
        blockSize,
        currentTime
    }) {
        const entry = session && !session.closed ? session.entries.get(plugin) : null;
        if (!entry || entry.disabled) {
            if (this.isRequiredOfflineDspAssetPlugin(session, plugin)) {
                throw this.requiredOfflineDspExecutionError(session, plugin);
            }
            return { processed: false, result: null };
        }

        try {
            if (!this.updateOfflineDspParameters(session, entry, pluginParameters)) {
                if (this.isRequiredOfflineDspAssetPlugin(session, plugin)) {
                    throw this.requiredOfflineDspExecutionError(session, plugin);
                }
                return { processed: false, result: null };
            }
            const scratchName = routing.processMode === 'all'
                ? 'allChannels'
                : (routing.processMode === 'pair' ? 'stereo' : 'mono');
            const scratch = session.arena.scratch[scratchName].subarray(0, processingBuffer.length);
            if (scratch.length !== processingBuffer.length) {
                throw new Error(`arena ${scratchName} view is too small`);
            }
            scratch.set(processingBuffer);
            const pointer = session.binding.pointerForArenaView(scratch);
            if (!Number.isInteger(pointer)) throw new Error('arena scratch pointer is unavailable');
            const status = session.binding.instanceProcess(
                entry.instanceId,
                pointer,
                routing.numProcessingChannels,
                blockSize,
                currentTime
            );
            if (status !== 0) throw new Error(`instance processing failed with status ${status}`);
            return { processed: true, result: scratch };
        } catch (error) {
            if (error?.userMessageKey) throw error;
            this.warnOfflineDspOnce(
                session,
                `instance-process:${plugin.id}`,
                `${entry.typeName} fell back to JavaScript: ${error?.message || String(error)}`
            );
            this.disableOfflineDspEntry(session, entry);
            if (this.isRequiredOfflineDspAssetPlugin(session, plugin)) {
                throw this.requiredOfflineDspExecutionError(session, plugin);
            }
            return { processed: false, result: null };
        }
    }

    updateOfflineDspParameters(session, entry, parameters) {
        if (!session || session.closed || entry.disabled) return false;
        try {
            const packed = entry.packer.pack(parameters);
            const values = packed instanceof Float32Array ? packed : Float32Array.from(packed || []);
            const status = session.binding.instanceSetParams(
                entry.instanceId,
                values,
                entry.packer.hash >>> 0
            );
            if (status !== 0) throw new Error(`parameter update failed with status ${status}`);
            if (typeof entry.packer.packBytes === 'function') {
                const packedBytes = entry.packer.packBytes(parameters);
                if (!(packedBytes instanceof Uint8Array) ||
                    packedBytes.byteLength > entry.packer.byteCapacity) {
                    throw new Error('structured parameter packer returned an invalid payload');
                }
                const byteStatus = session.binding.instanceSetParamBytes(
                    entry.instanceId,
                    packedBytes,
                    entry.packer.hash >>> 0
                );
                if (byteStatus !== 0) {
                    throw new Error(`structured parameter update failed with status ${byteStatus}`);
                }
            }
            return true;
        } catch (error) {
            this.warnOfflineDspOnce(
                session,
                `instance-params:${entry.plugin.id}`,
                `${entry.typeName} parameter update failed: ${error?.message || String(error)}`
            );
            this.disableOfflineDspEntry(session, entry);
            return false;
        }
    }

    disableOfflineDspEntry(session, entry) {
        if (!entry || entry.disabled) return;
        entry.disabled = true;
        session.descriptorEligible = false;
        session.residentAssetBytes -= entry.residentAssetBytes;
        entry.residentAssetBytes = 0;
        try {
            session.binding?.destroyInstance(entry.instanceId);
        } catch (error) {
            this.warnOfflineDspOnce(
                session,
                `instance-destroy:${entry.plugin.id}`,
                `instance cleanup failed: ${error?.message || String(error)}`
            );
        }
    }

    destroyOfflineDspSession(session) {
        if (!session || session.closed) return;
        session.closed = true;
        for (const entry of session.entries.values()) {
            if (entry.disabled) continue;
            entry.disabled = true;
            try {
                session.binding?.destroyInstance(entry.instanceId);
            } catch (error) {
                this.warnOfflineDspOnce(
                    session,
                    `instance-destroy:${entry.plugin.id}`,
                    `instance cleanup failed: ${error?.message || String(error)}`
                );
            }
        }
        try {
            session.binding?.close();
        } catch (error) {
            this.warnOfflineDspOnce(
                session,
                'engine-destroy',
                `engine cleanup failed: ${error?.message || String(error)}`
            );
        }
    }

    warnOfflineDspOnce(session, key, message) {
        if (session?.warnings.has(key)) return;
        session?.warnings.add(key);
        this.dspDependencies.warning(`[dsp-wasm] offline ${message}`);
    }

    offlineDescriptorsEqual(left, right) {
        if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) {
            return false;
        }
        for (let index = 0; index < left.length; index++) {
            if (left[index] !== right[index]) return false;
        }
        return true;
    }

    cleanupOfflineResources(sourceNode = null) {
        if (sourceNode && typeof sourceNode.disconnect === 'function') {
            try {
                sourceNode.disconnect();
            } catch (error) {
                console.warn('Error disconnecting offline source node:', error);
            }
        }

        if (this.offlineWorkletNode) {
            try {
                this.offlineWorkletNode.disconnect();
            } catch (error) {
                console.warn('Error disconnecting offline worklet node:', error);
            }
            this.offlineWorkletNode = null;
        }

        this.offlineContext = null;
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

    getOfflineDspParameters(entry, sampleRate = null) {
        return entry?.offlineState?.parameters ?? this.getPluginParameters(entry?.plugin, sampleRate);
    }

    getOfflinePluginParameters(session, plugin, sampleRate = null) {
        return this.getOfflineDspParameters(session?.entries.get(plugin) || { plugin }, sampleRate);
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
