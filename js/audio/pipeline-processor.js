/**
 * PipelineProcessor - Manages the audio processing pipeline
 */
export class PipelineProcessor {
    /**
     * Create a new PipelineProcessor instance
     * @param {Object} contextManager - Reference to the AudioContextManager
     * @param {Object} ioManager - Reference to the AudioIOManager
     * @param {Function} registerProcessors - Callback to register plugin processors
     */
    constructor(contextManager, ioManager, registerProcessors = null) {
        this.contextManager = contextManager;
        this.ioManager = ioManager;
        this.registerProcessors = registerProcessors;
        this.pipeline = [];
        this.masterBypass = false;
    }
    
    /**
     * Set the pipeline of audio plugins
     * @param {Array} pipeline - Array of plugin instances
     * @returns {Promise<void>}
     */
    /**
     * Update the pipeline reference
     * @param {Array} pipeline - Array of plugin instances
     */
    setPipeline(pipeline) {
        this.pipeline = Array.isArray(pipeline) ? pipeline : [];
    }
    
    /**
     * Update the master bypass state
     * @param {boolean} bypass - Whether to bypass all plugins
     */
    setMasterBypass(bypass) {
        this.masterBypass = bypass;
    }
    
    /**
     * Rebuild the audio processing pipeline
     * @param {boolean} isInitializing - Whether this is the initial build
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async rebuildPipeline(isInitializing = false) {
        if (!this.contextManager.audioContext || !this.ioManager.sourceNode) {
            return;
        }

        // Disconnect existing connections
        try {
            if (this.ioManager.sourceNode) {
                this.ioManager.sourceNode.disconnect();
            }
            if (this.contextManager.workletNode) {
                this.contextManager.workletNode.disconnect();
            }
        } catch (error) {
            console.warn('Error disconnecting audio nodes:', error);
            // Continue execution, as we'll try to establish new connections
        }

        // Create missing nodes if needed
        if (!this.ioManager.sourceNode && this.contextManager.audioContext) {
            this.ioManager.sourceNode = this.ioManager.createFallbackSilentSource();
        }
        
        if (!this.contextManager.workletNode && this.contextManager.audioContext) {
            console.warn('Worklet node missing, creating new worklet node');
            try {
                this.contextManager.workletNode = new AudioWorkletNode(this.contextManager.audioContext, 'plugin-processor');
                window.workletNode = this.contextManager.workletNode;
                if (typeof this.registerProcessors === 'function') {
                    this.registerProcessors();
                }
            } catch (error) {
                console.error('Failed to create worklet node:', error);
                return `Audio Error: Failed to create audio processor: ${error.message}`;
            }
        }
        
        // Connect audio nodes
        const connectionResult = await this.ioManager.connectAudioNodes();
        if (connectionResult) {
            return connectionResult;
        }
        
        // Make sure we have the latest pipeline from the AudioManager
        if (Array.isArray(window.pipeline)) {
            this.pipeline = window.pipeline;
        }

        if (typeof this.registerProcessors === 'function') {
            this.registerProcessors();
        }
        
        // Update worklet with current pipeline state
        if (this.pipeline.length === 0 || this.masterBypass) {
            this.contextManager.workletNode.port.postMessage({
                type: 'updatePlugins',
                plugins: [],
                masterBypass: true
            });
            return '';
        }

        // Send plugin data to worklet
        const pluginData = this.prepareSectionAwarePluginData();
        
        // We don't need to add a message handler here as it's already set up in the AudioContextManager
        
        // Send message to worklet
        this.contextManager.workletNode.port.postMessage({
            type: 'updatePlugins',
            plugins: pluginData,
            masterBypass: this.masterBypass
        });
        
        return '';
    }
    
    /**
     * Prepares plugin data with section effects considered
     * @returns {Array} Array of plugin data objects
     */
    prepareSectionAwarePluginData() {
        const sampleRate = this.contextManager?.audioContext?.sampleRate ?? null;
        return this.pipeline.map(plugin => {
            const params = plugin.getParameters({ sampleRate, commitSampleRate: true });
            
            return {
                id: plugin.id,
                type: plugin.constructor.name,
                enabled: plugin.enabled,
                parameters: params,
                inputBus: plugin.inputBus,
                outputBus: plugin.outputBus,
                channel: plugin.channel
            };
        });
    }
    
    /**
     * Get the current pipeline
     * @returns {Array} - Array of plugin instances
     */
    getPipeline() {
        return this.pipeline;
    }
    
    /**
     * Get the master bypass state
     * @returns {boolean} - Whether all plugins are bypassed
     */
    getMasterBypass() {
        return this.masterBypass;
    }
}
