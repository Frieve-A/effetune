/**
 * PipelineCore - Core functionality for managing the audio processing pipeline
 * Handles plugin creation, deletion, reordering, and UI updates
 */
import {
    getSerializablePluginStateShort,
    getSerializablePluginStateLong
} from '../../utils/serialization-utils.js';
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
        this.selectedPlugins = new Set();
        this.enabled = true;
        
        this.pipelineList = document.getElementById('pipelineList');
        this.pipelineEmpty = document.getElementById('pipelineEmpty');
        
        // Create master toggle button
        this.createMasterToggle();
        
        // Setup column control
        this.setupColumnControl();
        
        // Setup responsive column adjustment
        this.setupResponsiveColumnAdjustment();
    }
    
    /**
     * Create a pipeline item for a plugin
     * @param {Object} plugin - The plugin to create an item for
     * @returns {HTMLElement} The created pipeline item
     */
    createPipelineItem(plugin) {
        const item = document.createElement('div');
        const isSectionPlugin = plugin.name == 'Section';
        item.className = isSectionPlugin ? 'pipeline-item section' : 'pipeline-item';
        item.dataset.pluginId = plugin.id; // Set plugin ID as data attribute for later reference
        
        // Create header container
        const header = document.createElement('div');
        header.className = 'pipeline-item-header';

        // Selection handling for entire pipeline item
        const selectPlugin = (e) => {
            // Prioritize UI item events
            if (e.target.closest('.plugin-ui') || 
                e.target === name || 
                e.target.tagName === 'BUTTON' || 
                e.target.closest('button')) {
                return;
            }

            // Stop event propagation
            e.stopPropagation();

            // Special handling for Ctrl/Cmd click to toggle selection
            if (e.ctrlKey || e.metaKey) {
                if (this.selectedPlugins.has(plugin)) {
                    this.selectedPlugins.delete(plugin);
                    this.updateSelectionClasses();
                } else {
                    this.handlePluginSelection(plugin, e, false);
                }
            } else {
                // Special handling for Section plugin - select from this section to next section
                if (plugin.constructor.name === 'SectionPlugin') {
                    this.handleSectionSelection(plugin, e);
                } else {
                    // Single selection on normal click
                    this.handlePluginSelection(plugin, e);
                }
            }
        };
        
        // Detect click/touch events for entire pipeline-item
        item.addEventListener('click', selectPlugin);
        item.addEventListener('touchstart', selectPlugin);
        
        // Handle for reordering
        const handle = document.createElement('div');
        handle.className = 'handle';
        handle.innerHTML = '⋮';
        handle.draggable = true;
        handle.addEventListener('mousedown', selectPlugin);
        header.appendChild(handle);

        // Enable/disable toggle
        const toggle = document.createElement('button');
        toggle.className = 'toggle-button';
        toggle.textContent = 'ON';
        toggle.title = window.uiManager
            ? window.uiManager.t('ui.title.enableEffect')
            : 'Enable or disable effect';
        toggle.classList.toggle('off', !plugin.enabled);
        toggle.onclick = (e) => {
            plugin.enabled = !plugin.enabled;
            toggle.classList.toggle('off', !plugin.enabled);
            
            // Use the common selection function
            this.handlePluginSelection(plugin, e);
            
            // Update worklet directly without rebuilding pipeline
            this.updateWorkletPlugin(plugin);
            
            // Update UI display state for all plugins that might be affected by this change
            this.updateAllPluginDisplayState();
            
            // Save state for undo/redo
            if (this.pipelineManager && this.pipelineManager.historyManager) {
                this.pipelineManager.historyManager.saveState();
            }
        };
        header.appendChild(toggle);

        // Plugin name
        const name = document.createElement('div');
        name.className = 'plugin-name';
        if (plugin.name === 'Section' && plugin.cm && plugin.cm !== '') {
            name.textContent = `${plugin.cm} Section`;
        } else {
            name.textContent = plugin.name;
        }
        
        // Update the plugin name display state based on section status
        this.updatePluginNameDisplayState(plugin, name);
        
        header.appendChild(name);

        // Display bus routing info if set
        if (plugin.inputBus !== null || plugin.outputBus !== null || plugin.channel !== null) {
            const busInfo = document.createElement('div');
            busInfo.className = 'bus-info';
            if (plugin.inputBus !== null || plugin.outputBus !== null) {
                const inputBusName = plugin.inputBus === null ? 'Main' : `Bus ${plugin.inputBus || 0}`;
                const outputBusName = plugin.outputBus === null ? 'Main' : `Bus ${plugin.outputBus || 0}`;
                busInfo.textContent = `${inputBusName}→${outputBusName}`;
            }
            if (plugin.channel !== null) {
                let channelName;
                if (plugin.channel === 'L') {
                    channelName = 'Left';
                } else if (plugin.channel === 'R') {
                    channelName = 'Right';
                } else if (plugin.channel === 'A') {
                    channelName = 'All';
                } else if (plugin.channel === '34') {
                    channelName = '3+4';
                } else if (plugin.channel === '56') {
                    channelName = '5+6';
                } else if (plugin.channel === '78') {
                    channelName = '7+8';
                } else if (plugin.channel >= '3' && plugin.channel <= '8') {
                    channelName = `Ch ${plugin.channel}`;
                } else {
                    channelName = plugin.channel;
                }
                if (busInfo.textContent != '') {
                    busInfo.textContent += ' ';
                }
                busInfo.textContent += `${channelName}`;
            }
            busInfo.title = window.uiManager
                ? window.uiManager.t('ui.title.configureBusRouting')
                : 'Click to configure bus routing';
            busInfo.style.cursor = 'pointer';
            
            // Make the bus info clickable to open the routing dialog
            busInfo.onclick = (e) => {
                e.stopPropagation(); // Prevent event bubbling
                
                // Use the common selection function
                this.handlePluginSelection(plugin, e);
                
                // Show routing dialog
                const routingBtn = item.querySelector('.routing-button');
                this.showRoutingDialog(plugin, routingBtn || busInfo);
            };
            
            header.appendChild(busInfo);
        }
        
        if (!isSectionPlugin) {
            // Routing button
            const routingBtn = document.createElement('button');
            routingBtn.className = 'routing-button';
            routingBtn.title = window.uiManager
                ? window.uiManager.t('ui.title.configureBusRouting')
                : 'Configure bus routing';
            
            // Use the routing button image
            const routingImg = document.createElement('img');
            routingImg.src = 'images/routing_button.png';
            routingImg.alt = 'Routing';
            routingBtn.appendChild(routingImg);
            
            routingBtn.onclick = (e) => {
                e.stopPropagation(); // Prevent event bubbling
                
                // Use the common selection function
                this.handlePluginSelection(plugin, e);
                
                // Show routing dialog
                this.showRoutingDialog(plugin, routingBtn);
            };
            header.appendChild(routingBtn);
        }
        
        // Move up button
        const moveUpBtn = document.createElement('button');
        moveUpBtn.className = 'move-up-button';
        moveUpBtn.textContent = '▲';
        moveUpBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.moveUp')
            : 'Move effect up';
        moveUpBtn.onclick = (e) => {
            // Use the common selection function
            this.handlePluginSelection(plugin, e);
            
            // Check if this is a Section plugin with Shift+click
            if (plugin.constructor.name === 'SectionPlugin' && e.shiftKey) {
                this.moveSectionUp(plugin);
            } else {
                // Get the index of the plugin
                const index = this.audioManager.pipeline.indexOf(plugin);
                
                // Can't move up if it's the first plugin
                if (index <= 0) return;
                
                // Swap with the plugin above
                const temp = this.audioManager.pipeline[index - 1];
                this.audioManager.pipeline[index - 1] = plugin;
                this.audioManager.pipeline[index] = temp;
                
                // Update worklet directly without rebuilding pipeline
                this.updateWorkletPlugins();
                
                // Update UI display state for all plugins
                this.updateAllPluginDisplayState();
                
                // Save state for undo/redo
                if (this.pipelineManager && this.pipelineManager.historyManager) {
                    this.pipelineManager.historyManager.saveState();
                }
                
                // Update UI
                this.updatePipelineUI();
            }
        };
        header.appendChild(moveUpBtn);

        // Move down button
        const moveDownBtn = document.createElement('button');
        moveDownBtn.className = 'move-down-button';
        moveDownBtn.textContent = '▼';
        moveDownBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.moveDown')
            : 'Move effect down';
        moveDownBtn.onclick = (e) => {
            // Use the common selection function
            this.handlePluginSelection(plugin, e);
            
            // Check if this is a Section plugin with Shift+click
            if (plugin.constructor.name === 'SectionPlugin' && e.shiftKey) {
                this.moveSectionDown(plugin);
            } else {
                // Get the index of the plugin
                const index = this.audioManager.pipeline.indexOf(plugin);
                
                // Can't move down if it's the last plugin
                if (index >= this.audioManager.pipeline.length - 1) return;
                
                // Swap with the plugin below
                const temp = this.audioManager.pipeline[index + 1];
                this.audioManager.pipeline[index + 1] = plugin;
                this.audioManager.pipeline[index] = temp;
                
                // Update worklet directly without rebuilding pipeline
                this.updateWorkletPlugins();
                
                // Update UI display state for all plugins
                this.updateAllPluginDisplayState();
                
                // Save state for undo/redo
                if (this.pipelineManager && this.pipelineManager.historyManager) {
                    this.pipelineManager.historyManager.saveState();
                }
                
                // Update UI
                this.updatePipelineUI();
            }
        };
        header.appendChild(moveDownBtn);

        // Help button
        const helpBtn = document.createElement('button');
        helpBtn.className = 'help-button';
        helpBtn.textContent = '?';
        helpBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.pluginDocs')
            : 'Open plugin documentation';
        helpBtn.onclick = (e) => {
            const category = Object.entries(this.pluginManager.effectCategories)
                .find(([_, {plugins}]) => plugins.includes(plugin.name))?.[0];
            
            if (category) {
                const anchor = plugin.name.toLowerCase()
                    .replace(/[^\w\s-]/g, '')
                    .replace(/\s+/g, '-');
                // Use direct path without extension, let getLocalizedDocPath handle it
                const path = `/plugins/${category.toLowerCase().replace(/-/g, '')}#${anchor}`;
                // Get the full URL from getLocalizedDocPath (which will convert .md to .html)
                const localizedPath = this.pipelineManager.getLocalizedDocPath(path);
                
                
                // For both Electron and web, open the URL in external browser
                if (window.electronAPI) {
                    // In Electron, use shell.openExternal to open in default browser
                    window.electronAPI.openExternalUrl(localizedPath)
                        .catch(err => {
                            // Error opening external URL
                            // Fallback to window.open
                            window.open(localizedPath, '_blank');
                        });
                } else {
                    // Regular browser environment, open the URL
                    window.open(localizedPath, '_blank');
                }
            }
            
            // Use the common selection function
            this.handlePluginSelection(plugin, e);
        };
        header.appendChild(helpBtn);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-button';
        deleteBtn.textContent = '✖';
        deleteBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.deleteEffect')
            : 'Delete effect';
        deleteBtn.onclick = (e) => {
            // Special handling for Section plugin with Shift+Click - delete entire section
            if (plugin.constructor.name === 'SectionPlugin' && e.shiftKey) {
                this.deleteSectionRange(plugin);
            } else {
                // Use the common selection function
                this.handlePluginSelection(plugin, e);
                
                // Use the common delete function
                this.deleteSelectedPlugins();
            }
        };
        header.appendChild(deleteBtn);

        item.appendChild(header);

        // Plugin UI container
        const ui = document.createElement('div');
        ui.className = 'plugin-ui' + (this.expandedPlugins.has(plugin) ? ' expanded' : '');
        
        // Optimize parameter update handling to avoid unnecessary pipeline rebuilds
        if (plugin.updateParameters) {
            const originalUpdateParameters = plugin.updateParameters;
            // Add lastSaveTime property to track when the state was last saved
            plugin.lastSaveTime = 0;
            plugin.paramChangeStarted = false;
            
            plugin.updateParameters = function(...args) {
                originalUpdateParameters.apply(this, args);
                
                // Send an immediate update to the audio worklet with the new parameters
                if (window.workletNode) {
                    const parameters = this.getParameters();
                    window.workletNode.port.postMessage({
                        type: 'updatePlugin',
                        plugin: {
                            id: this.id,
                            type: this.constructor.name,
                            enabled: this.enabled,
                            parameters: parameters,
                            inputBus: this.inputBus,
                            outputBus: this.outputBus,
                            channel: this.channel
                        }
                    });
                }
                
                // Only update URL without rebuilding pipeline
                if (window.uiManager) {
                    window.uiManager.updateURL();
                }
                
                // Update Section name display if this is a Section plugin and cm parameter changed
                if (this.name === 'Section') {
                    const pipelineItem = document.querySelector(`[data-plugin-id="${this.id}"]`);
                    if (pipelineItem) {
                        const nameElement = pipelineItem.querySelector('.plugin-name');
                        if (nameElement) {
                            if (this.cm && this.cm !== '') {
                                nameElement.textContent = `${this.cm} Section`;
                            } else {
                                nameElement.textContent = this.name;
                            }
                        }
                    }
                }
                
                const now = Date.now();
                
                // If this is the first parameter change or it's been more than 500ms since the last save
                if (!this.paramChangeStarted || (now - this.lastSaveTime > 500)) {
                    // Save state immediately for the first parameter change
                    if (this.audioManager && this.audioManager.pipelineManager) {
                        this.audioManager.pipelineManager.historyManager.saveState();
                        this.lastSaveTime = now;
                        this.paramChangeStarted = true;
                    }
                }
                
                // Reset the timer for parameter changes that happen in quick succession
                if (this.saveStateTimeout) {
                    clearTimeout(this.saveStateTimeout);
                }
                
                // Set a timeout to mark the end of a parameter change session
                // and save the final state
                this.saveStateTimeout = setTimeout(() => {
                    // Save the final state at the end of parameter changes
                    if (this.audioManager && this.audioManager.pipelineManager) {
                        this.audioManager.pipelineManager.historyManager.saveState();
                    }
                    this.paramChangeStarted = false;
                }, 500);
            }.bind(plugin);
            plugin.audioManager = this.audioManager;
        }
        
        ui.addEventListener('mousedown', (e) => {
            if (e.target.matches('input, button, select')) {
                if (e.target.matches('input[type="range"]')) {
                    return;
                }
                
                // Use the common selection function
                this.handlePluginSelection(plugin, e);
            }
        });
        
        ui.appendChild(plugin.createUI());
        item.appendChild(ui);

        // Toggle UI visibility and handle selection
        name.onclick = (e) => {
            // Ctrl/Cmd+Click collapses or expands all effects based on the clicked effect's state
            if (e.ctrlKey || e.metaKey) {
                // Only handle normal selection without modifying selectedPlugins set for Ctrl+Click on name
                this.handlePluginSelection(plugin, e);
                
                // Determine if we should expand or collapse based on the clicked plugin's current state
                const shouldExpand = !this.expandedPlugins.has(plugin);
                
                // Apply the same expand/collapse state to all plugins
                this.audioManager.pipeline.forEach(p => {
                    // Find the corresponding pipeline item using plugin ID instead of index
                    const itemEl = document.querySelector(`.pipeline-item[data-plugin-id="${p.id}"]`);
                    if (!itemEl) return;
                    
                    const pluginUI = itemEl.querySelector('.plugin-ui');
                    if (!pluginUI) return;
                    
                    if (shouldExpand) {
                        pluginUI.classList.add('expanded');
                        this.expandedPlugins.add(p);
                        if (p.updateMarkers && p.updateResponse) {
                            requestAnimationFrame(() => {
                                p.updateMarkers();
                                p.updateResponse();
                            });
                        }
                    } else {
                        pluginUI.classList.remove('expanded');
                        this.expandedPlugins.delete(p);
                    }
                });

                // Update all tooltips - using correct element selection
                document.querySelectorAll('.pipeline-item').forEach(item => {
                    const pluginId = parseInt(item.dataset.pluginId);
                    const p = this.audioManager.pipeline.find(plugin => plugin.id === pluginId);
                    if (!p) return;
                    
                    const nameEl = item.querySelector('.plugin-name');
                    if (!nameEl) return;
                    
                    nameEl.title = this.expandedPlugins.has(p)
                        ? (window.uiManager ? window.uiManager.t('ui.title.collapse') : 'Click to collapse')
                        : (window.uiManager ? window.uiManager.t('ui.title.expand') : 'Click to expand');
                });

                return; // Skip individual toggle
            }

            // Handle selection for regular click
            // Special handling for Section plugin - select from this section to next section
            if (plugin.constructor.name === 'SectionPlugin') {
                this.handleSectionSelection(plugin, e);
            } else {
                this.handlePluginSelection(plugin, e);
            }
            
            // Handle Shift+Click to collapse/expand effects
            if (e.shiftKey) {
                // Determine if we're expanding or collapsing based on current state
                const shouldExpand = !this.expandedPlugins.has(plugin);
                
                // Special handling for Section plugins - expand/collapse entire section
                if (plugin.constructor.name === 'SectionPlugin') {
                    const pipeline = this.audioManager.pipeline;
                    const sectionIndex = pipeline.findIndex(p => p.id === plugin.id);
                    
                    if (sectionIndex !== -1) {
                        // Find the next Section plugin or end of pipeline
                        let endIndex = pipeline.length;
                        for (let i = sectionIndex + 1; i < pipeline.length; i++) {
                            if (pipeline[i].constructor.name === 'SectionPlugin') {
                                endIndex = i;
                                break;
                            }
                        }
                        
                        // Process all plugins in this section
                        for (let i = sectionIndex; i < endIndex; i++) {
                            const p = pipeline[i];
                            
                            // Find the corresponding pipeline item using plugin ID
                            const itemEl = document.querySelector(`.pipeline-item[data-plugin-id="${p.id}"]`);
                            if (!itemEl) continue;
                            
                            const pluginUI = itemEl.querySelector('.plugin-ui');
                            if (!pluginUI) continue;
                            
                            // Set expanded state
                            if (shouldExpand) {
                                pluginUI.classList.add('expanded');
                                this.expandedPlugins.add(p);
                                if (p.updateMarkers && p.updateResponse) {
                                    requestAnimationFrame(() => {
                                        p.updateMarkers();
                                        p.updateResponse();
                                    });
                                }
                            } else {
                                pluginUI.classList.remove('expanded');
                                this.expandedPlugins.delete(p);
                            }
                        }
                    }
                } else {
                    // Process all plugins except Analyzer category
                    this.audioManager.pipeline.forEach(p => {
                        // Check if this plugin is in the Analyzer category
                        const category = Object.entries(this.pluginManager.effectCategories)
                            .find(([_, {plugins}]) => plugins.includes(p.name))?.[0];
                        
                        if (category && category.toLowerCase() === 'analyzer') {
                            return; // Always skip Analyzer category plugins
                        }
                        
                        // Find the corresponding pipeline item using plugin ID instead of index
                        const itemEl = document.querySelector(`.pipeline-item[data-plugin-id="${p.id}"]`);
                        if (!itemEl) return;
                        
                        const pluginUI = itemEl.querySelector('.plugin-ui');
                        if (!pluginUI) return;
                        
                        // Set expanded state
                        if (shouldExpand) {
                            pluginUI.classList.add('expanded');
                            this.expandedPlugins.add(p);
                            if (p.updateMarkers && p.updateResponse) {
                                requestAnimationFrame(() => {
                                    p.updateMarkers();
                                    p.updateResponse();
                                });
                            }
                        } else {
                            pluginUI.classList.remove('expanded');
                            this.expandedPlugins.delete(p);
                        }
                    });
                }
                
                // Update all tooltips - using correct element selection
                document.querySelectorAll('.pipeline-item').forEach(item => {
                    const pluginId = parseInt(item.dataset.pluginId);
                    const p = this.audioManager.pipeline.find(plugin => plugin.id === pluginId);
                    if (!p) return;
                    
                    const nameEl = item.querySelector('.plugin-name');
                    if (!nameEl) return;
                    
                    nameEl.title = this.expandedPlugins.has(p)
                        ? (window.uiManager ? window.uiManager.t('ui.title.collapse') : 'Click to collapse')
                        : (window.uiManager ? window.uiManager.t('ui.title.expand') : 'Click to expand');
                });
                
                return; // Skip individual toggle since we've handled all plugins
            }
            
            // Then toggle expanded state for individual plugin (non-shift click)
            const isExpanded = ui.classList.toggle('expanded');
            if (isExpanded) {
                this.expandedPlugins.add(plugin);
                if (plugin.updateMarkers && plugin.updateResponse) {
                    requestAnimationFrame(() => {
                        plugin.updateMarkers();
                        plugin.updateResponse();
                    });
                }
            } else {
                this.expandedPlugins.delete(plugin);
            }
            name.title = isExpanded
                ? (window.uiManager ? window.uiManager.t('ui.title.collapse') : 'Click to collapse')
                : (window.uiManager ? window.uiManager.t('ui.title.expand') : 'Click to expand');
        };
        name.title = this.expandedPlugins.has(plugin)
            ? (window.uiManager ? window.uiManager.t('ui.title.collapse') : 'Click to collapse')
            : (window.uiManager ? window.uiManager.t('ui.title.expand') : 'Click to expand');

        // Setup drag events (will be handled by UIEventHandler)
        if (this.pipelineManager && this.pipelineManager.uiEventHandler) {
            this.pipelineManager.uiEventHandler.setupDragEvents(handle, item, plugin);
        }

        return item;
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
        const pipelineEmptyElement = this.pipelineList.querySelector('#pipelineEmpty'); 
        if (pipeline.length === 0) {
            // Pipeline is empty. Ensure is-empty class is present and #pipelineEmpty is visible.
            
            // Remove any existing plugin columns first
            const existingColumns = this.pipelineList.querySelectorAll('.pipeline-column');
            existingColumns.forEach(col => col.remove());
            
            this.pipelineList.classList.add('is-empty');
            if (pipelineEmptyElement) { 
                 pipelineEmptyElement.style.display = 'block';
            }
            // console.log("Pipeline is empty, adding is-empty class.");
            // Ensure pull tab position is updated even when empty
            requestAnimationFrame(() => {
                 this.updatePluginListPullTab();
            });
            return; // Exit early
        } else {
            // Pipeline is NOT empty. Ensure is-empty class is removed and #pipelineEmpty is hidden.
            this.pipelineList.classList.remove('is-empty');
            if (pipelineEmptyElement) { 
                 pipelineEmptyElement.style.display = 'none';
            }
        }

        // --- Handle Non-Empty Pipeline --- 
        // Get the desired column count from storage or default
        const columnCount = parseInt(localStorage.getItem('pipelineColumns') || '1');
        const currentColumns = this.pipelineList.querySelectorAll('.pipeline-column');

        // Rebuild columns if the count differs or forceRedraw is true
        if (currentColumns.length !== columnCount || forceRedraw) {
            // console.log(`Rebuilding columns. Current: ${currentColumns.length}, Target: ${columnCount}, Force: ${forceRedraw}`);
            this.rebuildPipelineColumns(columnCount); // This will also call distributePluginsToColumns
        } else {
            // console.log(`Column count matches (${columnCount}). Redistributing plugins.`);
            // Only redistribute plugins if columns don't need rebuilding
            // Make sure elements exist, otherwise rebuild
            if (this.pipelineList.childElementCount === 0 && pipeline.length > 0) {
                 this.rebuildPipelineColumns(columnCount);
            } else {
                 this.distributePluginsToColumns();
            }
        }

        this.updateSelectionClasses(); // Update selection visuals after distribution
        this.updateURL(); // Update URL based on the new state
        // console.log("updatePipelineUI finished.");
         // Ensure pull tab position is updated after potential column changes
        requestAnimationFrame(() => {
             this.updatePluginListPullTab();
        });
    }

    /**
     * Rebuild the pipeline columns structure based on column count
     * @param {number} columns - Number of columns to create
     */
    rebuildPipelineColumns(columns) {
        if (!this.pipelineList) {
            console.error("rebuildPipelineColumns: pipelineList element not found.");
            return;
        }
        
        // Remove only existing column elements, preserving #pipelineEmpty
        const existingColumns = this.pipelineList.querySelectorAll('.pipeline-column');
        existingColumns.forEach(col => col.remove());

        // Create columns
        for (let i = 0; i < columns; i++) {
            const column = document.createElement('div');
            column.className = 'pipeline-column';
            column.dataset.columnIndex = i;
            this.pipelineList.appendChild(column);
        }
        // console.log(`Rebuilt ${columns} columns.`);

        // Distribute plugins into the newly created columns
        this.distributePluginsToColumns();
    }

    /**
     * Distribute plugins to columns in a column-first manner
     * This ensures plugins are placed in vertical columns (fill column 1, then column 2, etc.)
     */
    distributePluginsToColumns() {
        const columns = this.pipelineList.querySelectorAll('.pipeline-column');
        if (!columns.length) {
            // console.warn("distributePluginsToColumns called but no columns found.");
            // If no columns, ensure empty state is handled correctly by updatePipelineUI
            // This might happen if pipeline becomes empty, trigger update
            if (this.audioManager.pipeline.length === 0) {
                this.updatePipelineUI(true); 
            }
            return;
        }

        const columnCount = columns.length;
        const pipeline = this.audioManager.pipeline;
        const totalPlugins = pipeline.length;

        // Calculate items per column for column-first distribution
        const pluginsPerColumn = Math.ceil(totalPlugins / columnCount);

        // Clear all columns first to ensure clean distribution
        columns.forEach(column => {
            column.innerHTML = '';
        });

        // Distribute plugins
        pipeline.forEach((plugin, index) => {
            const item = this.createPipelineItem(plugin); // Returns the main item element

            // --- Correctly get handle AFTER creating item ---
            const handle = item.querySelector('.handle');

            // Determine target column index
            const columnIndex = Math.floor(index / pluginsPerColumn);
            const targetColumn = columns[Math.min(columnIndex, columnCount - 1)];

            if (targetColumn) {
                targetColumn.appendChild(item);
                // --- Setup drag events AFTER appending and having the handle ---
                if (this.pipelineManager && this.pipelineManager.uiEventHandler && handle) {
                    this.pipelineManager.uiEventHandler.setupDragEvents(handle, item, plugin);
                } else if (!handle) {
                     console.warn(`No handle found for plugin item ${index} to set up drag events.`);
                } else if (!this.pipelineManager?.uiEventHandler) {
                    console.warn("uiEventHandler not available in PipelineCore to set up drag events.");
                }
            } else {
                 console.warn(`Could not find target column ${columnIndex} for plugin ${index}.`);
            }
        });

        // Update selection classes after distributing
        this.updateSelectionClasses();
    }

    /**
     * Update the selection classes for pipeline items
     */
    updateSelectionClasses() {
        // First, remove 'selected' class from all items
        this.pipelineList.querySelectorAll('.pipeline-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
        
        // Then, add 'selected' class to selected items
        // This two-step process ensures a more reliable visual update
        this.pipelineList.querySelectorAll('.pipeline-item').forEach((item, index) => {
            const itemPlugin = this.audioManager.pipeline[index];
            if (this.selectedPlugins.has(itemPlugin)) {
                item.classList.add('selected');
            }
        });
        
        // Force a synchronous style recalculation and layout
        document.body.getBoundingClientRect();
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
        this.selectedPlugins.clear();
        
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
                this.selectedPlugins.delete(plugin);
            }
        }
        
        this.updatePipelineUI();
        
        // Update worklet directly without rebuilding pipeline
        this.updateWorkletPlugins();
        
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
        
        this.updatePipelineUI();
        this.updateWorkletPlugins();
        
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
        
        this.updatePipelineUI();
        this.updateWorkletPlugins();
        
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
        
        this.updatePipelineUI();
        
        // Update worklet directly without rebuilding pipeline
        this.updateWorkletPlugins();
        
        // Save state for undo/redo
        if (this.pipelineManager && this.pipelineManager.historyManager) {
            this.pipelineManager.historyManager.saveState();
        }
        
        return true;
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
                    masterBypass: !this.enabled
                });
            }
            this.updateURL();
            
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
     * Show the routing dialog for a plugin
     * @param {Object} plugin - The plugin to configure routing for
     * @param {HTMLElement} button - The button that was clicked
     */
    showRoutingDialog(plugin, button) {
        // Remove any existing dialog
        const existingDialog = document.querySelector('.routing-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }
        
        // Create dialog
        const dialog = document.createElement('div');
        dialog.className = 'routing-dialog';
        
        // Create dialog header
        const header = document.createElement('div');
        header.className = 'routing-dialog-header';
        header.textContent = window.uiManager.t('ui.busRouting');
        
        // Create close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'routing-dialog-close';
        closeBtn.textContent = '✕';
        closeBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.close')
            : 'Close';
        closeBtn.onclick = () => dialog.remove();
        header.appendChild(closeBtn);
        dialog.appendChild(header);
        
        // Create channel selector
        const channelContainer = document.createElement('div');
        channelContainer.className = 'routing-dialog-row';

        const channelLabel = document.createElement('label');
        channelLabel.textContent = window.uiManager.t('ui.channel'); // Add translation key 'ui.channel'
        channelContainer.appendChild(channelLabel);

        const channelSelect = document.createElement('select');

        // Define channel options - changed for multi-channel support
        const channelOptions = [
            { text: 'Stereo', value: '' },  // Default - process first 2 channels only (null)
            { text: 'All', value: 'A' },    // All channels
            { text: 'Left', value: 'L' },   // Left channel only
            { text: 'Right', value: 'R' },  // Right channel only
            { text: '3+4', value: '34' },   // Channels 3 & 4 as stereo pair
            { text: '5+6', value: '56' },   // Channels 5 & 6 as stereo pair
            { text: '7+8', value: '78' }    // Channels 7 & 8 as stereo pair
        ];

        // Add individual channel options 3-8 based on output channel count
        for (let i = 3; i <= 8; i++) {
            channelOptions.push({ text: `Ch ${i}`, value: String(i) });
        }

        channelOptions.forEach(option => {
            const optionEl = document.createElement('option');
            optionEl.value = option.value;
            optionEl.textContent = option.text;
            // Compare plugin.channel with option value
            const currentChannelValue = plugin.channel === null ? '' : plugin.channel;
            optionEl.selected = currentChannelValue === option.value;
            channelSelect.appendChild(optionEl);
        });

        channelSelect.onchange = () => {
            const value = channelSelect.value;
            // Store null for empty string (Stereo), otherwise store the value
            plugin.channel = value === '' ? null : value;
            plugin.updateParameters(); 
            this.updateBusInfo(plugin); // Call updateBusInfo to reflect channel change
        };

        channelContainer.appendChild(channelSelect);
        dialog.appendChild(channelContainer);

        // Create input bus selector
        const inputBusContainer = document.createElement('div');
        inputBusContainer.className = 'routing-dialog-row';
        
        const inputBusLabel = document.createElement('label');
        inputBusLabel.textContent = window.uiManager.t('ui.inputBus');
        inputBusContainer.appendChild(inputBusLabel);
        
        const inputBusSelect = document.createElement('select');
        // Add Main bus option (index 0)
        const inputMainOption = document.createElement('option');
        inputMainOption.value = 0;
        inputMainOption.textContent = 'Main';
        inputMainOption.selected = plugin.inputBus === null || plugin.inputBus === 0;
        inputBusSelect.appendChild(inputMainOption);
        
        // Add Bus 1-4 options
        for (let i = 1; i <= 4; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Bus ${i}`;
            option.selected = plugin.inputBus === i;
            inputBusSelect.appendChild(option);
        }
        
        inputBusSelect.onchange = () => {
            const value = parseInt(inputBusSelect.value, 10);
            plugin.inputBus = value === 0 ? null : value;
            plugin.updateParameters();
            this.updateBusInfo(plugin);
        };
        
        inputBusContainer.appendChild(inputBusSelect);
        dialog.appendChild(inputBusContainer);
        
        // Create output bus selector
        const outputBusContainer = document.createElement('div');
        outputBusContainer.className = 'routing-dialog-row';
        
        const outputBusLabel = document.createElement('label');
        outputBusLabel.textContent = window.uiManager.t('ui.outputBus');
        outputBusContainer.appendChild(outputBusLabel);
        
        const outputBusSelect = document.createElement('select');
        // Add Main bus option (index 0)
        const outputMainOption = document.createElement('option');
        outputMainOption.value = 0;
        outputMainOption.textContent = 'Main';
        outputMainOption.selected = plugin.outputBus === null || plugin.outputBus === 0;
        outputBusSelect.appendChild(outputMainOption);
        
        // Add Bus 1-4 options
        for (let i = 1; i <= 4; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Bus ${i}`;
            option.selected = plugin.outputBus === i;
            outputBusSelect.appendChild(option);
        }
        
        outputBusSelect.onchange = () => {
            const value = parseInt(outputBusSelect.value, 10);
            plugin.outputBus = value === 0 ? null : value;
            plugin.updateParameters();
            this.updateBusInfo(plugin);
        };
        
        outputBusContainer.appendChild(outputBusSelect);
        dialog.appendChild(outputBusContainer);
        
        // Calculate current zoom factor - This is what was missing in previous solutions
        // Create a temporary measuring element to accurately determine zoom level
        const zoomMeasureEl = document.createElement('div');
        zoomMeasureEl.style.width = '100px';
        zoomMeasureEl.style.height = '100px';
        zoomMeasureEl.style.position = 'absolute';
        zoomMeasureEl.style.opacity = '0';
        zoomMeasureEl.style.pointerEvents = 'none';
        document.body.appendChild(zoomMeasureEl);
        
        // Get the actual rendered size which changes with zoom
        const actualSize = zoomMeasureEl.getBoundingClientRect();
        // Calculate zoom factor (100px is expected size at 100% zoom)
        const zoomFactor = 100 / actualSize.width;
        // Clean up the measuring element
        document.body.removeChild(zoomMeasureEl);
        
        // Position the dialog near the button, accounting for zoom
        const buttonRect = button.getBoundingClientRect();
        dialog.style.position = 'absolute';
        
        // Apply zoom correction to make position consistent at any zoom level
        const correctedTop = buttonRect.bottom * zoomFactor + window.scrollY;
        const correctedLeft = buttonRect.left * zoomFactor + window.scrollX;
        
        dialog.style.top = `${correctedTop}px`;
        dialog.style.left = `${correctedLeft}px`;
        
        // Add dialog to the document
        document.body.appendChild(dialog);
        
        // Prevent immediate closing by delaying the click handler
        setTimeout(() => {
            // Close dialog when clicking outside
            document.addEventListener('click', function closeDialog(e) {
                if (!dialog.contains(e.target) && e.target !== button) {
                    dialog.remove();
                    document.removeEventListener('click', closeDialog);
                }
            });
        }, 100);
    }
    
    /**
     * Update the bus info display for a plugin
     * @param {Object} plugin - The plugin to update bus info for
     */
    updateBusInfo(plugin) {
        // Find the plugin's pipeline item using its data-plugin-id
        const pipelineItem = this.pipelineList.querySelector(`.pipeline-item[data-plugin-id='${plugin.id}']`);
        if (!pipelineItem) return;
        
        // Find or create the bus info element
        let busInfo = pipelineItem.querySelector('.bus-info');
        const header = pipelineItem.querySelector('.pipeline-item-header');
        const routingBtn = pipelineItem.querySelector('.routing-button'); // Find routing button for insertion point

        // Determine if there's bus or channel info to display
        const hasBusInfo = plugin.inputBus !== null || plugin.outputBus !== null;
        const hasChannelInfo = plugin.channel !== null;

        if (hasBusInfo || hasChannelInfo) {
            if (!busInfo) {
                busInfo = document.createElement('div');
                busInfo.className = 'bus-info';
                // Insert before the routing button or as the first child if no routing button
                if (routingBtn) {
                    header.insertBefore(busInfo, routingBtn);
                } else {
                    // Fallback: insert before the first element (e.g., move up/down buttons)
                    // This might need adjustment based on exact header structure if routingBtn is absent
                    header.insertBefore(busInfo, header.children[2] || null); 
                }
            }
            
            let busText = '';
            if (hasBusInfo) {
                const inputBusName = plugin.inputBus === null ? 'Main' : `Bus ${plugin.inputBus || 0}`;
                const outputBusName = plugin.outputBus === null ? 'Main' : `Bus ${plugin.outputBus || 0}`;
                busText = `${inputBusName}→${outputBusName}`;
            }
            
            let channelText = '';
            if (hasChannelInfo) {
                if (plugin.channel === 'L') {
                    channelText = 'Left';
                } else if (plugin.channel === 'R') {
                    channelText = 'Right';
                } else if (plugin.channel === 'A') {
                    channelText = 'All';
                } else if (plugin.channel === '34') {
                    channelText = '3+4';
                } else if (plugin.channel === '56') {
                    channelText = '5+6';
                } else if (plugin.channel === '78') {
                    channelText = '7+8';
                } else if (plugin.channel >= '3' && plugin.channel <= '8') {
                    channelText = `Ch ${plugin.channel}`;
                } else {
                    channelText = plugin.channel;
                }
            }

            // Combine bus and channel info
            busInfo.textContent = [busText, channelText].filter(Boolean).join(' '); // Filter out empty strings and join with space

            busInfo.title = window.uiManager
                ? window.uiManager.t('ui.title.configureBusRouting')
                : 'Click to configure bus routing';
            busInfo.style.cursor = 'pointer';
            
            // Make the bus info clickable to open the routing dialog
            busInfo.onclick = (e) => {
                e.stopPropagation(); // Prevent event bubbling
                
                // Use the common selection function
                this.handlePluginSelection(plugin, e);
                
                // Show routing dialog
                const actualRoutingBtn = pipelineItem.querySelector('.routing-button'); // Re-query in case it was added
                this.showRoutingDialog(plugin, actualRoutingBtn || busInfo);
            };
        } else if (busInfo) {
            // Remove busInfo element if no bus or channel info is set
            busInfo.remove();
        }
        
        // Save state for undo/redo
        if (this.pipelineManager && this.pipelineManager.historyManager) {
            this.pipelineManager.historyManager.saveState();
        }
    }

    /**
     * Get serializable state for a plugin
     * @param {Object} plugin - The plugin to get state for
     * @param {boolean} useShortNames - Whether to use short names (nm/en) for name/enabled
     * @param {boolean} useFullFallback - Not used, kept for backward compatibility
     * @param {boolean} useDeepCopy - Whether to create a deep copy of parameters
     * @returns {Object} Serializable plugin state
     */
    getSerializablePluginState(plugin, useShortNames = false, useFullFallback = false, useDeepCopy = false, includeExpanded = false) {
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
        const decreaseBtn = document.getElementById('decreaseColumnsButton');
        const increaseBtn = document.getElementById('increaseColumnsButton');
        if (!decreaseBtn || !increaseBtn) return;
        
        // Current column count (default is 1)
        let currentColumns = 1;
        
        // Get saved column count from localStorage
        const savedColumns = localStorage.getItem('pipelineColumns');
        if (savedColumns) {
            currentColumns = parseInt(savedColumns);
        }
        
        // Set initial column count
        this.updatePipelineColumns(currentColumns);
        
        // Update button states
        this.updateColumnButtonStates(currentColumns);
        
        // Decrease button event listener
        decreaseBtn.addEventListener('click', () => {
            if (currentColumns > 1) {
                currentColumns--;
                this.updatePipelineColumns(currentColumns);
                this.updateColumnButtonStates(currentColumns);
            }
        });
        
        // Increase button event listener
        increaseBtn.addEventListener('click', () => {
            if (currentColumns < 8) {
                currentColumns++;
                this.updatePipelineColumns(currentColumns);
                this.updateColumnButtonStates(currentColumns);
            }
        });
        
        // Update plugin-list-pull-tab position after initial setup
        this.updatePluginListPullTab();
    }

    /**
     * Update the enabled/disabled state of column control buttons
     * @param {number} columns - Current number of columns
     */
    updateColumnButtonStates(columns) {
        const decreaseBtn = document.getElementById('decreaseColumnsButton');
        const increaseBtn = document.getElementById('increaseColumnsButton');
        
        if (decreaseBtn) {
            decreaseBtn.disabled = columns <= 1;
        }
        
        if (increaseBtn) {
            increaseBtn.disabled = columns >= 8;
        }
    }

    /**
     * Update pipeline column count and adjust layout
     * @param {number} columns - Number of columns to set (1-8)
     */
    updatePipelineColumns(columns) {
        if (columns < 1 || columns > 8) return; // Check valid range (1-8)
        
        // Update CSS variable for tracking number of columns
        document.documentElement.style.setProperty('--pipeline-columns', columns);
        
        // Calculate and set pipeline width
        const baseWidth = 1064; // Base width per column
        const gap = 10; // Gap between columns (must match CSS gap value)
        const pipelineWidth = (baseWidth * columns) + (gap * (columns - 1));
        
        const pipeline = document.getElementById('pipeline');
        if (pipeline) {
            pipeline.style.width = `${pipelineWidth}px`;
        }
        
        // Rather than using updatePipelineUI, we'll explicitly rebuild the columns
        this.rebuildPipelineColumns(columns);
        
        // Defer updating the pull tab position to the next animation frame.
        // This ensures layout changes (pipeline width, column rebuild) are processed
        // before reading element dimensions/positions in updatePositions.
        requestAnimationFrame(() => {
            this.updatePluginListPullTab();
        });
        
        // Save column count to localStorage for persistence
        localStorage.setItem('pipelineColumns', columns);
    }

    /**
     * Update the position of plugin-list-pull-tab to maintain UI consistency
     * This ensures the pull tab stays in the correct position when columns change
     */
    updatePluginListPullTab() {
        // Get plugin-list-manager instance
        const pluginListManager = window.uiManager ? window.uiManager.pluginListManager : null;
        if (!pluginListManager) return;
        
        // Update positions
        pluginListManager.updatePositions();
    }

    /**
     * Set up responsive column adjustment based on window size
     * NOTE: This functionality is currently disabled to maintain user-set column count regardless of window size.
     * The pipeline will horizontally overflow if it exceeds viewport width.
     */
    setupResponsiveColumnAdjustment() {
        // Use debounce technique to limit resize event frequency
        let resizeTimeout;
        
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                // --- Automatic column adjustment logic is disabled ---            
                /*
                // Get window width
                const windowWidth = window.innerWidth;
                
                // Minimum width per column (base width + padding)
                // Consider adjusting this if baseWidth or padding changes
                const minColumnWidth = 1064 + 40; 
                
                // Calculate maximum possible columns based on window size
                // Avoid division by zero or negative width
                const maxPossibleColumns = minColumnWidth > 0 ? Math.max(1, Math.floor(windowWidth / minColumnWidth)) : 1;
                
                // Get current column setting
                const currentSetting = parseInt(localStorage.getItem('pipelineColumns') || '1');
                
                // Adjust column count to fit within screen, up to the max of 8
                const newColumns = Math.min(currentSetting, maxPossibleColumns, 8);
                
                // Only update if column count changes and is valid
                if (newColumns > 0 && newColumns !== currentSetting) {
                    console.log(`Window resized. Adjusting columns from ${currentSetting} to ${newColumns} based on available width.`);
                    this.updatePipelineColumns(newColumns);
                    this.updateColumnButtonStates(newColumns);
                }
                */
               // Re-enable if automatic adjustment is desired in the future.
               // Currently, we prioritize keeping the user's column setting.
            }, 200); // 200ms delay to prevent excessive updates
        });
    }
}
