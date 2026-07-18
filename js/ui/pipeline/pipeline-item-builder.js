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
    }

    get pipelineManager() {
        return this.pipelineCore.pipelineManager;
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

        const shouldSkipItemSelection = (target) => {
            if (!target || typeof target.closest !== 'function') {
                return true;
            }

            if (target.closest('.plugin-name, button, input, select, textarea, a, label, canvas, svg, .parameter-row')) {
                return true;
            }

            for (let element = target; element && element !== item; element = element.parentNode) {
                const className = typeof element.className === 'string' ? element.className : '';
                if (/(^|\s)[^\s]*(?:button|tab|graph|marker)[^\s]*(?=\s|$)/.test(className)) {
                    return true;
                }
            }

            return false;
        };

        // Selection handling for non-interactive areas of the pipeline item
        const selectPlugin = (e) => {
            // Prioritize controls and plugin-specific interaction surfaces.
            if (shouldSkipItemSelection(e.target)) {
                return;
            }

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

        const actions = document.createElement('div');
        actions.className = 'plugin-header-actions';
        
        if (!isSectionPlugin) {
            // Routing button
            const routingBtn = this.createRoutingButton(plugin);
            actions.appendChild(routingBtn);
        }

        // Reset parameters button
        const resetBtn = this.createResetButton(plugin);
        actions.appendChild(resetBtn);
        
        // Move up button
        const moveUpBtn = this.createMoveUpButton(plugin);
        actions.appendChild(moveUpBtn);

        // Move down button
        const moveDownBtn = this.createMoveDownButton(plugin);
        actions.appendChild(moveDownBtn);

        // Help button
        const helpBtn = this.createHelpButton(plugin);
        actions.appendChild(helpBtn);

        // AI button
        const aiBtn = this.createAIButton(plugin);
        actions.appendChild(aiBtn);

        // Delete button
        const deleteBtn = this.createDeleteButton(plugin);
        actions.appendChild(deleteBtn);

        header.appendChild(actions);

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
            // Go through setEnabled() so plugins can react to the transition
            // (e.g. analyzer plugins pause their per-frame redraw loop when
            // disabled, freeing main-thread CPU on low-power hardware).
            plugin.setEnabled(!plugin.enabled);
            toggle.classList.toggle('off', !plugin.enabled);

            // Toggling a Section's ON also bypasses every plugin inside it
            // on the worklet side. Mirror that on the main thread so the
            // analyzers inside the section pause their redraw loops too.
            if (plugin.constructor.name === 'SectionPlugin') {
                this._propagateSectionEnabledToAnimations(plugin);
            }

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
        
        // Routing icon: two phone plugs connected by an S-shaped cable (inline SVG, colored via CSS currentColor)
        routingBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true">'
            + '<path d="M17.2 1.1c2.4.2 4.3 1.5 5.3 3.3.8 1.5.4 3-1.1 4.2-2 1.6-5.5 2.3-9.9 2.5-5 .2-8.1.9-8.1 2.1 0 .7 1.5 1.4 4.3 1.8v2.3c-3.8-.5-6.1-1.9-6.8-3.6-.5-1.2.1-2.5 1.6-3.5 2.2-1.5 5.6-2.1 10-2.2 4-.2 6.6-.9 7.4-1.9.5-.6.2-1.3-.5-2.1-.8-.9-2.1-1.4-3.6-1.6z" fill="currentColor" opacity=".82" stroke="none"/>'
            + '<circle cx="1.1" cy="2.2" r=".85" fill="currentColor" opacity=".95" stroke-width=".45"/>'
            + '<rect x="1.95" y="1.25" width="1.35" height="1.9" rx=".2" fill="currentColor" opacity=".86" stroke-width=".45"/>'
            + '<rect x="3.35" y="1.45" width="5.9" height="1.5" rx=".15" fill="currentColor" opacity=".86" stroke-width=".45"/>'
            + '<rect x="9.15" y=".15" width="8.35" height="4.1" rx=".55" fill="currentColor" opacity=".9" stroke-width=".55"/>'
            + '<path d="M3.85 2.2h4.55" stroke-width=".35" opacity=".95"/>'
            + '<path d="M9.75 3.15h6.95" stroke-width=".35" opacity=".95"/>'
            + '<rect x="6.55" y="14.05" width="8.65" height="3.8" rx=".55" fill="currentColor" opacity=".9" stroke-width=".55"/>'
            + '<rect x="15.15" y="15.15" width="5.65" height="1.45" rx=".15" fill="currentColor" opacity=".86" stroke-width=".45"/>'
            + '<rect x="20.75" y="14.9" width="1.35" height="1.95" rx=".2" fill="currentColor" opacity=".86" stroke-width=".45"/>'
            + '<circle cx="23" cy="15.85" r=".85" fill="currentColor" opacity=".95" stroke-width=".45"/>'
            + '<path d="M7.15 16.95h7.35" stroke-width=".35" opacity=".95"/>'
            + '<path d="M15.75 15.9h4.25" stroke-width=".35" opacity=".95"/>'
            + '</svg>';
        
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
     * Create reset button for restoring plugin parameters to defaults
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The reset button
     */
    createResetButton(plugin) {
        const resetBtn = document.createElement('button');
        resetBtn.className = 'reset-effect-button';
        resetBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
        resetBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.resetEffect')
            : 'Reset effect settings';
        resetBtn.onclick = (e) => {
            e.stopPropagation();
            this.pipelineCore.handlePluginSelection(plugin, e);
            this.resetPluginToDefaults(plugin);
        };
        return resetBtn;
    }

    /**
     * Restore plugin parameters to the defaults captured at creation time
     * @param {Object} plugin - The plugin to reset
     */
    resetPluginToDefaults(plugin) {
        if (!plugin || typeof plugin.setParameters !== 'function') {
            return;
        }

        const defaultParameters = JSON.parse(JSON.stringify(plugin.defaultParameters || {}));
        const historyManager = this.pipelineManager && this.pipelineManager.historyManager;
        const wasUndoRedoOperation = historyManager ? historyManager.isUndoRedoOperation : false;
        const wasSuppressingHistory = plugin._suppressParameterHistory === true;

        if (plugin.saveStateTimeout) {
            clearTimeout(plugin.saveStateTimeout);
            plugin.saveStateTimeout = null;
        }

        if (historyManager) {
            historyManager.isUndoRedoOperation = true;
        }
        plugin._suppressParameterHistory = true;

        try {
            plugin.setParameters(defaultParameters);
        } finally {
            plugin._suppressParameterHistory = wasSuppressingHistory;
            plugin.paramChangeStarted = false;
            if (historyManager) {
                historyManager.isUndoRedoOperation = wasUndoRedoOperation;
            }
        }

        this.pipelineCore.updateWorkletPlugin(plugin);
        this.pipelineCore.updatePipelineUI(true);

        if (historyManager && !historyManager.isUndoRedoOperation) {
            historyManager.saveState();
        }
    }

    /**
     * Create move up button
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The move up button
     */
    createMoveUpButton(plugin) {
        const moveUpBtn = document.createElement('button');
        moveUpBtn.className = 'move-up-button';
        moveUpBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" draggable="false"><path d="M12 8l5.4 8.8H6.6z"/></svg>';
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
        moveDownBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" draggable="false"><path d="M12 16l5.4-8.8H6.6z"/></svg>';
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
     * Create AI button
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The AI button
     */
    createAIButton(plugin) {
        const aiBtn = document.createElement('button');
        aiBtn.className = 'ai-button';
        aiBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.askAI')
            : 'Ask AI about this effector';
        
        // AI icon (inline SVG, colored via CSS currentColor)
        aiBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><rect x="5" y="7" width="14" height="13" rx="3"/><path d="M12 7V4.3"/><circle cx="12" cy="3.2" r="1.3" fill="currentColor"/><rect x="1.8" y="11.4" width="2.8" height="3.6" rx="1.1"/><rect x="19.4" y="11.4" width="2.8" height="3.6" rx="1.1"/><circle cx="9.4" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="14.6" cy="12" r="1.25" fill="currentColor" stroke="none"/><path d="M9.3 15.2Q12 17.2 14.7 15.2"/></svg>';
        
        aiBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent event bubbling
            
            // Use the common selection function
            this.pipelineCore.handlePluginSelection(plugin, e);
            
            // Show AI dialog
            this.pipelineCore.showAIDialog(plugin, aiBtn);
        };
        return aiBtn;
    }

    /**
     * Create help button
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The help button
     */
    createHelpButton(plugin) {
        const helpBtn = document.createElement('button');
        helpBtn.className = 'help-button';
        helpBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><circle cx="12" cy="12" r="9.2"/><path d="M9.3 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.8 2.6-2.8 2.6"/><path d="M12 17h.02"/></svg>';
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
                const localizedPath = window.uiManager ? window.uiManager.getLocalizedDocPath(path) : path;
                
                
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
        deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';
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
        ui.className = 'plugin-ui' + (this.pipelineCore.expandedPlugins.has(plugin) ? ' expanded' : '');
        
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
        
        if (typeof plugin._disposeResponsiveGraphs === 'function') {
            plugin._disposeResponsiveGraphs();
        }
        ui.appendChild(plugin.createUI());
        return ui;
    }

    /**
     * Setup parameter update handling for a plugin
     * @param {Object} plugin - The plugin
     */
    setupParameterUpdateHandling(plugin) {
        if (plugin.updateParameters) {
            plugin.audioManager = this.audioManager;

            if (plugin._pipelineUpdateParametersWrapped) {
                return;
            }

            const originalUpdateParameters = plugin.updateParameters;
            plugin._pipelineUpdateParametersWrapped = true;
            plugin._pipelineOriginalUpdateParameters = originalUpdateParameters;

            // Add lastSaveTime property to track when the state was last saved
            plugin.lastSaveTime = 0;
            plugin.paramChangeStarted = false;
            
            plugin.updateParameters = function(...args) {
                originalUpdateParameters.apply(this, args);
                
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
                const suppressHistory = this._suppressParameterHistory === true;
                
                // If this is the first parameter change or it's been more than 500ms since the last save
                if (!suppressHistory && (!this.paramChangeStarted || (now - this.lastSaveTime > 500))) {
                    // Save state immediately for the first parameter change
                    if (this.audioManager && this.audioManager.pipelineManager) {
                        // Skip saving during pipeline switching operations
                        const historyManager = this.audioManager.pipelineManager.historyManager;
                        if (!historyManager.isUndoRedoOperation) {
                            historyManager.saveState();
                            this.lastSaveTime = now;
                            this.paramChangeStarted = true;
                        }
                    }
                }
                
                // Reset the timer for parameter changes that happen in quick succession
                if (this.saveStateTimeout) {
                    clearTimeout(this.saveStateTimeout);
                }
                
                // Set a timeout to mark the end of a parameter change session
                // and save the final state
                if (!suppressHistory) {
                    this.saveStateTimeout = setTimeout(() => {
                        // Save the final state at the end of parameter changes
                        if (this.audioManager && this.audioManager.pipelineManager) {
                            // Skip saving during pipeline switching operations
                            const historyManager = this.audioManager.pipelineManager.historyManager;
                            if (!historyManager.isUndoRedoOperation) {
                                historyManager.saveState();
                            }
                        }
                        this.paramChangeStarted = false;
                    }, 500);
                }
            }.bind(plugin);
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
                const shouldExpand = !this.pipelineCore.expandedPlugins.has(plugin);
                
                // Apply the same expand/collapse state to all plugins
                this.audioManager.pipeline.forEach(p => {
                    // Find the corresponding pipeline item using plugin ID instead of index
                    const itemEl = document.querySelector(`.pipeline-item[data-plugin-id="${p.id}"]`);
                    if (!itemEl) return;
                    
                    const pluginUI = itemEl.querySelector('.plugin-ui');
                    if (!pluginUI) return;
                    
                    if (shouldExpand) {
                        pluginUI.classList.add('expanded');
                        this.pipelineCore.expandedPlugins.add(p);
                        if (p.updateMarkers && p.updateResponse) {
                            requestAnimationFrame(() => {
                                p.updateMarkers();
                                p.updateResponse();
                            });
                        }
                    } else {
                        pluginUI.classList.remove('expanded');
                        this.pipelineCore.expandedPlugins.delete(p);
                    }
                });

                // Update all tooltips - using correct element selection
                document.querySelectorAll('.pipeline-item').forEach(item => {
                    const pluginId = parseInt(item.dataset.pluginId);
                    const p = this.audioManager.pipeline.find(plugin => plugin.id === pluginId);
                    if (!p) return;
                    
                    const nameEl = item.querySelector('.plugin-name');
                    if (!nameEl) return;
                    
                    nameEl.title = this.pipelineCore.expandedPlugins.has(p)
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
                this.pipelineCore.expandedPlugins.add(plugin);
                if (plugin.updateMarkers && plugin.updateResponse) {
                    requestAnimationFrame(() => {
                        plugin.updateMarkers();
                        plugin.updateResponse();
                    });
                }
            } else {
                this.pipelineCore.expandedPlugins.delete(plugin);
            }
            name.title = isExpanded
                ? (window.uiManager ? window.uiManager.t('ui.title.collapse') : 'Click to collapse')
                : (window.uiManager ? window.uiManager.t('ui.title.expand') : 'Click to expand');
        };
        name.title = this.pipelineCore.expandedPlugins.has(plugin)
            ? (window.uiManager ? window.uiManager.t('ui.title.collapse') : 'Click to collapse')
            : (window.uiManager ? window.uiManager.t('ui.title.expand') : 'Click to expand');
    }

    /**
     * Handle Shift+Click expansion logic
     * @param {Object} plugin - The plugin that was shift-clicked
     */
    handleShiftClickExpansion(plugin) {
        // Determine if we're expanding or collapsing based on current state
        const shouldExpand = !this.pipelineCore.expandedPlugins.has(plugin);
        
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
                        this.pipelineCore.expandedPlugins.add(p);
                        if (p.updateMarkers && p.updateResponse) {
                            requestAnimationFrame(() => {
                                p.updateMarkers();
                                p.updateResponse();
                            });
                        }
                    } else {
                        pluginUI.classList.remove('expanded');
                        this.pipelineCore.expandedPlugins.delete(p);
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
                    this.pipelineCore.expandedPlugins.add(p);
                    if (p.updateMarkers && p.updateResponse) {
                        requestAnimationFrame(() => {
                            p.updateMarkers();
                            p.updateResponse();
                        });
                    }
                } else {
                    pluginUI.classList.remove('expanded');
                    this.pipelineCore.expandedPlugins.delete(p);
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
            
            nameEl.title = this.pipelineCore.expandedPlugins.has(p)
                ? (window.uiManager ? window.uiManager.t('ui.title.collapse') : 'Click to collapse')
                : (window.uiManager ? window.uiManager.t('ui.title.expand') : 'Click to expand');
        });
    }

    // When a Section's ON/OFF state changes, pause or resume the per-frame
    // redraw loop of every plugin that belongs to that section. A section
    // spans from the toggled Section plugin up to (but not including) the
    // next Section plugin in the pipeline, matching the worklet's
    // section-active gating in plugins/audio-processor.js.
    _propagateSectionEnabledToAnimations(sectionPlugin) {
        const pipeline = this.audioManager && this.audioManager.pipeline;
        if (!pipeline) return;
        const startIdx = pipeline.indexOf(sectionPlugin);
        if (startIdx < 0) return;
        const sectionOn = sectionPlugin.enabled;
        for (let i = startIdx + 1; i < pipeline.length; i++) {
            const p = pipeline[i];
            if (p.constructor.name === 'SectionPlugin') break;
            // Update the cached section-enabled state so that subsequent
            // startAnimation() calls (e.g. from the IntersectionObserver
            // when the canvas scrolls back into view) respect it.
            if (typeof p._setSectionEnabled === 'function') {
                p._setSectionEnabled(sectionOn);
            }
        }
    }
}
