/**
 * HistoryManager - Handles undo/redo functionality and state management
 */
import { applySerializedState } from '../../utils/serialization-utils.js';

export class HistoryManager {
    /**
     * Create a new HistoryManager instance
     * @param {Object} pipelineManager - The pipeline manager instance
     */
    constructor(pipelineManager) {
        this.pipelineManager = pipelineManager;
        this.audioManager = pipelineManager.audioManager;
        
        // Undo/Redo history
        this.history = [];
        this.historyIndex = -1;
        this.maxHistorySize = 100;
        this.isUndoRedoOperation = false;
        this.undoRedoTimeoutId = null;
        this.specialSaveOverride = false;
    }
    
    /**
     * Save current pipeline state to history
     */
    saveState() {
        // Skip if this is an undo/redo operation
        if (this.isUndoRedoOperation) {
            // Special case: Preset loading needs to save state even with flag set
            if (this.specialSaveOverride) {
                this.specialSaveOverride = false;
            } else {
                return;
            }
        }
        
        // Create a deep copy of the current pipeline state including A/B state
        const state = {
            pipelineA: this.audioManager.pipelineA.map(plugin =>
                this.pipelineManager.core.getSerializablePluginState(plugin, true, false, false)
            ),
            pipelineB: this.audioManager.pipelineB ? this.audioManager.pipelineB.map(plugin =>
                this.pipelineManager.core.getSerializablePluginState(plugin, true, false, false)
            ) : null,
            currentPipeline: this.audioManager.currentPipeline
        };
        
        // If we're not at the end of the history, truncate it
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        // Add new state to history
        this.history.push(state);
        this.historyIndex = this.history.length - 1;
        
        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
            this.historyIndex--;
        }
        
    }
    
    /**
     * Undo the last operation
     */
    undo() {
        if (this.historyIndex <= 0) {
            return; // Nothing to undo
        }
        
        this.historyIndex--;
        this.loadStateFromHistory();
    }
    
    /**
     * Redo the last undone operation
     */
    redo() {
        if (this.historyIndex >= this.history.length - 1) {
            return; // Nothing to redo
        }
        
        // State must exist to perform redo
        if (!this.history[this.historyIndex + 1]) {
            return;
        }
        
        this.historyIndex++;
        this.loadStateFromHistory();
    }
    
    /**
     * Load a state from history
     */
    loadStateFromHistory() {
        this.isUndoRedoOperation = true;
        
        // Clear any existing undo/redo timeout
        if (this.undoRedoTimeoutId) {
            clearTimeout(this.undoRedoTimeoutId);
        }
        
        try {
            const state = this.history[this.historyIndex];
            if (!state) {
                return;
            }
            
            // Handle new dual pipeline format
            if (state.pipelineA && state.pipelineB !== undefined) {
                // Clean up existing plugins before removing them
                this.audioManager.pipelineA.forEach(plugin => {
                    if (typeof plugin.cleanup === 'function') {
                        plugin.cleanup();
                    }
                });
                if (this.audioManager.pipelineB) {
                    this.audioManager.pipelineB.forEach(plugin => {
                        if (typeof plugin.cleanup === 'function') {
                            plugin.cleanup();
                        }
                    });
                }
                
                // Clear pipelines and expanded plugins
                this.audioManager.pipelineA.length = 0;
                if (this.audioManager.pipelineB) {
                    this.audioManager.pipelineB.length = 0;
                }
                this.pipelineManager.expandedPlugins.clear();
                
                // Load pipeline A
                state.pipelineA.forEach(pluginState => {
                    const plugin = this.pipelineManager.pluginManager.createPlugin(pluginState.nm);
                    if (plugin) {
                        applySerializedState(plugin, pluginState);
                        this.audioManager.pipelineA.push(plugin);
                        this.pipelineManager.expandedPlugins.add(plugin);
                    }
                });
                
                // Load pipeline B if it exists
                if (state.pipelineB) {
                    this.audioManager.pipelineB = [];
                    state.pipelineB.forEach(pluginState => {
                        const plugin = this.pipelineManager.pluginManager.createPlugin(pluginState.nm);
                        if (plugin) {
                            applySerializedState(plugin, pluginState);
                            this.audioManager.pipelineB.push(plugin);
                            // Preserve expanded state for pipeline B plugins
                            this.pipelineManager.expandedPlugins.add(plugin);
                        }
                    });
                } else {
                    this.audioManager.pipelineB = null;
                }
                
                // Set current pipeline directly without triggering saveState
                this.audioManager.currentPipeline = state.currentPipeline || 'A';
                this.audioManager.pipeline = this.audioManager.getCurrentPipeline();
                
                // Rebuild audio pipeline if worklet is initialized
                if (this.audioManager.workletNode) {
                    this.audioManager.rebuildPipeline();
                }
                
                // Dispatch event for UI updates
                this.audioManager.dispatchEvent('pipelineChanged', { pipeline: this.audioManager.currentPipeline });
                
            } else {
                // Handle old single pipeline format (backward compatibility)
                // Clean up existing plugins before removing them
                this.audioManager.pipeline.forEach(plugin => {
                    if (typeof plugin.cleanup === 'function') {
                        plugin.cleanup();
                    }
                });
                
                // Clear current pipeline and expanded plugins
                this.audioManager.pipeline.length = 0;
                this.pipelineManager.expandedPlugins.clear();
                
                // Load plugins from state
                state.forEach(pluginState => {
                    const plugin = this.pipelineManager.pluginManager.createPlugin(pluginState.nm);
                    if (plugin) {
                        applySerializedState(plugin, pluginState);
                        this.audioManager.pipeline.push(plugin);
                        this.pipelineManager.expandedPlugins.add(plugin);
                    }
                });
            }
            
            // Update UI with force rebuild flag
            this.pipelineManager.core.updatePipelineUI(true);
            
            // Update worklet directly without rebuilding pipeline
            this.pipelineManager.core.updateWorkletPlugins();
            
            // Update pipeline toggle button to reflect current pipeline
            if (window.uiManager) {
                window.uiManager.updatePipelineToggleButton();
            }
            
            // Ensure master bypass is OFF after loading state (same as loadPreset)
            this.pipelineManager.core.enabled = true;
            this.audioManager.setMasterBypass(false);
            const masterToggle = document.querySelector('.toggle-button.master-toggle');
            if (masterToggle) {
                masterToggle.classList.remove('off');
            }
            
        } finally {
            // Instead of immediate reset, use a timeout to keep the flag active
            // This prevents saveState being called from updateParameters right after undo/redo
            this.undoRedoTimeoutId = setTimeout(() => {
                this.isUndoRedoOperation = false;
                this.undoRedoTimeoutId = null;
            }, 1000);
        }
    }
}