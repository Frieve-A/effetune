/**
 * PipelineSelectionManager - Handles plugin selection logic in the pipeline
 * Manages selection states, multi-selection, and section-based selection
 */
export class PipelineSelectionManager {
    /**
     * Create a new PipelineSelectionManager instance
     * @param {PipelineCore} pipelineCore - Reference to pipeline core instance
     */
    constructor(pipelineCore) {
        this.pipelineCore = pipelineCore;
        this.audioManager = pipelineCore.audioManager;
        this.selectedPlugins = new Set();
    }

    /**
     * Handle plugin selection
     * @param {Object} plugin - The plugin to select
     * @param {Event} e - The event object
     * @param {boolean} clearExisting - Whether to clear existing selection if not using Ctrl/Cmd key
     */
    handlePluginSelection(plugin, e, clearExisting = true) {
        if (clearExisting && !e.ctrlKey && !e.metaKey) {
            this.selectedPlugins.clear();
        }
        this.selectedPlugins.add(plugin);
        this.updateSelectionClasses();
    }

    /**
     * Handle Section plugin selection - select all effects from this section to the next section
     * @param {Object} sectionPlugin - The Section plugin that was clicked
     * @param {Event} e - The event object
     */
    handleSectionSelection(sectionPlugin, e) {
        // Clear existing selection
        this.selectedPlugins.clear();
        
        const pipeline = this.audioManager.pipeline;
        const sectionIndex = pipeline.findIndex(p => p.id === sectionPlugin.id);
        
        if (sectionIndex === -1) {
            // Section not found, fallback to regular selection
            this.handlePluginSelection(sectionPlugin, e);
            return;
        }
        
        // Find the next Section plugin or end of pipeline
        let endIndex = pipeline.length;
        for (let i = sectionIndex + 1; i < pipeline.length; i++) {
            if (pipeline[i].constructor.name === 'SectionPlugin') {
                endIndex = i;
                break;
            }
        }
        
        // Select all plugins from the clicked Section to the next Section (exclusive)
        for (let i = sectionIndex; i < endIndex; i++) {
            this.selectedPlugins.add(pipeline[i]);
        }
        
        this.updateSelectionClasses();
    }

    /**
     * Update the selection classes for pipeline items
     */
    updateSelectionClasses() {
        const pipelineList = this.pipelineCore.pipelineList;
        
        // First, remove 'selected' class from all items
        pipelineList.querySelectorAll('.pipeline-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
        
        // Then, add 'selected' class to selected items
        // This two-step process ensures a more reliable visual update
        pipelineList.querySelectorAll('.pipeline-item').forEach((item, index) => {
            const itemPlugin = this.audioManager.pipeline[index];
            if (this.selectedPlugins.has(itemPlugin)) {
                item.classList.add('selected');
            }
        });
        
        // Force a synchronous style recalculation and layout
        document.body.getBoundingClientRect();
    }

    /**
     * Delete selected plugins
     * @returns {boolean} Whether the deletion was executed
     */
    deleteSelectedPlugins() {
        if (this.selectedPlugins.size === 0) {
            return false;
        }

        // Convert to array and sort in reverse order (delete from highest index)
        const selectedIndices = Array.from(this.selectedPlugins)
            .map(plugin => this.audioManager.pipeline.indexOf(plugin))
            .sort((a, b) => b - a);
        
        // Delete selected plugins
        selectedIndices.forEach(index => {
            if (index > -1) {
                const plugin = this.audioManager.pipeline[index];
                
                // Clean up plugin resources before removing
                if (typeof plugin.cleanup === 'function') {
                    plugin.cleanup();
                }
                
                this.audioManager.pipeline.splice(index, 1);
                this.selectedPlugins.delete(plugin);
            }
        });
        
        this.pipelineCore.updatePipelineUI();
        
        // Update worklet directly without rebuilding pipeline
        this.pipelineCore.updateWorkletPlugins();
        
        // Save state for undo/redo
        if (this.pipelineCore.pipelineManager && this.pipelineCore.pipelineManager.historyManager) {
            this.pipelineCore.pipelineManager.historyManager.saveState();
        }
        
        return true;
    }

    /**
     * Clear current selection
     */
    clearSelection() {
        this.selectedPlugins.clear();
        this.updateSelectionClasses();
    }

    /**
     * Check if a plugin is selected
     * @param {Object} plugin - The plugin to check
     * @returns {boolean} Whether the plugin is selected
     */
    isPluginSelected(plugin) {
        return this.selectedPlugins.has(plugin);
    }

    /**
     * Get selected plugins
     * @returns {Set} The set of selected plugins
     */
    getSelectedPlugins() {
        return this.selectedPlugins;
    }

    /**
     * Select multiple plugins
     * @param {Array} plugins - Array of plugins to select
     * @param {boolean} clearExisting - Whether to clear existing selection
     */
    selectMultiple(plugins, clearExisting = true) {
        if (clearExisting) {
            this.selectedPlugins.clear();
        }
        
        plugins.forEach(plugin => {
            this.selectedPlugins.add(plugin);
        });
        
        this.updateSelectionClasses();
    }

    /**
     * Toggle plugin selection
     * @param {Object} plugin - The plugin to toggle
     */
    togglePluginSelection(plugin) {
        if (this.selectedPlugins.has(plugin)) {
            this.selectedPlugins.delete(plugin);
        } else {
            this.selectedPlugins.add(plugin);
        }
        this.updateSelectionClasses();
    }

    /**
     * Select all plugins
     */
    selectAll() {
        this.selectedPlugins.clear();
        this.audioManager.pipeline.forEach(plugin => {
            this.selectedPlugins.add(plugin);
        });
        this.updateSelectionClasses();
    }

    /**
     * Inverse current selection
     */
    inverseSelection() {
        const newSelection = new Set();
        this.audioManager.pipeline.forEach(plugin => {
            if (!this.selectedPlugins.has(plugin)) {
                newSelection.add(plugin);
            }
        });
        this.selectedPlugins = newSelection;
        this.updateSelectionClasses();
    }
}