export class SearchManager {
    constructor(pluginListManager) {
        this.pluginListManager = pluginListManager;
        this.pluginList = pluginListManager.pluginList;
        
        // Search functionality
        this.searchButton = document.getElementById('effectSearchButton');
        this.searchInput = document.getElementById('effectSearchInput');
        this.searchClearButton = document.getElementById('effectSearchClearButton');
        this.availableEffectsTitle = document.getElementById('availableEffectsTitle');
        this.isSearchActive = false;

        // Tab switching functionality
        this.tabSwitcher = document.getElementById('tabSwitcher');
        this.effectsTab = document.getElementById('effectsTab');
        this.systemPresetsTab = document.getElementById('systemPresetsTab');
        this.userPresetsTab = document.getElementById('userPresetsTab');
        this.currentTab = 'effects'; // 'effects', 'systemPresets', or 'userPresets'

        this.setupSearchFunctionality();
        this.setupTabSwitching();
        this.setupKeyboardShortcuts();
    }

    setupSearchFunctionality() {
        // Search button click handler
        this.searchButton.addEventListener('click', () => {
            this.isSearchActive = !this.isSearchActive;
            if (this.isSearchActive) {
                this.tabSwitcher.style.display = 'none';
                this.searchInput.style.display = 'block';
                this.searchInput.focus();
                this.searchInput.select();
                this.updateSearchClearButton();
            } else {
                this.tabSwitcher.style.display = this.isMobileLayout() ? 'grid' : 'flex';
                this.searchInput.style.display = 'none';
                this.searchInput.value = '';
                this.updateSearchClearButton();
                this.applySearchFilter('');
            }
        });

        // Search input handlers
        this.searchInput.addEventListener('input', (e) => {
            this.updateSearchClearButton();
            this.applySearchFilter(e.target.value);
        });

        if (this.searchClearButton) {
            this.searchClearButton.addEventListener('click', () => {
                this.searchInput.value = '';
                this.updateSearchClearButton();
                this.applySearchFilter('');
                this.searchInput.focus();
            });
        }

        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.searchButton.click();
            }
        });
    }

    updateSearchClearButton() {
        if (!this.searchClearButton) return;
        this.searchClearButton.classList.toggle('visible', this.isSearchActive && this.searchInput.value.length > 0);
    }

    isMobileLayout() {
        return !!globalThis.window?.uiManager?.layoutMode?.isMobile;
    }

    applySearchFilter(searchText) {
        if (this.currentTab === 'effects') {
            this.filterPlugins(searchText);
        } else if (this.currentTab === 'systemPresets' || this.currentTab === 'userPresets') {
            this.filterPresets(searchText);
        }
    }

    setupTabSwitching() {
        this.effectsTab.addEventListener('click', () => {
            if (this.currentTab !== 'effects' && !this.isSearchActive) {
                this.switchToTab('effects');
            }
        });

        this.systemPresetsTab.addEventListener('click', () => {
            if (this.currentTab !== 'systemPresets' && !this.isSearchActive) {
                this.switchToTab('systemPresets');
            }
        });

        this.userPresetsTab.addEventListener('click', () => {
            if (this.currentTab !== 'userPresets' && !this.isSearchActive) {
                this.switchToTab('userPresets');
            }
        });
    }

    setupKeyboardShortcuts() {
        // Add keyboard shortcut for search
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault(); // Prevent browser's default search
                e.stopPropagation(); // Stop event propagation
                if (this.isSearchActive) {
                    // If already searching, click twice to re-enable search
                    this.searchButton.click(); // First click to cancel
                    setTimeout(() => this.searchButton.click(), 0); // Second click to re-enable
                } else {
                    this.searchButton.click(); // Single click to enable search
                }
            }
        }, true); // Use capture phase
    }

    switchToTab(tab) {
        this.currentTab = tab;
        
        // Update tab buttons
        this.effectsTab.classList.toggle('active', tab === 'effects');
        this.systemPresetsTab.classList.toggle('active', tab === 'systemPresets');
        this.userPresetsTab.classList.toggle('active', tab === 'userPresets');
        
        // Clear existing content
        const existingContent = this.pluginList.querySelector('.plugin-list-content');
        if (existingContent) {
            existingContent.remove();
        }
        
        const existingCount = this.pluginList.querySelector('#effectCount');
        if (existingCount) {
            existingCount.remove();
        }

        if (tab === 'effects') {
            this.pluginListManager.initPluginList();
        } else if (tab === 'systemPresets') {
            this.pluginListManager.initSystemPresetList();
        } else if (tab === 'userPresets') {
            this.pluginListManager.initUserPresetList();
        }
    }

    filterPlugins(searchText) {
        const contentContainer = this.pluginList.querySelector('.plugin-list-content');
        if (!contentContainer) return;

        const categoryRows = contentContainer.querySelectorAll('.category-row');
        let totalVisibleEffects = 0;
        
        // For each category row
        categoryRows.forEach(categoryRow => {
            const categoryTitle = categoryRow.querySelector('h3');
            const rightColumn = categoryRow.querySelector('.right-column-content');
            if (!rightColumn) return;
            
            const categoryItems = rightColumn.querySelector('.plugin-category-items');
            const effectsCount = rightColumn.querySelector('.category-effects-count');
            const category = categoryRow.dataset.category;
            
            if (!categoryTitle || !categoryItems) return;

            let hasVisibleItems = false;
            const items = categoryItems.querySelectorAll('.plugin-item');
            
            // Check each plugin in this category
            items.forEach(item => {
                // Get plugin name (direct text content, excluding description)
                const pluginName = item.childNodes[0].textContent.trim();
                
                // Check if matches search criteria
                const matchesSearch = searchText === '' || 
                    categoryTitle.textContent.toLowerCase().includes(searchText.toLowerCase()) ||
                    pluginName.toLowerCase().includes(searchText.toLowerCase());
                
                // Show/hide this plugin
                item.style.display = matchesSearch ? '' : 'none';
                if (matchesSearch) {
                    hasVisibleItems = true;
                    totalVisibleEffects++;
                }
            });

            // Show/hide the entire category row based on matches
            categoryRow.style.display = hasVisibleItems ? '' : 'none';
            
            // When searching, always show the items if there are matches
            if (searchText && hasVisibleItems) {
                categoryItems.style.display = 'flex';
                if (effectsCount) effectsCount.style.display = 'none';
                // Update indicator to "expanded" state but don't change the actual state in storage
                const indicator = categoryTitle.querySelector('.collapse-indicator');
                if (indicator) indicator.textContent = '⌵';
            } else if (!searchText) {
                // When not searching, restore the previous collapsed state
                this.pluginListManager.updateCategoryVisibility(category);
            } else {
                // Hide items when searching but no matches found
                categoryItems.style.display = 'none';
                if (effectsCount) effectsCount.style.display = 'none';
            }
        });

        // Update effect count text based on search state
        const effectCountDiv = this.pluginList.querySelector('#effectCount');
        if (effectCountDiv) {
            if (window.uiManager && window.uiManager.t) {
                effectCountDiv.textContent = searchText ?
                    window.uiManager.t('ui.effectsFound', { count: totalVisibleEffects }) :
                    window.uiManager.t('ui.effectsAvailable', { count: totalVisibleEffects });
            } else {
                effectCountDiv.textContent = searchText ?
                    `${totalVisibleEffects} effects found` :
                    `${totalVisibleEffects} effects available`;
            }
        }
    }

    filterPresets(searchText) {
        const contentContainer = this.pluginList.querySelector('.plugin-list-content');
        if (!contentContainer) return;

        const categoryRows = contentContainer.querySelectorAll('.category-row');
        let totalVisiblePresets = 0;
        
        // For each category row
        categoryRows.forEach(categoryRow => {
            const categoryTitle = categoryRow.querySelector('h3');
            const rightColumn = categoryRow.querySelector('.right-column-content');
            if (!rightColumn) return;
            
            const categoryItems = rightColumn.querySelector('.plugin-category-items');
            const presetsCount = rightColumn.querySelector('.category-effects-count');
            const category = categoryRow.dataset.category;
            
            if (!categoryTitle || !categoryItems) return;

            let hasVisibleItems = false;
            const items = categoryItems.querySelectorAll('.plugin-item');
            
            // Check each preset in this category
            items.forEach(item => {
                // Get preset name (direct text content, excluding description)
                const presetName = item.childNodes[0].textContent.trim();
                
                // Check if matches search criteria
                const matchesSearch = searchText === '' || 
                    categoryTitle.textContent.toLowerCase().includes(searchText.toLowerCase()) ||
                    presetName.toLowerCase().includes(searchText.toLowerCase());
                
                // Show/hide this preset
                item.style.display = matchesSearch ? '' : 'none';
                if (matchesSearch) {
                    hasVisibleItems = true;
                    totalVisiblePresets++;
                }
            });

            // Show/hide the entire category row based on matches
            categoryRow.style.display = hasVisibleItems ? '' : 'none';
            
            // When searching, always show the items if there are matches
            if (searchText && hasVisibleItems) {
                categoryItems.style.display = 'flex';
                if (presetsCount) presetsCount.style.display = 'none';
                // Update indicator to "expanded" state but don't change the actual state in storage
                const indicator = categoryTitle.querySelector('.collapse-indicator');
                if (indicator) indicator.textContent = '⌵';
            } else if (!searchText) {
                // When not searching, restore the previous collapsed state
                this.pluginListManager.updateCategoryVisibility(category);
            } else {
                // Hide items when searching but no matches found
                categoryItems.style.display = 'none';
                if (presetsCount) presetsCount.style.display = 'none';
            }
        });

        // Update preset count text based on search state
        const effectCountDiv = this.pluginList.querySelector('#effectCount');
        if (effectCountDiv) {
            effectCountDiv.textContent = searchText ?
                `${totalVisiblePresets} presets found` :
                `${totalVisiblePresets} presets available`;
        }
    }
}
