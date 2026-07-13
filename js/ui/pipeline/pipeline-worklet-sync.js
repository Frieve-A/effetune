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

    ensureProcessorsRegistered(plugins = null) {
        if (typeof this.audioManager.registerPipelineProcessors === 'function') {
            this.audioManager.registerPipelineProcessors(plugins);
        }
    }

    getCurrentPipeline() {
        return Array.isArray(this.audioManager.pipeline) ? this.audioManager.pipeline : [];
    }

    getAudioSampleRate() {
        return this.audioManager?.contextManager?.audioContext?.sampleRate ??
            this.audioManager?.audioContext?.sampleRate ??
            null;
    }

    getPluginParameters(plugin) {
        return typeof plugin.getParameters === 'function'
            ? plugin.getParameters({ sampleRate: this.getAudioSampleRate(), commitSampleRate: true })
            : {};
    }

    commitTopologyMutation(message, reason) {
        if (!this.isWorkletAvailable() ||
            typeof this.audioManager.commitPowerTopologyMutation !== 'function') {
            return false;
        }
        this.audioManager.commitPowerTopologyMutation(message, { reason });
        return true;
    }

    broadcastWorkletMessage(message) {
        if (!this.isWorkletAvailable() ||
            typeof this.audioManager.broadcastToActiveWorklets !== 'function') {
            return false;
        }
        this.audioManager.broadcastToActiveWorklets(message);
        return true;
    }

    /**
     * Update all plugins in the worklet
     */
    updateWorkletPlugins() {
        if (this.isWorkletAvailable()) {
            this.ensureProcessorsRegistered();
            // Prepare plugin data
            const plugins = this.getCurrentPipeline().map(plugin => this.preparePluginData(plugin));

            this.commitTopologyMutation({
                type: 'updatePlugins',
                plugins: plugins,
                masterBypass: this.audioManager.masterBypass
            }, 'pipeline-full-update');
        }
        this.updateURL();
    }

    /**
     * Update a single plugin in the worklet
     * @param {Object} plugin - The plugin to update
     */
    updateWorkletPlugin(plugin) {
        if (this.isWorkletAvailable()) {
            this.ensureProcessorsRegistered(plugin);
            this.commitTopologyMutation({
                type: 'updatePlugin',
                plugin: this.preparePluginData(plugin)
            }, 'pipeline-plugin-update');
        }
        this.updateURL();
    }

    /**
     * Update master bypass state in the worklet
     * @param {boolean} masterBypass - The master bypass state
     */
    updateMasterBypass(masterBypass) {
        this.audioManager.masterBypass = !!masterBypass;
        this.audioManager.pipelineProcessor?.setMasterBypass?.(this.audioManager.masterBypass);

        if (this.isWorkletAvailable()) {
            this.ensureProcessorsRegistered();
            // Prepare plugin data
            const plugins = this.getCurrentPipeline().map(plugin => this.preparePluginData(plugin));

            this.commitTopologyMutation({
                type: 'updatePlugins',
                plugins: plugins,
                masterBypass: masterBypass
            }, 'pipeline-master-bypass');
        }
        this.updateURL();
    }

    /**
     * Send parameter update for a specific plugin
     * @param {Object} plugin - The plugin whose parameters changed
     */
    sendParameterUpdate(plugin) {
        if (this.isWorkletAvailable()) {
            this.ensureProcessorsRegistered(plugin);
            this.commitTopologyMutation({
                type: 'updatePlugin',
                plugin: this.preparePluginData(plugin)
            }, 'pipeline-parameter-update');
        }
    }

    /**
     * Prepare plugin data for worklet communication
     * @param {Object} plugin - The plugin to prepare data for
     * @returns {Object} Prepared plugin data
     */
    preparePluginData(plugin) {
        const parameters = this.getPluginParameters(plugin);
        if (typeof plugin.getWorkletPluginData === 'function') {
            return plugin.getWorkletPluginData(parameters);
        }
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
        if (this.isWorkletAvailable() && plugins.length > 0) {
            this.ensureProcessorsRegistered(plugins);
            const pluginData = plugins.map(plugin => this.preparePluginData(plugin));

            this.commitTopologyMutation({
                type: 'batchUpdatePlugins',
                plugins: pluginData
            }, 'pipeline-batch-update');
        }
        this.updateURL();
    }

    /**
     * Remove plugin from worklet
     * @param {number} pluginId - The ID of the plugin to remove
     */
    removePlugin(pluginId) {
        if (this.isWorkletAvailable()) {
            this.commitTopologyMutation({
                type: 'removePlugin',
                pluginId: pluginId
            }, 'pipeline-plugin-remove');
        }
        this.updateURL();
    }

    /**
     * Add plugin to worklet
     * @param {Object} plugin - The plugin to add
     * @param {number} index - The index to insert at
     */
    addPlugin(plugin, index) {
        if (this.isWorkletAvailable()) {
            this.ensureProcessorsRegistered(plugin);
            const pluginData = this.preparePluginData(plugin);

            this.commitTopologyMutation({
                type: 'addPlugin',
                plugin: pluginData,
                index: index
            }, 'pipeline-plugin-add');
        }
        this.updateURL();
    }

    /**
     * Reorder plugins in worklet
     * @param {number} fromIndex - The index to move from
     * @param {number} toIndex - The index to move to
     */
    reorderPlugin(fromIndex, toIndex) {
        if (this.isWorkletAvailable()) {
            this.commitTopologyMutation({
                type: 'reorderPlugin',
                fromIndex: fromIndex,
                toIndex: toIndex
            }, 'pipeline-plugin-reorder');
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
        const active = this.audioManager.getActivePowerWorklets?.();
        if (Array.isArray(active)) return active.some(node => node?.port);
        return !!(this.audioManager.contextManager?.workletNode?.port ||
            this.audioManager.workletNode?.port);
    }

    /**
     * Send reset message to worklet
     */
    resetWorklet() {
        if (this.isWorkletAvailable()) {
            this.commitTopologyMutation({
                type: 'reset'
            }, 'pipeline-reset');
        }
    }

    /**
     * Send performance metrics request to worklet
     */
    requestPerformanceMetrics() {
        if (this.isWorkletAvailable()) {
            this.broadcastWorkletMessage({
                type: 'getPerformanceMetrics'
            });
        }
    }
}
