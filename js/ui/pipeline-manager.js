import { PipelineCore } from './pipeline/pipeline-core.js';
import { PresetManager } from './pipeline/preset-manager.js';
import { HistoryManager } from './pipeline/history-manager.js';
import { FileProcessor } from './pipeline/file-processor.js';
import { UIEventHandler } from './pipeline/ui-event-handler.js';
import { ClipboardManager } from './pipeline/clipboard-manager.js';

/**
 * PipelineManager - Orchestrates all pipeline-related functionality
 * Acts as a facade for the various pipeline modules
 */
export class PipelineManager {
    /**
     * Create a new PipelineManager instance
     * @param {Object} audioManager - The audio manager instance
     * @param {Object} pluginManager - The plugin manager instance
     * @param {Set} expandedPlugins - Set of expanded plugins
     * @param {Object} pluginListManager - The plugin list manager instance
     */
    constructor(audioManager, pluginManager, expandedPlugins, pluginListManager) {
        // Store references to external dependencies
        this.audioManager = audioManager;
        this.pluginManager = pluginManager;
        this.expandedPlugins = expandedPlugins;
        this.pluginListManager = pluginListManager;
        
        // Create core components
        this.core = new PipelineCore(audioManager, pluginManager, expandedPlugins, this);
        
        // Set reference to this PipelineManager in the core
        this.core.pipelineManager = this;
        
        // Create other components
        this.historyManager = new HistoryManager(this);
        this.presetManager = new PresetManager(this);
        this.fileProcessor = new FileProcessor(this);
        this.clipboardManager = new ClipboardManager(this);
        this.uiEventHandler = new UIEventHandler(this, this.historyManager, this.core);
        
        // Expose key properties for backward compatibility
        this.selectedPlugins = this.core.selectedPlugins;
        this.enabled = this.core.enabled;
        this.pipelineList = this.core.pipelineList;
        this.pipelineEmpty = this.core.pipelineEmpty;
        
        // Preset UI elements (for backward compatibility)
        this.presetSelect = document.getElementById('presetSelect');
        this.savePresetButton = document.getElementById('savePresetButton');
        this.deletePresetButton = document.getElementById('deletePresetButton');
        
        // Save initial state after a short delay to ensure Volume and Level Meter are initialized
        setTimeout(() => {
            this.historyManager.saveState();
        }, 1000);
    }
    
    /**
     * Initialize drag and drop functionality
     * Delegates to UIEventHandler
     */
    initDragAndDrop() {
        this.uiEventHandler.initDragAndDrop();
    }
    
    /**
     * Update the pipeline UI
     * Delegates to PipelineCore
     * @param {boolean} forceRebuild - Whether to force a complete rebuild of the UI
     */
    updatePipelineUI(forceRebuild = false) {
        // Update the pipeline reference to current pipeline
        this.audioManager.pipeline = this.audioManager.getCurrentPipeline();
        this.core.updatePipelineUI(forceRebuild);
    }
    
    /**
     * Update selection classes for pipeline items
     * Delegates to PipelineCore
     */
    updateSelectionClasses() {
        this.core.updateSelectionClasses();
    }
    
    /**
     * Handle plugin selection
     * Delegates to PipelineCore
     * @param {Object} plugin - The plugin to select
     * @param {Event} e - The event object
     * @param {boolean} clearExisting - Whether to clear existing selection if not using Ctrl/Cmd key
     */
    handlePluginSelection(plugin, e, clearExisting = true) {
        this.core.handlePluginSelection(plugin, e, clearExisting);
    }
    
    /**
     * Delete selected plugins
     * Delegates to PipelineCore
     * @returns {boolean} Whether the deletion was executed
     */
    deleteSelectedPlugins() {
        return this.core.deleteSelectedPlugins();
    }
    
    /**
     * Update the URL with the current pipeline state
     * Delegates to PipelineCore
     */
    updateURL() {
        this.core.updateURL();
    }
    
    /**
     * Update all plugins in the worklet
     * Delegates to PipelineCore
     */
    updateWorkletPlugins() {
        this.core.updateWorkletPlugins();
    }
    
    /**
     * Update a single plugin in the worklet
     * Delegates to PipelineCore
     * @param {Object} plugin - The plugin to update
     */
    updateWorkletPlugin(plugin) {
        this.core.updateWorkletPlugin(plugin);
    }
    
    /**
     * Get serializable state for a plugin
     * Delegates to PipelineCore
     * @param {Object} plugin - The plugin to get state for
     * @param {boolean} useShortNames - Whether to use short names (nm/en) for name/enabled
     * @param {boolean} useFullFallback - Not used, kept for backward compatibility
     * @param {boolean} useDeepCopy - Whether to create a deep copy of parameters
     * @returns {Object} Serializable plugin state
     */
    getSerializablePluginState(plugin, useShortNames = false, useFullFallback = false, useDeepCopy = false) {
        return this.core.getSerializablePluginState(plugin, useShortNames, useFullFallback, useDeepCopy);
    }
    
    /**
     * Save current pipeline state to history
     * Delegates to HistoryManager
     */
    saveState() {
        this.historyManager.saveState();
    }
    
    /**
     * Undo the last operation
     * Delegates to HistoryManager
     */
    undo() {
        this.historyManager.undo();
    }
    
    /**
     * Redo the last undone operation
     * Delegates to HistoryManager
     */
    redo() {
        this.historyManager.redo();
    }
    
    /**
     * Load a preset into the pipeline
     * Delegates to PresetManager
     * @param {string|Object} nameOrPreset - The name of the preset to load from file/localStorage, or a preset object
     */
    async loadPreset(nameOrPreset) {
        await this.presetManager.loadPreset(nameOrPreset);
    }
    
    /**
     * Get current preset data for export
     * Delegates to PresetManager
     * @returns {Object} Current preset data
     */
    getCurrentPresetData() {
        return this.presetManager.getCurrentPresetData();
    }
    
    /**
     * Copy selected plugins to clipboard
     * Delegates to ClipboardManager
     * @returns {Promise<boolean>} Whether the copy was successful
     */
    async copySelectedPluginsToClipboard() {
        return this.clipboardManager.copySelectedPluginsToClipboard();
    }
    
    /**
     * Cut selected plugins (copy then delete)
     * Delegates to ClipboardManager
     * @returns {Promise<boolean>} Whether the cut was successful
     */
    async cutSelectedPlugins() {
        return this.clipboardManager.cutSelectedPlugins();
    }
    
    /**
     * Process dropped audio files
     * Delegates to FileProcessor
     * @param {File[]} files - Array of audio files to process
     */
    async processDroppedAudioFiles(files) {
        await this.fileProcessor.processDroppedAudioFiles(files);
    }
    
    /**
     * Get localized documentation path
     * This method will be set by UIManager
     * @param {string} path - The path to get localized documentation for
     * @returns {string} The localized documentation path
     */
    getLocalizedDocPath(path) {
        // This will be set by UIManager
        return path;
    }
}
