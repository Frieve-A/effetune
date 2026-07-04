import { applySerializedState } from '../../utils/serialization-utils.js';

export class PresetManager {
    constructor(pluginListManager) {
        this.pluginListManager = pluginListManager;
        this.pluginList = pluginListManager.pluginList;
        this.presetManager = null;
    }

    async initPresetManager() {
        if (!this.presetManager) {
            const { PresetManager } = await import('../../preset-manager.js');
            this.presetManager = new PresetManager();
            await this.presetManager.loadPresets();
        }
    }

    async initSystemPresetList() {
        try {
            await this.initPresetManager();
            
            let totalPresets = 0;
            const presetCountDiv = document.createElement('div');
            presetCountDiv.id = 'effectCount';
            presetCountDiv.style.textAlign = 'center';
            presetCountDiv.style.marginTop = '10px';
            presetCountDiv.style.color = '#666';
            presetCountDiv.style.fontSize = '14px';

            // Create content container for grid layout
            const contentContainer = document.createElement('div');
            contentContainer.className = 'plugin-list-content';

            // Create category sections from dynamically loaded categories (system presets only)
            for (const [category, {description, presets}] of Object.entries(this.presetManager.presetCategories)) {
                // Initialize collapsed state if not already set
                if (this.pluginListManager.collapseManager.collapsedCategories[category] === undefined) {
                    this.pluginListManager.collapseManager.collapsedCategories[category] = false; // Default to expanded
                }

                // Create explicit row for the category
                const categoryRow = this.createCategoryRow(category, presets.length, 'presets');

                // Add presets for this category
                const presetItemsContainer = categoryRow.querySelector('.plugin-category-items');
                presets.forEach(name => {
                    const presetDef = this.presetManager.presetDefinitions.get(name);
                    if (presetDef) {
                        const item = this.createPresetItem(name, presetDef);
                        presetItemsContainer.appendChild(item);
                    }
                });
                
                // Add row to container
                contentContainer.appendChild(categoryRow);
                totalPresets += presets.length;
            }

            // Add new content while preserving h2
            this.pluginList.appendChild(contentContainer);

            // Add preset count at the end of the list
            if (window.uiManager && window.uiManager.t) {
                presetCountDiv.textContent = window.uiManager.t('ui.systemPresetsAvailable', { count: totalPresets });
            } else {
                presetCountDiv.textContent = `${totalPresets} system presets available`;
            }
            this.pluginList.appendChild(presetCountDiv);

            // Hide spinner after preset list is fully initialized
            this.pluginListManager.hideLoadingSpinner();
        } catch (error) {
            console.error('Error initializing system preset list:', error);
            this.pluginListManager.hideLoadingSpinner();
        }
    }

    async initUserPresetList() {
        try {
            let totalPresets = 0;
            const presetCountDiv = document.createElement('div');
            presetCountDiv.id = 'effectCount';
            presetCountDiv.style.textAlign = 'center';
            presetCountDiv.style.marginTop = '10px';
            presetCountDiv.style.color = '#666';
            presetCountDiv.style.fontSize = '14px';

            // Create content container for grid layout
            const contentContainer = document.createElement('div');
            contentContainer.className = 'plugin-list-content';

            // Get user presets data
            const userPresetsData = await this.getUserPresetsData();
            if (userPresetsData && userPresetsData.length > 0) {
                await this.addUserPresetsCategory(contentContainer, userPresetsData);
                totalPresets = userPresetsData.length;
            }

            // Add new content while preserving h2
            this.pluginList.appendChild(contentContainer);

            // Add preset count at the end of the list
            if (window.uiManager && window.uiManager.t) {
                presetCountDiv.textContent = window.uiManager.t('ui.userPresetsAvailable', { count: totalPresets });
            } else {
                presetCountDiv.textContent = `${totalPresets} user presets available`;
            }
            this.pluginList.appendChild(presetCountDiv);

            // Hide spinner after preset list is fully initialized
            this.pluginListManager.hideLoadingSpinner();
        } catch (error) {
            console.error('Error initializing user preset list:', error);
            this.pluginListManager.hideLoadingSpinner();
        }
    }

    createCategoryRow(category, itemCount, itemType = 'effects') {
        // Create explicit row for the category
        const categoryRow = document.createElement('div');
        categoryRow.className = 'category-row';
        categoryRow.dataset.category = category;

        // Create category title with collapse indicator
        const categoryTitle = document.createElement('h3');
        
        // Create collapse indicator
        const collapseIndicator = document.createElement('span');
        collapseIndicator.className = 'collapse-indicator';
        collapseIndicator.textContent = this.pluginListManager.collapseManager.collapsedCategories[category] ? '>' : '⌵';
        collapseIndicator.style.marginRight = '6px';
        collapseIndicator.style.display = 'inline-block';
        collapseIndicator.style.width = '12px';
        
        // Add indicator and text to title
        categoryTitle.appendChild(collapseIndicator);
        categoryTitle.appendChild(document.createTextNode(category));
        
        // Add click event to toggle category
        categoryTitle.addEventListener('click', () => {
            this.pluginListManager.collapseManager.toggleCategoryCollapse(category);
        });

        // Create container for preset items
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'plugin-category-items';
        
        // Create count display for collapsed state
        const countDisplay = document.createElement('div');
        countDisplay.className = 'category-effects-count';
        countDisplay.textContent = `${itemCount} ${itemType}`;
        
        // Add title and items containers to the row (in the correct order)
        categoryRow.appendChild(categoryTitle);
        
        // Create a container for the right column content
        const rightColumnContent = document.createElement('div');
        rightColumnContent.className = 'right-column-content';
        
        // Add both the items and count to the right column
        rightColumnContent.appendChild(countDisplay);
        rightColumnContent.appendChild(itemsContainer);
        categoryRow.appendChild(rightColumnContent);
        
        // Set initial visibility based on collapsed state
        if (this.pluginListManager.collapseManager.collapsedCategories[category]) {
            itemsContainer.style.display = 'none';
            countDisplay.style.display = 'block';
        } else {
            itemsContainer.style.display = 'flex';
            countDisplay.style.display = 'none';
        }

        return categoryRow;
    }

    createPresetItem(presetName, presetDef) {
        const item = document.createElement('div');
        item.className = 'plugin-item';
        item.draggable = true;
        item.textContent = presetName;
        
        const description = document.createElement('div');
        description.className = 'plugin-description';
        description.textContent = presetDef.description;
        item.appendChild(description);

        this.setupPresetItemEvents(item, presetName);

        return item;
    }

    createUserPresetItem(presetName, description) {
        const item = document.createElement('div');
        item.className = 'plugin-item';
        item.draggable = true;
        
        // Truncate long preset names with ellipsis (accounting for the 3 dots)
        const maxLength = 20;
        const displayName = presetName.length > maxLength ? presetName.substring(0, maxLength - 3) + '...' : presetName;
        item.textContent = displayName;
        
        // Add full name as title for tooltip
        if (presetName.length > maxLength) {
            item.title = presetName;
        }
        
        const descriptionDiv = document.createElement('div');
        descriptionDiv.className = 'plugin-description';
        descriptionDiv.textContent = description;
        item.appendChild(descriptionDiv);

        this.setupUserPresetItemEvents(item, presetName);

        return item;
    }

    // Get user presets data from the preset manager
    async getUserPresetsData() {
        try {
            // Get pipeline manager's preset manager for user presets
            const pipelineManager = window.pipelineManager;
            if (!pipelineManager || !pipelineManager.presetManager) {
                return [];
            }
            
            const userPresets = typeof pipelineManager.presetManager.getLoadablePresets === 'function'
                ? await pipelineManager.presetManager.getLoadablePresets()
                : await pipelineManager.presetManager.getPresets();
            return Object.keys(userPresets)
                .sort()  // Sort alphabetically
                .map(name => ({
                    name: name,
                    description: 'User preset',
                    isUserPreset: true
                }));
        } catch (error) {
            console.error('Error getting user presets:', error);
            return [];
        }
    }

    // Add User presets category to the content container
    async addUserPresetsCategory(contentContainer, userPresetsData) {
        const category = 'User';
        
        // Initialize collapsed state if not already set
        if (this.pluginListManager.collapseManager.collapsedCategories[category] === undefined) {
            this.pluginListManager.collapseManager.collapsedCategories[category] = false; // Default to expanded
        }

        // Create category row
        const categoryRow = this.createCategoryRow(category, userPresetsData.length, 'presets');

        // Add user presets for this category
        const presetItemsContainer = categoryRow.querySelector('.plugin-category-items');
        userPresetsData.forEach(presetData => {
            const item = this.createUserPresetItem(presetData.name, presetData.name);
            presetItemsContainer.appendChild(item);
        });
        
        // Add row to container
        contentContainer.appendChild(categoryRow);
    }

    setupPresetItemEvents(item, presetName) {
        item.addEventListener('click', async (e) => {
            if (!this.isMobileLayout()) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            await this.addPresetFromListItem(presetName, { mobile: true });
        });

        // Handle double-click to add preset
        item.addEventListener('dblclick', async () => {
            await this.addPresetFromListItem(presetName);
        });

        // Setup drag events via drag drop manager
        this.pluginListManager.dragDropManager.setupPresetItemDragEvents(item, presetName, false);

        // Setup tooltip positioning
        const description = item.querySelector('.plugin-description');
        if (description) {
            item.addEventListener('mouseenter', (e) => {
                const rect = item.getBoundingClientRect();
                description.style.left = (rect.right + 10) + 'px';
                description.style.top = rect.top + 'px';
            });
        }

        // Hover effects
        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = '#3a3a3a';
        });

        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = '';
        });
    }

    setupUserPresetItemEvents(item, presetName) {
        item.addEventListener('click', async (e) => {
            if (!this.isMobileLayout()) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            await this.addUserPresetFromListItem(presetName, { mobile: true });
        });

        // Handle double-click to add user preset
        item.addEventListener('dblclick', async () => {
            await this.addUserPresetFromListItem(presetName);
        });

        // Setup drag events via drag drop manager
        this.pluginListManager.dragDropManager.setupPresetItemDragEvents(item, presetName, true);

        // Setup tooltip positioning
        const description = item.querySelector('.plugin-description');
        if (description) {
            item.addEventListener('mouseenter', (e) => {
                const rect = item.getBoundingClientRect();
                description.style.left = (rect.right + 10) + 'px';
                description.style.top = rect.top + 'px';
            });
        }

        // Hover effects
        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = '#3a3a3a';
        });

        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = '';
        });
    }

    isMobileLayout() {
        return window.uiManager?.layoutMode?.isMobile;
    }

    closeMobilePluginList() {
        window.uiManager?.mobileNav?.closePluginList();
        window.uiManager?.mobileNav?.setView('effects');
    }

    async addPresetFromListItem(presetName, { mobile = false } = {}) {
        try {
            const insertionIndex = mobile ? this.pluginListManager.getListItemInsertionIndex?.({ mobile: true }) : null;
            await this.addPresetToPipeline(presetName, insertionIndex);
            if (mobile) {
                this.closeMobilePluginList();
            }
        } catch (error) {
            console.error('Error adding preset:', error);
            if (window.uiManager) {
                window.uiManager.setError(`Error adding preset: ${error.message}`, true);
            }
        }
    }

    async addUserPresetFromListItem(presetName, { mobile = false } = {}) {
        try {
            const insertionIndex = mobile ? this.pluginListManager.getListItemInsertionIndex?.({ mobile: true }) : null;
            await this.addUserPresetToPipeline(presetName, insertionIndex);
            if (mobile) {
                this.closeMobilePluginList();
            }
        } catch (error) {
            console.error('Error adding user preset:', error);
            if (window.uiManager) {
                window.uiManager.setError(`Error adding user preset: ${error.message}`, true);
            }
        }
    }

    // Add user preset to pipeline
    async addUserPresetToPipeline(presetName, insertionIndex = null) {
        try {
            // Get pipeline manager's preset manager for user presets
            const pipelineManager = window.pipelineManager;
            if (!pipelineManager || !pipelineManager.presetManager) {
                throw new Error('Pipeline manager or preset manager not available');
            }
            
            const userPresets = await pipelineManager.presetManager.getPresets();
            const presetData = userPresets[presetName];
            
            if (!presetData) {
                throw new Error(`User preset "${presetName}" not found`);
            }

            // Get audio manager and plugin manager
            const audioManager = window.audioManager;
            const pluginManager = window.pluginManager;
            
            if (!audioManager || !pluginManager) {
                throw new Error('Required managers not available');
            }

            // Create Section plugin first (if available)
            let sectionPlugin = null;
            try {
                if (pluginManager.isPluginAvailable('Section')) {
                    sectionPlugin = pluginManager.createPlugin('Section');
                    sectionPlugin.setParameters({
                        cm: presetName
                    });
                }
            } catch (error) {
                console.warn('Section plugin not available for preset labeling:', error);
            }

            // Create plugins from preset data
            const presetPlugins = [];
            
            // Handle both old format (plugins array) and new format (pipeline array)
            let pluginDataArray = [];
            if (presetData.pipeline && Array.isArray(presetData.pipeline)) {
                // New format
                pluginDataArray = presetData.pipeline;
            } else if (presetData.plugins && Array.isArray(presetData.plugins)) {
                // Old format - convert to new format
                pluginDataArray = presetData.plugins.map(state => ({
                    name: state.nm,
                    enabled: state.en !== undefined ? state.en : true,
                    parameters: Object.fromEntries(
                        Object.entries(state).filter(([key]) => !['nm', 'en', 'ib', 'ob', 'ch'].includes(key))
                    ),
                    ...(state.ib !== undefined && { inputBus: state.ib }),
                    ...(state.ob !== undefined && { outputBus: state.ob }),
                    ...(state.ch !== undefined && { channel: state.ch })
                }));
            } else {
                throw new Error('Invalid preset data format');
            }

            for (const pluginData of pluginDataArray) {
                try {
                    const plugin = pluginManager.createPlugin(pluginData.name);
                    
                    // Create a state object in the format expected by applySerializedState
                    const state = {
                        nm: pluginData.name,
                        en: pluginData.enabled !== undefined ? pluginData.enabled : true,
                        ...(pluginData.inputBus !== undefined && { ib: pluginData.inputBus }),
                        ...(pluginData.outputBus !== undefined && { ob: pluginData.outputBus }),
                        ...(pluginData.channel !== undefined && { ch: pluginData.channel }),
                        ...pluginData.parameters
                    };
                    
                    // Apply serialized state (this includes compatibility processing)
                    applySerializedState(plugin, state);
                    
                    presetPlugins.push(plugin);
                } catch (error) {
                    console.warn(`Failed to create plugin "${pluginData.name}" from user preset:`, error);
                }
            }

            // Check if the plugin right after insertion position is a Section plugin
            const targetIndex = insertionIndex !== null ? insertionIndex : audioManager.pipeline.length;
            const isNextPluginSection = targetIndex < audioManager.pipeline.length && 
                                      audioManager.pipeline[targetIndex].name === 'Section';

            // Create end section plugin if needed (when next plugin is not Section AND not at the end of pipeline)
            let endSectionPlugin = null;
            if (!isNextPluginSection && targetIndex < audioManager.pipeline.length) {
                try {
                    if (pluginManager.isPluginAvailable('Section')) {
                        endSectionPlugin = pluginManager.createPlugin('Section');
                        endSectionPlugin.setParameters({
                            cm: ''  // Empty comment as default
                        });
                    }
                } catch (error) {
                    console.warn('Section plugin not available for end section:', error);
                }
            }

            // Prepare all plugins to add
            let allPluginsToAdd = sectionPlugin ? [sectionPlugin, ...presetPlugins] : presetPlugins;
            if (endSectionPlugin) {
                allPluginsToAdd = [...allPluginsToAdd, endSectionPlugin];
            }

            // Add to expanded plugins
            allPluginsToAdd.forEach(plugin => {
                pipelineManager.expandedPlugins.add(plugin);
            });

            // Insert into pipeline
            audioManager.pipeline.splice(targetIndex, 0, ...allPluginsToAdd);

            // Update UI and worklet
            pipelineManager.updatePipelineUI(true);
            pipelineManager.updateWorkletPlugins();
            
            // Save state for undo/redo
            if (pipelineManager.historyManager) {
                pipelineManager.historyManager.saveState();
            }

            return true;
        } catch (error) {
            console.error(`Error adding user preset "${presetName}" to pipeline:`, error);
            throw error;
        }
    }

    // Refresh the presets list if currently showing presets tab
    async refreshPresetsIfVisible() {
        if (this.pluginListManager.searchManager.currentTab === 'userPresets') {
            // Save current scroll position
            const scrollTop = this.pluginList.scrollTop;
            
            // Clear existing content first
            const existingContent = this.pluginList.querySelector('.plugin-list-content');
            if (existingContent) {
                existingContent.remove();
            }
            
            const existingCount = this.pluginList.querySelector('#effectCount');
            if (existingCount) {
                existingCount.remove();
            }
            
            // Re-initialize user preset list
            await this.initUserPresetList();
            
            // Restore scroll position
            this.pluginList.scrollTop = scrollTop;
        }
    }

    // Add preset to pipeline (for system presets)
    async addPresetToPipeline(presetName, insertionIndex = null) {
        if (!this.presetManager) {
            await this.initPresetManager();
        }
        return this.presetManager.addPresetToPipeline(presetName, insertionIndex);
    }
}
