export class CollapseManager {
    constructor(pluginListManager) {
        this.pluginListManager = pluginListManager;
        this.pluginList = pluginListManager.pluginList;
        
        // Pull tab functionality
        this.pullTab = document.getElementById('pluginListPullTab');
        this.mainContainer = document.querySelector('.main-container');
        this.isCollapsed = false;
        
        // Sidebar button functionality
        this.sidebarButton = document.getElementById('sidebarButton');
        
        // Category collapsed state
        this.collapsedCategories = {};
        this.loadCollapsedState();
        
        this.setupPullTabFunctionality();
        this.setupTouchSwipeFunctionality();
        this.initializeAfterAppLoaded();
        
        // Initialize window width check after the app is fully loaded
        window.addEventListener('load', () => {
            this.checkWindowWidthAndAdjust();
        });
    }

    isMobileLayout() {
        return !!window.uiManager?.layoutMode?.isMobile;
    }

    // Load collapsed category state from localStorage
    loadCollapsedState() {
        try {
            const savedState = localStorage.getItem('collapsedCategories');
            if (savedState) {
                this.collapsedCategories = JSON.parse(savedState);
            }
        } catch (e) {
            console.error('Error loading collapsed categories state:', e);
            this.collapsedCategories = {};
        }
    }
    
    // Save collapsed category state to localStorage
    saveCollapsedState() {
        try {
            localStorage.setItem('collapsedCategories', JSON.stringify(this.collapsedCategories));
        } catch (e) {
            console.error('Error saving collapsed categories state:', e);
        }
    }
    
    // Toggle category collapse
    toggleCategoryCollapse(category) {
        this.collapsedCategories[category] = !this.collapsedCategories[category];
        this.saveCollapsedState();
        this.updateCategoryVisibility(category);
    }
    
    // Update the visibility of a category's plugins
    updateCategoryVisibility(category) {
        const categoryRow = this.pluginList.querySelector(`.category-row[data-category="${category}"]`);
        if (!categoryRow) return;
        
        const rightColumn = categoryRow.querySelector('.right-column-content');
        if (!rightColumn) return;
        
        const pluginItems = rightColumn.querySelector('.plugin-category-items');
        const categoryHeader = categoryRow.querySelector('h3');
        const indicator = categoryHeader.querySelector('.collapse-indicator');
        const effectsCount = rightColumn.querySelector('.category-effects-count');
        
        if (this.collapsedCategories[category]) {
            pluginItems.style.display = 'none';
            indicator.textContent = '>';
            if (effectsCount) {
                effectsCount.style.display = 'block';
            }
        } else {
            pluginItems.style.display = 'flex';
            indicator.textContent = '⌵';
            if (effectsCount) {
                effectsCount.style.display = 'none';
            }
        }
    }
    
    // Update all categories visibility
    updateAllCategoriesVisibility() {
        for (const category in this.collapsedCategories) {
            this.updateCategoryVisibility(category);
        }
    }
    
    // Toggle the collapsed state of the plugin list.
    togglePluginListCollapse() {
        if (this.isMobileLayout()) {
            window.uiManager?.mobileNav?.openPluginList();
            return;
        }
        if (!this.pluginList || !this.pullTab || !this.mainContainer) return;

        this.isCollapsed = !this.isCollapsed;
        this.pluginList.classList.toggle('collapsed', this.isCollapsed);
        this.pullTab.classList.toggle('collapsed', this.isCollapsed);
        this.mainContainer.classList.toggle('plugin-list-collapsed', this.isCollapsed);
        this.pullTab.textContent = this.isCollapsed ? '▶' : '◀';
        this.pullTab.setAttribute('aria-expanded', String(!this.isCollapsed));
        this.sidebarButton?.setAttribute('aria-expanded', String(!this.isCollapsed));
        this.updatePositions();
    }

    // Update the layout width; the tab belongs to the list's moving shell.
    updatePositions() {
        if (!this.pluginList || !this.pullTab || !this.mainContainer) return;
        const pipeline = document.getElementById('pipeline');
        if (this.isMobileLayout()) {
            this.isCollapsed = false;
            this.pluginList.classList.remove('collapsed');
            this.pullTab.classList.remove('collapsed');
            this.mainContainer?.classList?.remove('plugin-list-collapsed');
            this.pullTab.style.left = '';
            this.pullTab.textContent = '◀';
            this.pullTab.setAttribute('aria-expanded', 'true');
            this.sidebarButton?.setAttribute('aria-expanded', 'true');
            if (pipeline) {
                pipeline.style.marginLeft = '0';
                pipeline.style.transform = 'none';
            }
            return;
        }

        const width = this.pluginList.offsetWidth;
        document.documentElement.style.setProperty('--plugin-list-total-width', `${width}px`);
        if (pipeline) {
            pipeline.style.marginLeft = '';
            pipeline.style.transform = 'none';
        }
    }

    setupPullTabFunctionality() {
        if (!this.pullTab) return;
        this.pullTab.textContent = '◀';
        window.addEventListener('resize', () => {
            this.updatePositions();
            this.checkWindowWidthAndAdjust();
        });
        this.pullTab.addEventListener('click', () => this.togglePluginListCollapse());
        this.updatePositions();
    }
    // Setup touch swipe functionality to expand the collapsed plugin list
    setupTouchSwipeFunctionality() {
        // Only add touch swipe functionality if touch events are supported
        if ('ontouchstart' in window) {
            let touchStartX = 0;
            let touchEndX = 0;
            const swipeThreshold = 50; // Minimum distance required for a swipe
            
            // Add touch event listeners to the document body
            document.body.addEventListener('touchstart', (e) => {
                if (this.isMobileLayout()) return;
                touchStartX = e.touches[0].clientX;
            }, { passive: true });
            
            document.body.addEventListener('touchend', (e) => {
                if (this.isMobileLayout()) return;
                touchEndX = e.changedTouches[0].clientX;
                
                // Calculate swipe distance
                const swipeDistance = touchEndX - touchStartX;
                
                // If the plugin list is collapsed and user swipes right from left edge
                if (this.isCollapsed &&
                    touchStartX < 30 && // Only detect swipes starting from left edge
                    swipeDistance > swipeThreshold) {
                    
                    // Expand the plugin list (same as clicking the pull tab)
                    this.togglePluginListCollapse();
                }
            }, { passive: true });
        }
        
        // Connect sidebar button if it exists
        if (this.sidebarButton) {
            this.sidebarButton.addEventListener('click', () => {
                this.togglePluginListCollapse();
            });
        }
    }

    // Check and adjust the collapse state based on pipeline position relative to window edge
    checkWindowWidthAndAdjust() {
        if (this.isMobileLayout()) {
            return;
        }
        // Only proceed if the app is fully initialized
        if (!window.app || !window.app.initialized) {
            return;
        }

        const pipeline = document.getElementById('pipeline');
        if (!pipeline) return;

        const windowWidth = window.innerWidth;
        const pipelineRect = pipeline.getBoundingClientRect();
        const pipelineRightEdge = pipelineRect.right;
        const threshold = windowWidth - 20; // 20px margin from the right edge

        // If plugin list is expanded and pipeline is too close to the edge, collapse it
        if (!this.isCollapsed && pipelineRightEdge > threshold) {
            this.togglePluginListCollapse();
        }
        // If plugin list is collapsed and pipeline has enough space *after* expanding, expand it
        else if (this.isCollapsed) {
             // Estimate the pipeline's right edge position *if* the plugin list were expanded
             const pluginListWidth = this.pluginList.offsetWidth;
             // Note: When collapsed, pipeline's margin-left is negative pluginListWidth.
             // Expanding it shifts it right by pluginListWidth.
             // So the estimated right edge is roughly current right + pluginListWidth.
             const estimatedPipelineRightEdge = pipelineRightEdge + pluginListWidth + 20;

             // Expand only if the *estimated* right edge fits within the threshold
             if (estimatedPipelineRightEdge <= threshold) {
                 this.togglePluginListCollapse();
             }
        }
    }
    
    // Initialize after app is fully loaded
    initializeAfterAppLoaded() {
        // We need to wait for the app to be fully initialized
        // This means waiting for the app.initialized flag to be true
        // We'll use a MutationObserver to detect when the app is initialized
        
        // First, check if the app is already initialized
        if (window.app && window.app.initialized) {
            this.checkWindowWidthAndAdjust();
            return;
        }
        
        // If not, set up a listener for the app object
        if (!window.appInitializedListener) {
            window.appInitializedListener = true;
            
            // Create a function to check app initialization
            const checkAppInitialized = () => {
                if (window.app && window.app.initialized) {
                    // App is initialized, perform the window width check
                    this.checkWindowWidthAndAdjust();
                    return true;
                }
                return false;
            };
            
            // Try to check immediately
            if (checkAppInitialized()) {
                return;
            }
            
            // Set up a polling mechanism to check periodically
            const intervalId = setInterval(() => {
                if (checkAppInitialized()) {
                    clearInterval(intervalId);
                }
            }, 200);
            
            // Also set up a timeout to clear the interval after a reasonable time
            setTimeout(() => {
                clearInterval(intervalId);
            }, 10000); // 10 seconds max wait time
        }
    }
}
