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
        this.historySuppressionDepth = 0;
        this.activeOperationToken = null;
        this.activeOperationOwnerIndex = -1;
        this.activeOperationBaseState = null;
        this.activeOperationRedo = null;
        this.activeOperationShiftedStates = [];
    }

    get isHistorySuppressed() {
        return this.historySuppressionDepth > 0;
    }

    isOperationActive(token) {
        return token !== null && token !== undefined && token === this.activeOperationToken;
    }

    beginOperation(token) {
        if (token === null || token === undefined) return;
        if (this.activeOperationToken === token) return;
        this.endOperation();
        this.activeOperationToken = token;
        this.activeOperationBaseState = this.history[this.historyIndex] || null;
        this.activeOperationRedo = this.history.slice(this.historyIndex + 1);
    }

    endOperation(token) {
        if (token !== undefined && token !== this.activeOperationToken) return;
        this.activeOperationToken = null;
        this.activeOperationOwnerIndex = -1;
        this.activeOperationBaseState = null;
        this.activeOperationRedo = null;
        this.activeOperationShiftedStates = [];
    }

    withHistorySuppressed(callback) {
        this.endOperation();
        this.historySuppressionDepth++;
        try {
            return callback();
        } finally {
            this.historySuppressionDepth--;
        }
    }

    createSnapshot() {
        return {
            pipelineA: this.audioManager.pipelineA.map(plugin =>
                this.pipelineManager.core.getSerializablePluginState(plugin, true, false, false)
            ),
            pipelineB: this.audioManager.pipelineB ? this.audioManager.pipelineB.map(plugin =>
                this.pipelineManager.core.getSerializablePluginState(plugin, true, false, false)
            ) : null,
            currentPipeline: this.audioManager.currentPipeline
        };
    }

    statesEqual(left, right) {
        return left === right || (left !== null && right !== null &&
            JSON.stringify(left) === JSON.stringify(right));
    }

    appendState(state) {
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push(state);
        this.historyIndex = this.history.length - 1;

        if (this.history.length > this.maxHistorySize) {
            const shiftedState = this.history.shift();
            if (this.activeOperationToken !== null) {
                this.activeOperationShiftedStates.push(shiftedState);
            }
            this.historyIndex--;
            if (this.activeOperationOwnerIndex >= 0) {
                this.activeOperationOwnerIndex--;
                if (this.activeOperationOwnerIndex < 0) this.endOperation();
            }
        }
    }

    /**
     * Save current pipeline state to history
     */
    saveState({ operationToken } = {}) {
        if (operationToken === undefined) {
            this.endOperation();
        } else if (operationToken !== this.activeOperationToken) {
            return;
        }
        if (this.isHistorySuppressed) return;

        const state = this.createSnapshot();
        const activeState = this.history[this.historyIndex] || null;

        if (operationToken !== undefined &&
            this.statesEqual(state, this.activeOperationBaseState)) {
            if (this.activeOperationOwnerIndex === this.historyIndex &&
                this.activeOperationOwnerIndex >= 0) {
                this.history.splice(this.activeOperationOwnerIndex, 1, ...this.activeOperationRedo);
                this.historyIndex--;
                if (this.activeOperationShiftedStates.length > 0) {
                    this.history.unshift(...this.activeOperationShiftedStates);
                    this.historyIndex += this.activeOperationShiftedStates.length;
                    this.activeOperationShiftedStates = [];
                }
                this.activeOperationOwnerIndex = -1;
            }
            return;
        }

        if (this.statesEqual(state, activeState)) return;

        if (operationToken !== undefined &&
            this.activeOperationOwnerIndex === this.historyIndex &&
            this.activeOperationOwnerIndex >= 0) {
            this.history[this.activeOperationOwnerIndex] = state;
            return;
        }

        this.appendState(state);
        if (operationToken !== undefined && this.activeOperationToken === operationToken) {
            this.activeOperationOwnerIndex = this.historyIndex;
        }
    }

    saveStateAtomicallyIfChanged() {
        if (this.isHistorySuppressed) return false;

        const state = this.createSnapshot();
        if (this.statesEqual(state, this.history[this.historyIndex] || null)) return false;

        this.endOperation();
        this.appendState(state);
        return true;
    }
    
    /**
     * Undo the last operation
     */
    undo() {
        this.endOperation();
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
        this.endOperation();
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
        return this.withHistorySuppressed(() => {
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
        });
    }
}
