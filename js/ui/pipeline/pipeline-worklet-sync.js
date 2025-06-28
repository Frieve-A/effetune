/**
 * PipelineWorkletSync - Handles synchronization with the audio worklet
 * Manages communication between the UI and the audio processing worklet
 */
export class PipelineWorkletSync {
    /**
     * Create a new PipelineWorkletSync instance
     * @param {PipelineCore} pipelineCore - Reference to pipeline core instance
     */
    constructor(pipelineCore) {
        this.pipelineCore = pipelineCore;
        this.audioManager = pipelineCore.audioManager;
    }

    /**
     * Update all plugins in the worklet
     */
    updateWorkletPlugins() {
        if (window.workletNode) {
            // Prepare plugin data
            const plugins = this.audioManager.pipeline.map(plugin => {
                const parameters = plugin.getParameters();
                
                return {
                    id: plugin.id,
                    type: plugin.constructor.name,
                    enabled: plugin.enabled,
                    parameters: parameters,
                    inputBus: plugin.inputBus,
                    outputBus: plugin.outputBus,
                    channel: plugin.channel
                };
            });
            
            window.workletNode.port.postMessage({
                type: 'updatePlugins',
                plugins: plugins,
                masterBypass: this.audioManager.masterBypass
            });
        }
        this.updateURL();
    }

    /**
     * Update a single plugin in the worklet
     * @param {Object} plugin - The plugin to update
     */
    updateWorkletPlugin(plugin) {
        if (window.workletNode) {
            const parameters = plugin.getParameters();
            
            window.workletNode.port.postMessage({
                type: 'updatePlugin',
                plugin: {
                    id: plugin.id,
                    type: plugin.constructor.name,
                    enabled: plugin.enabled,
                    parameters: parameters,
                    inputBus: plugin.inputBus,
                    outputBus: plugin.outputBus,
                    channel: plugin.channel
                }
            });
        }
        this.updateURL();
    }

    /**
     * Update master bypass state in the worklet
     * @param {boolean} masterBypass - The master bypass state
     */
    updateMasterBypass(masterBypass) {
        if (window.workletNode) {
            // Prepare plugin data
            const plugins = this.audioManager.pipeline.map(plugin => {
                const parameters = plugin.getParameters();
                
                return {
                    id: plugin.id,
                    type: plugin.constructor.name,
                    enabled: plugin.enabled,
                    parameters: parameters,
                    inputBus: plugin.inputBus,
                    outputBus: plugin.outputBus,
                    channel: plugin.channel
                };
            });
            
            window.workletNode.port.postMessage({
                type: 'updatePlugins',
                plugins: plugins,
                masterBypass: masterBypass
            });
        }
        this.updateURL();
    }

    /**
     * Send parameter update for a specific plugin
     * @param {Object} plugin - The plugin whose parameters changed
     */
    sendParameterUpdate(plugin) {
        if (window.workletNode) {
            const parameters = plugin.getParameters();
            window.workletNode.port.postMessage({
                type: 'updatePlugin',
                plugin: {
                    id: plugin.id,
                    type: plugin.constructor.name,
                    enabled: plugin.enabled,
                    parameters: parameters,
                    inputBus: plugin.inputBus,
                    outputBus: plugin.outputBus,
                    channel: plugin.channel
                }
            });
        }
    }

    /**
     * Prepare plugin data for worklet communication
     * @param {Object} plugin - The plugin to prepare data for
     * @returns {Object} Prepared plugin data
     */
    preparePluginData(plugin) {
        const parameters = plugin.getParameters();
        
        return {
            id: plugin.id,
            type: plugin.constructor.name,
            enabled: plugin.enabled,
            parameters: parameters,
            inputBus: plugin.inputBus,
            outputBus: plugin.outputBus,
            channel: plugin.channel
        };
    }

    /**
     * Batch update multiple plugins
     * @param {Array} plugins - Array of plugins to update
     */
    batchUpdatePlugins(plugins) {
        if (window.workletNode && plugins.length > 0) {
            const pluginData = plugins.map(plugin => this.preparePluginData(plugin));
            
            window.workletNode.port.postMessage({
                type: 'batchUpdatePlugins',
                plugins: pluginData
            });
        }
        this.updateURL();
    }

    /**
     * Remove plugin from worklet
     * @param {number} pluginId - The ID of the plugin to remove
     */
    removePlugin(pluginId) {
        if (window.workletNode) {
            window.workletNode.port.postMessage({
                type: 'removePlugin',
                pluginId: pluginId
            });
        }
        this.updateURL();
    }

    /**
     * Add plugin to worklet
     * @param {Object} plugin - The plugin to add
     * @param {number} index - The index to insert at
     */
    addPlugin(plugin, index) {
        if (window.workletNode) {
            const pluginData = this.preparePluginData(plugin);
            
            window.workletNode.port.postMessage({
                type: 'addPlugin',
                plugin: pluginData,
                index: index
            });
        }
        this.updateURL();
    }

    /**
     * Reorder plugins in worklet
     * @param {number} fromIndex - The index to move from
     * @param {number} toIndex - The index to move to
     */
    reorderPlugin(fromIndex, toIndex) {
        if (window.workletNode) {
            window.workletNode.port.postMessage({
                type: 'reorderPlugin',
                fromIndex: fromIndex,
                toIndex: toIndex
            });
        }
        this.updateURL();
    }

    /**
     * Update the URL with the current pipeline state
     */
    updateURL() {
        if (window.uiManager) {
            window.uiManager.updateURL();
        }
    }

    /**
     * Check if worklet is available
     * @returns {boolean} Whether the worklet is available
     */
    isWorkletAvailable() {
        return window.workletNode !== null && window.workletNode !== undefined;
    }

    /**
     * Send reset message to worklet
     */
    resetWorklet() {
        if (window.workletNode) {
            window.workletNode.port.postMessage({
                type: 'reset'
            });
        }
    }

    /**
     * Send performance metrics request to worklet
     */
    requestPerformanceMetrics() {
        if (window.workletNode) {
            window.workletNode.port.postMessage({
                type: 'getPerformanceMetrics'
            });
        }
    }
}