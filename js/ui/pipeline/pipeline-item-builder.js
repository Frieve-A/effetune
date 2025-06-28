/**
 * PipelineItemBuilder - Responsible for creating pipeline item UI elements
 * Handles the visual representation of plugins in the pipeline
 */
export class PipelineItemBuilder {
    /**
     * Create a new PipelineItemBuilder instance
     * @param {PipelineCore} pipelineCore - Reference to pipeline core instance
     */
    constructor(pipelineCore) {
        this.pipelineCore = pipelineCore;
        this.audioManager = pipelineCore.audioManager;
        this.pluginManager = pipelineCore.pluginManager;
        this.expandedPlugins = pipelineCore.expandedPlugins;
        this.pipelineManager = pipelineCore.pipelineManager;
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
        const header = this.createHeader(plugin, item);
        item.appendChild(header);

        // Plugin UI container
        const ui = this.createPluginUI(plugin);
        item.appendChild(ui);

        // Toggle UI visibility and handle selection
        const name = header.querySelector('.plugin-name');
        this.setupNameClickHandler(name, plugin, ui);

        // Setup drag events (will be handled by UIEventHandler)
        const handle = header.querySelector('.handle');
        if (this.pipelineManager && this.pipelineManager.uiEventHandler) {
            this.pipelineManager.uiEventHandler.setupDragEvents(handle, item, plugin);
        }

        return item;
    }

    /**
     * Create the header container for a pipeline item
     * @param {Object} plugin - The plugin
     * @param {HTMLElement} item - The pipeline item element
     * @returns {HTMLElement} The header element
     */
    createHeader(plugin, item) {
        const header = document.createElement('div');
        header.className = 'pipeline-item-header';
        const isSectionPlugin = plugin.name == 'Section';

        // Selection handling for entire pipeline item
        const selectPlugin = (e) => {
            // Prioritize UI item events
            if (e.target.closest('.plugin-ui') || 
                e.target.classList.contains('plugin-name') || 
                e.target.tagName === 'BUTTON' || 
                e.target.closest('button')) {
                return;
            }

            // Stop event propagation
            e.stopPropagation();

            // Special handling for Ctrl/Cmd click to toggle selection
            if (e.ctrlKey || e.metaKey) {
                if (this.pipelineCore.selectedPlugins.has(plugin)) {
                    this.pipelineCore.selectedPlugins.delete(plugin);
                    this.pipelineCore.updateSelectionClasses();
                } else {
                    this.pipelineCore.handlePluginSelection(plugin, e, false);
                }
            } else {
                // Special handling for Section plugin - select from this section to next section
                if (plugin.constructor.name === 'SectionPlugin') {
                    this.pipelineCore.handleSectionSelection(plugin, e);
                } else {
                    // Single selection on normal click
                    this.pipelineCore.handlePluginSelection(plugin, e);
                }
            }
        };
        
        // Detect click/touch events for entire pipeline-item
        item.addEventListener('click', selectPlugin);
        item.addEventListener('touchstart', selectPlugin);
        
        // Handle for reordering
        const handle = this.createHandle(selectPlugin);
        header.appendChild(handle);

        // Enable/disable toggle
        const toggle = this.createToggleButton(plugin);
        header.appendChild(toggle);

        // Plugin name
        const name = this.createPluginName(plugin);
        header.appendChild(name);

        // Display bus routing info if set
        this.addBusInfo(header, plugin, item);
        
        if (!isSectionPlugin) {
            // Routing button
            const routingBtn = this.createRoutingButton(plugin);
            header.appendChild(routingBtn);
        }
        
        // Move up button
        const moveUpBtn = this.createMoveUpButton(plugin);
        header.appendChild(moveUpBtn);

        // Move down button
        const moveDownBtn = this.createMoveDownButton(plugin);
        header.appendChild(moveDownBtn);

        // Help button
        const helpBtn = this.createHelpButton(plugin);
        header.appendChild(helpBtn);

        // Delete button
        const deleteBtn = this.createDeleteButton(plugin);
        header.appendChild(deleteBtn);

        return header;
    }

    /**
     * Create handle element for reordering
     * @param {Function} selectPlugin - The selection handler
     * @returns {HTMLElement} The handle element
     */
    createHandle(selectPlugin) {
        const handle = document.createElement('div');
        handle.className = 'handle';
        handle.innerHTML = '⋮';
        handle.draggable = true;
        handle.addEventListener('mousedown', selectPlugin);
        return handle;
    }

    /**
     * Create toggle button for enabling/disabling plugin
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The toggle button
     */
    createToggleButton(plugin) {
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
            this.pipelineCore.handlePluginSelection(plugin, e);
            
            // Update worklet directly without rebuilding pipeline
            this.pipelineCore.updateWorkletPlugin(plugin);
            
            // Update UI display state for all plugins that might be affected by this change
            this.pipelineCore.updateAllPluginDisplayState();
            
            // Save state for undo/redo
            if (this.pipelineManager && this.pipelineManager.historyManager) {
                this.pipelineManager.historyManager.saveState();
            }
        };
        return toggle;
    }

    /**
     * Create plugin name element
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The name element
     */
    createPluginName(plugin) {
        const name = document.createElement('div');
        name.className = 'plugin-name';
        if (plugin.name === 'Section' && plugin.cm && plugin.cm !== '') {
            name.textContent = `${plugin.cm} Section`;
        } else {
            name.textContent = plugin.name;
        }
        
        // Update the plugin name display state based on section status
        this.pipelineCore.updatePluginNameDisplayState(plugin, name);
        
        return name;
    }

    /**
     * Add bus info to header if needed
     * @param {HTMLElement} header - The header element
     * @param {Object} plugin - The plugin
     * @param {HTMLElement} item - The pipeline item
     */
    addBusInfo(header, plugin, item) {
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
                this.pipelineCore.handlePluginSelection(plugin, e);
                
                // Show routing dialog
                const routingBtn = item.querySelector('.routing-button');
                this.pipelineCore.showRoutingDialog(plugin, routingBtn || busInfo);
            };
            
            header.appendChild(busInfo);
        }
    }

    /**
     * Create routing button
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The routing button
     */
    createRoutingButton(plugin) {
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
            this.pipelineCore.handlePluginSelection(plugin, e);
            
            // Show routing dialog
            this.pipelineCore.showRoutingDialog(plugin, routingBtn);
        };
        return routingBtn;
    }

    /**
     * Create move up button
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The move up button
     */
    createMoveUpButton(plugin) {
        const moveUpBtn = document.createElement('button');
        moveUpBtn.className = 'move-up-button';
        moveUpBtn.textContent = '▲';
        moveUpBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.moveUp')
            : 'Move effect up';
        moveUpBtn.onclick = (e) => {
            // Use the common selection function
            this.pipelineCore.handlePluginSelection(plugin, e);
            
            // Check if this is a Section plugin with Shift+click
            if (plugin.constructor.name === 'SectionPlugin' && e.shiftKey) {
                this.pipelineCore.moveSectionUp(plugin);
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
                this.pipelineCore.updateWorkletPlugins();
                
                // Update UI display state for all plugins
                this.pipelineCore.updateAllPluginDisplayState();
                
                // Save state for undo/redo
                if (this.pipelineManager && this.pipelineManager.historyManager) {
                    this.pipelineManager.historyManager.saveState();
                }
                
                // Update UI
                this.pipelineCore.updatePipelineUI();
            }
        };
        return moveUpBtn;
    }

    /**
     * Create move down button
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The move down button
     */
    createMoveDownButton(plugin) {
        const moveDownBtn = document.createElement('button');
        moveDownBtn.className = 'move-down-button';
        moveDownBtn.textContent = '▼';
        moveDownBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.moveDown')
            : 'Move effect down';
        moveDownBtn.onclick = (e) => {
            // Use the common selection function
            this.pipelineCore.handlePluginSelection(plugin, e);
            
            // Check if this is a Section plugin with Shift+click
            if (plugin.constructor.name === 'SectionPlugin' && e.shiftKey) {
                this.pipelineCore.moveSectionDown(plugin);
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
                this.pipelineCore.updateWorkletPlugins();
                
                // Update UI display state for all plugins
                this.pipelineCore.updateAllPluginDisplayState();
                
                // Save state for undo/redo
                if (this.pipelineManager && this.pipelineManager.historyManager) {
                    this.pipelineManager.historyManager.saveState();
                }
                
                // Update UI
                this.pipelineCore.updatePipelineUI();
            }
        };
        return moveDownBtn;
    }

    /**
     * Create help button
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The help button
     */
    createHelpButton(plugin) {
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
            this.pipelineCore.handlePluginSelection(plugin, e);
        };
        return helpBtn;
    }

    /**
     * Create delete button
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The delete button
     */
    createDeleteButton(plugin) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-button';
        deleteBtn.textContent = '✖';
        deleteBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.deleteEffect')
            : 'Delete effect';
        deleteBtn.onclick = (e) => {
            // Special handling for Section plugin with Shift+Click - delete entire section
            if (plugin.constructor.name === 'SectionPlugin' && e.shiftKey) {
                this.pipelineCore.deleteSectionRange(plugin);
            } else {
                // Use the common selection function
                this.pipelineCore.handlePluginSelection(plugin, e);
                
                // Use the common delete function
                this.pipelineCore.deleteSelectedPlugins();
            }
        };
        return deleteBtn;
    }

    /**
     * Create plugin UI container
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The UI container
     */
    createPluginUI(plugin) {
        const ui = document.createElement('div');
        ui.className = 'plugin-ui' + (this.expandedPlugins.has(plugin) ? ' expanded' : '');
        
        // Optimize parameter update handling to avoid unnecessary pipeline rebuilds
        this.setupParameterUpdateHandling(plugin);
        
        ui.addEventListener('mousedown', (e) => {
            if (e.target.matches('input, button, select')) {
                if (e.target.matches('input[type="range"]')) {
                    return;
                }
                
                // Use the common selection function
                this.pipelineCore.handlePluginSelection(plugin, e);
            }
        });
        
        ui.appendChild(plugin.createUI());
        return ui;
    }

    /**
     * Setup parameter update handling for a plugin
     * @param {Object} plugin - The plugin
     */
    setupParameterUpdateHandling(plugin) {
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
    }

    /**
     * Setup name click handler
     * @param {HTMLElement} name - The name element
     * @param {Object} plugin - The plugin
     * @param {HTMLElement} ui - The UI container
     */
    setupNameClickHandler(name, plugin, ui) {
        name.onclick = (e) => {
            // Ctrl/Cmd+Click collapses or expands all effects based on the clicked effect's state
            if (e.ctrlKey || e.metaKey) {
                // Only handle normal selection without modifying selectedPlugins set for Ctrl+Click on name
                this.pipelineCore.handlePluginSelection(plugin, e);
                
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
                this.pipelineCore.handleSectionSelection(plugin, e);
            } else {
                this.pipelineCore.handlePluginSelection(plugin, e);
            }
            
            // Handle Shift+Click to collapse/expand effects
            if (e.shiftKey) {
                this.handleShiftClickExpansion(plugin);
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
    }

    /**
     * Handle Shift+Click expansion logic
     * @param {Object} plugin - The plugin that was shift-clicked
     */
    handleShiftClickExpansion(plugin) {
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
    }
}