/**
 * PipelineCore - Core functionality for managing the audio processing pipeline
 * Handles plugin creation, deletion, reordering, and UI updates
 */
import {
    getSerializablePluginStateShort,
    getSerializablePluginStateLong
} from '../../utils/serialization-utils.js';
import { PipelineItemBuilder } from './pipeline-item-builder.js';
import { PipelineSelectionManager } from './pipeline-selection-manager.js';
import { PipelineRoutingDialog } from './pipeline-routing-dialog.js';
import { PipelineColumnManager } from './pipeline-column-manager.js';
import { PipelineSectionHandler } from './pipeline-section-handler.js';
import { PipelineWorkletSync } from './pipeline-worklet-sync.js';
export class PipelineCore {
    /**
     * Create a new PipelineCore instance
     * @param {Object} audioManager - The audio manager instance
     * @param {Object} pluginManager - The plugin manager instance
     * @param {Set} expandedPlugins - Set of expanded plugins
     */
    constructor(audioManager, pluginManager, expandedPlugins, pipelineManager) {
        this.audioManager = audioManager;
        this.pluginManager = pluginManager;
        this.expandedPlugins = expandedPlugins;
        this.pipelineManager = pipelineManager;
        this.enabled = true;
        
        this.pipelineList = document.getElementById('pipelineList');
        this.pipelineEmpty = document.getElementById('pipelineEmpty');
        
        // Initialize managers
        this.itemBuilder = new PipelineItemBuilder(this);
        this.selectionManager = new PipelineSelectionManager(this);
        this.routingDialog = new PipelineRoutingDialog(this);
        this.columnManager = new PipelineColumnManager(this);
        this.sectionHandler = new PipelineSectionHandler(this);
        this.workletSync = new PipelineWorkletSync(this);
        
        // Setup compatibility properties
        this.selectedPlugins = this.selectionManager.selectedPlugins;
        
        // Create master toggle button
        this.createMasterToggle();
        
        // Setup column control
        this.columnManager.setupColumnControl();
        
        // Setup responsive column adjustment
        this.columnManager.setupResponsiveColumnAdjustment();
    }
    
    createPipelineItem(plugin) {
        return this.itemBuilder.createPipelineItem(plugin);
    }

    /**
     * Update the pipeline UI
     * @param {boolean} forceRedraw - Whether to force a complete rebuild of the UI
     */
    updatePipelineUI(forceRedraw = false) {
        if (!this.pipelineList) {
            console.error("pipelineList element not found in PipelineCore");
            return;
        }

        const pipeline = this.audioManager.pipeline;

        // --- Handle Empty Pipeline State --- 
        if (pipeline.length === 0) {
            this.columnManager.handleEmptyPipelineState();
            return; // Exit early
        } else {
            // Pipeline is NOT empty. Ensure is-empty class is removed and #pipelineEmpty is hidden.
            this.columnManager.handleNonEmptyPipelineState();
        }

        // --- Handle Non-Empty Pipeline --- 
        // Get the desired column count from storage or default
        const columnCount = parseInt(localStorage.getItem('pipelineColumns') || '1');
        const currentColumns = this.pipelineList.querySelectorAll('.pipeline-column');

        // Rebuild columns if the count differs or forceRedraw is true
        if (currentColumns.length !== columnCount || forceRedraw) {
            // console.log(`Rebuilding columns. Current: ${currentColumns.length}, Target: ${columnCount}, Force: ${forceRedraw}`);
            this.columnManager.rebuildPipelineColumns(columnCount); // This will also call distributePluginsToColumns
        } else {
            // console.log(`Column count matches (${columnCount}). Redistributing plugins.`);
            // Only redistribute plugins if columns don't need rebuilding
            // Make sure elements exist, otherwise rebuild
            if (this.pipelineList.childElementCount === 0 && pipeline.length > 0) {
                 this.columnManager.rebuildPipelineColumns(columnCount);
            } else {
                 this.columnManager.distributePluginsToColumns();
            }
        }

        this.updateSelectionClasses(); // Update selection visuals after distribution
        this.updateURL(); // Update URL based on the new state
        // console.log("updatePipelineUI finished.");
         // Ensure pull tab position is updated after potential column changes
        requestAnimationFrame(() => {
             this.columnManager.updatePluginListPullTab();
        });
    }

    /**
     * Rebuild the pipeline columns structure based on column count
     * @param {number} columns - Number of columns to create
     */
    rebuildPipelineColumns(columns) {
        this.columnManager.rebuildPipelineColumns(columns);
    }

    /**
     * Distribute plugins to columns in a column-first manner
     * This ensures plugins are placed in vertical columns (fill column 1, then column 2, etc.)
     */
    distributePluginsToColumns() {
        this.columnManager.distributePluginsToColumns();
    }

    /**
     * Update the selection classes for pipeline items
     */
    updateSelectionClasses() {
        this.selectionManager.updateSelectionClasses();
    }

    /**
     * Handle plugin selection
     * @param {Object} plugin - The plugin to select
     * @param {Event} e - The event object
     * @param {boolean} clearExisting - Whether to clear existing selection if not using Ctrl/Cmd key
     */
    handlePluginSelection(plugin, e, clearExisting = true) {
        this.selectionManager.handlePluginSelection(plugin, e, clearExisting);
    }

    /**
     * Handle Section plugin selection - select all effects from this section to the next section
     * @param {Object} sectionPlugin - The Section plugin that was clicked
     * @param {Event} e - The event object
     */
    handleSectionSelection(sectionPlugin, e) {
        this.selectionManager.handleSectionSelection(sectionPlugin, e);
    }

    /**
     * Delete Section range - delete all effects from the section to the next section
     * @param {Object} sectionPlugin - The Section plugin that was clicked
     */
    deleteSectionRange(sectionPlugin) {
        this.sectionHandler.deleteSectionRange(sectionPlugin);
    }

    /**
     * Move an entire section up
     * @param {Object} sectionPlugin - The section plugin to move
     */
    moveSectionUp(sectionPlugin) {
        this.sectionHandler.moveSectionUp(sectionPlugin);
    }

    /**
     * Move an entire section down
     * @param {Object} sectionPlugin - The section plugin to move
     */
    moveSectionDown(sectionPlugin) {
        this.sectionHandler.moveSectionDown(sectionPlugin);
    }

    /**
     * Add end section plugin if moving to beginning
     * @param {Array} sectionPlugins - The section plugins being moved
     * @param {number} pipelineLength - Current pipeline length
     */
    addEndSectionPluginAtPosition(sectionPlugins, pipelineLength) {
        this.sectionHandler.addEndSectionPluginAtPosition(sectionPlugins, pipelineLength);
    }

    /**
     * Delete selected plugins
     * @returns {boolean} Whether the deletion was executed
     */
    deleteSelectedPlugins() {
        return this.selectionManager.deleteSelectedPlugins();
    }

    /**
     * Create master toggle button for the pipeline
     */
    createMasterToggle() {
        this.masterToggle = document.querySelector('.toggle-button.master-toggle');
        if (!this.masterToggle) return;
        this.masterToggle.title = window.uiManager
            ? window.uiManager.t('ui.title.masterToggle')
            : 'Enable or disable all effects';

        this.masterToggle.onclick = () => {
            this.enabled = !this.enabled;
            this.masterToggle.classList.toggle('off', !this.enabled);
            
            // Update master bypass state directly without rebuilding pipeline
            this.audioManager.masterBypass = !this.enabled;
            
            // Update worklet with the new master bypass state
            this.workletSync.updateMasterBypass(!this.enabled);
            
            // Immediately update display state for all plugins
            this.updateAllPluginDisplayState();
        };
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
     * Update all plugins in the worklet
     */
    updateWorkletPlugins() {
        this.workletSync.updateWorkletPlugins();
    }

    /**
     * Update a single plugin in the worklet
     * @param {Object} plugin - The plugin to update
     */
    updateWorkletPlugin(plugin) {
        this.workletSync.updateWorkletPlugin(plugin);
    }

    /**
     * Show the routing dialog for a plugin
     * @param {Object} plugin - The plugin to configure routing for
     * @param {HTMLElement} button - The button that was clicked
     */
    showRoutingDialog(plugin, button) {
        this.routingDialog.showRoutingDialog(plugin, button);
    }
    
    /**
     * Update the bus info display for a plugin
     * @param {Object} plugin - The plugin to update bus info for
     */
    updateBusInfo(plugin) {
        this.routingDialog.updateBusInfo(plugin);
    }

    /**
     * Get serializable state for a plugin
     * @param {Object} plugin - The plugin to get state for
     * @param {boolean} useShortNames - Whether to use short names (nm/en) for name/enabled
     * @param {boolean} useDeepCopy - Whether to create a deep copy of parameters
     * @returns {Object} Serializable plugin state
     */
    getSerializablePluginState(plugin, useShortNames = false, useDeepCopy = false, includeExpanded = false) {
        // Use the centralized utility functions
        if (useShortNames) {
            // Short format (nm/en/ib/ob)
            let result = getSerializablePluginStateShort(plugin);
            
            // Create a deep copy if requested
            if (useDeepCopy) {
                result = JSON.parse(JSON.stringify(result));
            }
            
            return result;
        } else {
            // Long format (name/enabled/parameters/inputBus/outputBus) with optional expanded state
            return getSerializablePluginStateLong(plugin, useDeepCopy, this.expandedPlugins, includeExpanded);
        }
    }

    /**
     * Update plugin name display state based on section status and master toggle
     * @param {Object} plugin - The plugin to update display for
     * @param {HTMLElement} nameElement - The name element to update
     */
    updatePluginNameDisplayState(plugin, nameElement) {
        // Get master toggle state
        const masterToggleEnabled = !this.audioManager.masterBypass;
        
        // Calculate effective enabled state considering section status
        let effectiveEnabled = plugin.enabled;
        
        // Consider section effect ON/OFF state
        const sectionState = this.getPluginSectionState(plugin);
        if (sectionState.insideSection && !sectionState.sectionEnabled) {
            effectiveEnabled = false;
        }
        
        // Final enabled state considering both master and section states
        const finalEnabled = masterToggleEnabled && effectiveEnabled;
        
        // Update class
        nameElement.classList.toggle('plugin-disabled', !finalEnabled);
    }

    /**
     * Get the section state for a plugin
     * @param {Object} plugin - The plugin to check
     * @returns {Object} Object with insideSection and sectionEnabled properties
     */
    getPluginSectionState(plugin) {
        return this.sectionHandler.getPluginSectionState(plugin);
    }

    /**
     * Update display state for all plugins in the pipeline
     */
    updateAllPluginDisplayState() {
        const pipelineItems = document.querySelectorAll('.pipeline-item');
        pipelineItems.forEach(item => {
            const pluginId = parseInt(item.dataset.pluginId);
            const plugin = this.audioManager.pipeline.find(p => p.id === pluginId);
            if (plugin) {
                const nameElement = item.querySelector('.plugin-name');
                if (nameElement) {
                    this.updatePluginNameDisplayState(plugin, nameElement);
                }
            }
        });
    }

    /**
     * Set up column control for the pipeline
     * This method initializes the column control buttons and their event handlers
     */
    setupColumnControl() {
        this.columnManager.setupColumnControl();
    }

    /**
     * Update the enabled/disabled state of column control buttons
     * @param {number} columns - Current number of columns
     */
    updateColumnButtonStates(columns) {
        this.columnManager.updateColumnButtonStates(columns);
    }

    /**
     * Update pipeline column count and adjust layout
     * @param {number} columns - Number of columns to set (1-8)
     */
    updatePipelineColumns(columns) {
        this.columnManager.updatePipelineColumns(columns);
    }

    /**
     * Update the position of plugin-list-pull-tab to maintain UI consistency
     * This ensures the pull tab stays in the correct position when columns change
     */
    updatePluginListPullTab() {
        this.columnManager.updatePluginListPullTab();
    }

    /**
     * Set up responsive column adjustment based on window size
     * NOTE: This functionality is currently disabled to maintain user-set column count regardless of window size.
     * The pipeline will horizontally overflow if it exceeds viewport width.
     */
    setupResponsiveColumnAdjustment() {
        this.columnManager.setupResponsiveColumnAdjustment();
    }
}
