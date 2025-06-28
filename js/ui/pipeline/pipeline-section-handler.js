/**
 * PipelineSectionHandler - Handles section-specific operations
 * Manages section plugins, section selection, and section movement
 */
export class PipelineSectionHandler {
    /**
     * Create a new PipelineSectionHandler instance
     * @param {PipelineCore} pipelineCore - Reference to pipeline core instance
     */
    constructor(pipelineCore) {
        this.pipelineCore = pipelineCore;
        this.audioManager = pipelineCore.audioManager;
        this.pipelineManager = pipelineCore.pipelineManager;
    }

    /**
     * Delete Section range - delete all effects from the section to the next section
     * @param {Object} sectionPlugin - The Section plugin that was clicked
     */
    deleteSectionRange(sectionPlugin) {
        const pipeline = this.audioManager.pipeline;
        const sectionIndex = pipeline.findIndex(p => p.id === sectionPlugin.id);
        
        if (sectionIndex === -1) {
            // Section not found, do nothing
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
        
        // Clear existing selection
        this.pipelineCore.selectedPlugins.clear();
        
        // Collect plugins to delete
        const pluginsToDelete = [];
        for (let i = sectionIndex; i < endIndex; i++) {
            pluginsToDelete.push(pipeline[i]);
        }
        
        // Clean up plugin resources and remove from pipeline
        for (let i = pluginsToDelete.length - 1; i >= 0; i--) {
            const plugin = pluginsToDelete[i];
            const index = pipeline.indexOf(plugin);
            
            if (index > -1) {
                // Clean up plugin resources before removing
                if (typeof plugin.cleanup === 'function') {
                    plugin.cleanup();
                }
                
                pipeline.splice(index, 1);
                this.pipelineCore.selectedPlugins.delete(plugin);
            }
        }
        
        this.pipelineCore.updatePipelineUI();
        
        // Update worklet directly without rebuilding pipeline
        this.pipelineCore.updateWorkletPlugins();
        
        // Save state for undo/redo
        if (this.pipelineManager && this.pipelineManager.historyManager) {
            this.pipelineManager.historyManager.saveState();
        }
    }

    /**
     * Move an entire section up
     * @param {Plugin} sectionPlugin - The section plugin to move
     */
    moveSectionUp(sectionPlugin) {
        const pipeline = this.audioManager.pipeline;
        const sectionIndex = pipeline.findIndex(p => p.id === sectionPlugin.id);
        
        if (sectionIndex === -1 || sectionIndex === 0) {
            return; // Section not found or already at top
        }
        
        // Find the end of this section
        let sectionEndIndex = pipeline.length;
        for (let i = sectionIndex + 1; i < pipeline.length; i++) {
            if (pipeline[i].constructor.name === 'SectionPlugin') {
                sectionEndIndex = i;
                break;
            }
        }
        
        // Find target position (before previous section)
        let targetIndex = 0;
        for (let i = sectionIndex - 1; i >= 0; i--) {
            if (pipeline[i].constructor.name === 'SectionPlugin') {
                targetIndex = i;
                break;
            }
        }
        
        // Extract section plugins
        const sectionPlugins = pipeline.splice(sectionIndex, sectionEndIndex - sectionIndex);
        
        // Check if we need to add end section to preserve separation
        // Only add if there are plugins after insertion point and they're not immediately followed by a Section
        if (targetIndex < pipeline.length && pipeline[targetIndex].constructor.name !== 'SectionPlugin') {
            this.addEndSectionPluginAtPosition(sectionPlugins, pipeline.length);
        }
        
        // Insert at target position
        pipeline.splice(targetIndex, 0, ...sectionPlugins);
        
        this.pipelineCore.updatePipelineUI();
        this.pipelineCore.updateWorkletPlugins();
        
        if (this.pipelineManager && this.pipelineManager.historyManager) {
            this.pipelineManager.historyManager.saveState();
        }
    }

    /**
     * Move an entire section down
     * @param {Plugin} sectionPlugin - The section plugin to move
     */
    moveSectionDown(sectionPlugin) {
        const pipeline = this.audioManager.pipeline;
        const sectionIndex = pipeline.findIndex(p => p.id === sectionPlugin.id);
        
        if (sectionIndex === -1) {
            return; // Section not found
        }
        
        // Find the end of this section
        let sectionEndIndex = pipeline.length;
        for (let i = sectionIndex + 1; i < pipeline.length; i++) {
            if (pipeline[i].constructor.name === 'SectionPlugin') {
                sectionEndIndex = i;
                break;
            }
        }
        
        // Find target position (after next section)
        let targetIndex = pipeline.length;
        let nextSectionFound = false;
        for (let i = sectionEndIndex; i < pipeline.length; i++) {
            if (pipeline[i].constructor.name === 'SectionPlugin') {
                nextSectionFound = true;
                // Find end of next section
                for (let j = i + 1; j < pipeline.length; j++) {
                    if (pipeline[j].constructor.name === 'SectionPlugin') {
                        targetIndex = j;
                        break;
                    }
                }
                if (targetIndex === pipeline.length) {
                    // Next section extends to end
                    targetIndex = pipeline.length;
                }
                break;
            }
        }
        
        if (!nextSectionFound) {
            return; // No section below to move past
        }
        
        // Extract section plugins
        const sectionPlugins = pipeline.splice(sectionIndex, sectionEndIndex - sectionIndex);
        
        // Adjust target index after extraction
        targetIndex -= sectionPlugins.length;
        
        // Insert at target position
        pipeline.splice(targetIndex, 0, ...sectionPlugins);
        
        this.pipelineCore.updatePipelineUI();
        this.pipelineCore.updateWorkletPlugins();
        
        if (this.pipelineManager && this.pipelineManager.historyManager) {
            this.pipelineManager.historyManager.saveState();
        }
    }

    /**
     * Add end section plugin if moving to beginning
     * @param {Array} sectionPlugins - The section plugins being moved
     * @param {number} pipelineLength - Current pipeline length
     */
    addEndSectionPluginAtPosition(sectionPlugins, pipelineLength) {
        try {
            const pluginManager = window.pluginManager;
            if (pluginManager && pluginManager.isPluginAvailable('Section')) {
                const endSectionPlugin = pluginManager.createPlugin('Section');
                endSectionPlugin.setParameters({
                    cm: '' // Empty comment as default
                });
                
                // Add to expanded plugins
                if (this.pipelineManager) {
                    this.pipelineManager.expandedPlugins.add(endSectionPlugin);
                }
                
                sectionPlugins.push(endSectionPlugin);
            }
        } catch (error) {
            console.warn('Failed to create end section plugin:', error);
        }
    }

    /**
     * Get the section state for a plugin
     * @param {Object} plugin - The plugin to check
     * @returns {Object} Object with insideSection and sectionEnabled properties
     */
    getPluginSectionState(plugin) {
        const pipeline = this.audioManager.pipeline;
        const pluginIndex = pipeline.findIndex(p => p.id === plugin.id);
        
        // If plugin is not in the pipeline
        if (pluginIndex === -1) {
            return { insideSection: false, sectionEnabled: true };
        }
        
        // Look for section plugins before this plugin
        let currentSectionEnabled = true;
        let insideSection = false;
        
        for (let i = 0; i <= pluginIndex; i++) {
            const p = pipeline[i];
            if (p.constructor.name === 'SectionPlugin') {
                insideSection = true;
                currentSectionEnabled = p.enabled;
            }
        }
        
        return { insideSection, sectionEnabled: currentSectionEnabled };
    }

    /**
     * Find the range of plugins in a section
     * @param {Object} sectionPlugin - The section plugin
     * @returns {Object} Object with startIndex and endIndex
     */
    findSectionRange(sectionPlugin) {
        const pipeline = this.audioManager.pipeline;
        const startIndex = pipeline.findIndex(p => p.id === sectionPlugin.id);
        
        if (startIndex === -1) {
            return { startIndex: -1, endIndex: -1 };
        }
        
        // Find the next Section plugin or end of pipeline
        let endIndex = pipeline.length;
        for (let i = startIndex + 1; i < pipeline.length; i++) {
            if (pipeline[i].constructor.name === 'SectionPlugin') {
                endIndex = i;
                break;
            }
        }
        
        return { startIndex, endIndex };
    }

    /**
     * Select all plugins in a section
     * @param {Object} sectionPlugin - The section plugin
     */
    selectSection(sectionPlugin) {
        const { startIndex, endIndex } = this.findSectionRange(sectionPlugin);
        
        if (startIndex === -1) {
            return;
        }
        
        const pipeline = this.audioManager.pipeline;
        const pluginsToSelect = [];
        
        for (let i = startIndex; i < endIndex; i++) {
            pluginsToSelect.push(pipeline[i]);
        }
        
        this.pipelineCore.selectionManager.selectMultiple(pluginsToSelect, true);
    }

    /**
     * Expand or collapse all plugins in a section
     * @param {Object} sectionPlugin - The section plugin
     * @param {boolean} expand - Whether to expand (true) or collapse (false)
     */
    expandCollapseSection(sectionPlugin, expand) {
        const { startIndex, endIndex } = this.findSectionRange(sectionPlugin);
        
        if (startIndex === -1) {
            return;
        }
        
        const pipeline = this.audioManager.pipeline;
        
        for (let i = startIndex; i < endIndex; i++) {
            const plugin = pipeline[i];
            const itemEl = document.querySelector(`.pipeline-item[data-plugin-id="${plugin.id}"]`);
            if (!itemEl) continue;
            
            const pluginUI = itemEl.querySelector('.plugin-ui');
            if (!pluginUI) continue;
            
            if (expand) {
                pluginUI.classList.add('expanded');
                this.pipelineCore.expandedPlugins.add(plugin);
                if (plugin.updateMarkers && plugin.updateResponse) {
                    requestAnimationFrame(() => {
                        plugin.updateMarkers();
                        plugin.updateResponse();
                    });
                }
            } else {
                pluginUI.classList.remove('expanded');
                this.pipelineCore.expandedPlugins.delete(plugin);
            }
        }
        
        // Update tooltips
        this.updateAllTooltips();
    }

    /**
     * Update tooltips for all plugin names
     */
    updateAllTooltips() {
        document.querySelectorAll('.pipeline-item').forEach(item => {
            const pluginId = parseInt(item.dataset.pluginId);
            const plugin = this.audioManager.pipeline.find(p => p.id === pluginId);
            if (!plugin) return;
            
            const nameEl = item.querySelector('.plugin-name');
            if (!nameEl) return;
            
            nameEl.title = this.pipelineCore.expandedPlugins.has(plugin)
                ? (window.uiManager ? window.uiManager.t('ui.title.collapse') : 'Click to collapse')
                : (window.uiManager ? window.uiManager.t('ui.title.expand') : 'Click to expand');
        });
    }

    /**
     * Check if a plugin is a Section plugin
     * @param {Object} plugin - The plugin to check
     * @returns {boolean} Whether the plugin is a Section plugin
     */
    isSectionPlugin(plugin) {
        return plugin.constructor.name === 'SectionPlugin' || plugin.name === 'Section';
    }
}