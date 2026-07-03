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
        
        // Animation state
        this.animationFrameId = null;
        this.handleTransitionEnd = null;
        
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
    
    // Toggle the collapsed state of the plugin list
    togglePluginListCollapse() {
        if (this.isMobileLayout()) {
            window.uiManager?.mobileNav?.openPluginList();
            return;
        }
        this.isCollapsed = !this.isCollapsed;
        
        const pipeline = document.getElementById('pipeline');
        if (!this.pluginList || !this.pullTab || !this.mainContainer || !pipeline) return;

        // --- Cleanup previous state --- 
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.handleTransitionEnd) {
            this.pluginList.removeEventListener('transitionend', this.handleTransitionEnd);
        }

        // --- Define transitionend handler --- 
        this.handleTransitionEnd = (event) => {
            // Check if the transition that ended was for the transform property
            if (event.propertyName === 'transform' && event.target === this.pluginList) {
                // Stop the rAF loop
                if (this.animationFrameId) {
                    cancelAnimationFrame(this.animationFrameId);
                    this.animationFrameId = null;
                }
                // Set the final static positions explicitly
                this.updatePositions(); 
                // Clean up the listener itself
                this.pluginList.removeEventListener('transitionend', this.handleTransitionEnd);
                this.handleTransitionEnd = null; // Reset handler reference
            }
        };
        
        // Add the listener before triggering the transition
        this.pluginList.addEventListener('transitionend', this.handleTransitionEnd);

        // --- Trigger CSS transition and JS animation --- 
        if (this.isCollapsed) {
            // Add classes to trigger pluginList transform
            this.pluginList.classList.add('collapsed');
            this.pullTab.classList.add('collapsed');
            this.mainContainer.classList.add('plugin-list-collapsed');
            this.pullTab.textContent = '▶'; 
            // Start JS animation loop to make followers track the list
            this.animateFollowers(); 
        } else {
            // Remove classes to trigger pluginList transform
            this.pluginList.classList.remove('collapsed');
            this.pullTab.classList.remove('collapsed');
            this.mainContainer.classList.remove('plugin-list-collapsed');
            this.pullTab.textContent = '◀'; 
            // Start JS animation loop
            this.animateFollowers();
        }
    }

    // Renamed and refined animation loop
    animateFollowers() {
        const pipeline = document.getElementById('pipeline');
        if (!pipeline || !this.pluginList || !this.pullTab) return; 

        // Get initial values needed for progress calculation
        const pluginListWidth = this.pluginList.offsetWidth;
        // Calculate the fully expanded left position (typically body padding)
        // We use offsetLeft relative to its parent, assuming parent starts after body padding
        const expandedListLeftCssPixel = parseFloat(window.getComputedStyle(document.body).paddingLeft) || 20;
        const collapsedListLeftCssPixel = expandedListLeftCssPixel - pluginListWidth;
        
        const step = () => {
            // Get current position of the list
            const pluginListRect = this.pluginList.getBoundingClientRect();
            const currentListLeftViewport = pluginListRect.left;
            const currentListRightViewport = pluginListRect.right;
            const currentListWidthViewport = pluginListRect.width;

            // Calculate zoom ratio to correct coordinates
            let zoomRatio = 1;
            if (pluginListWidth > 0 && currentListWidthViewport > 0) {
                zoomRatio = currentListWidthViewport / pluginListWidth;
            }
            // Calculate corrected positions in CSS pixels
            const currentListLeftCssPixel = currentListLeftViewport / zoomRatio;
            const targetPullTabLeftCssPixel = currentListRightViewport / zoomRatio;
            
            // Calculate pipeline margin based on transition progress (using CSS pixel values)
            let progress = 0;
            // Avoid division by zero if width is somehow 0
            if (pluginListWidth > 0) { 
                 // Clamp progress between 0 and 1
                 progress = Math.max(0, Math.min(1, 
                    (currentListLeftCssPixel - expandedListLeftCssPixel) / (collapsedListLeftCssPixel - expandedListLeftCssPixel)
                 ));
            }
            // Interpolate marginLeft from 0 to -pluginListWidth
            const targetPipelineMarginLeft = progress * (-pluginListWidth);
            
            // Apply styles directly (no CSS transition)
            this.pullTab.style.left = `${Math.round(targetPullTabLeftCssPixel)}px`;
            pipeline.style.marginLeft = `${Math.round(targetPipelineMarginLeft)}px`; 
            pipeline.style.transform = 'none'; // Ensure no competing transform
            
            // Schedule next frame if animation should continue
            if (this.handleTransitionEnd) { 
                 this.animationFrameId = requestAnimationFrame(step);
            } else {
                 this.animationFrameId = null;
            }
        };
        
        // Cancel any previous frame and start the new animation loop
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = requestAnimationFrame(step);
    }

    /**
     * Update positions for static states (init, resize) 
     * Also sets the final state after animations via transitionend handler.
     */
    updatePositions() {
        if (!this.pluginList || !this.pullTab) return; 

        // Stop animation if running (e.g., resize during animation)
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        // Remove listener if it exists (e.g., resize interrupted transition)
         if (this.handleTransitionEnd) {
            this.pluginList.removeEventListener('transitionend', this.handleTransitionEnd);
            this.handleTransitionEnd = null;
        }

        if (this.isMobileLayout()) {
            const pipeline = document.getElementById('pipeline');
            this.pluginList.classList.remove('collapsed');
            this.pullTab.classList.remove('collapsed');
            this.mainContainer?.classList?.remove('plugin-list-collapsed');
            this.pullTab.style.left = '';
            this.pullTab.textContent = '◀';
            if (pipeline) {
                pipeline.style.marginLeft = '0';
                pipeline.style.transform = 'none';
            }
            return;
        }

        // Calculate necessary values for static state
        const pluginListWidth = this.pluginList.offsetWidth; 
        const pluginListRect = this.pluginList.getBoundingClientRect();
        // Calculate zoom ratio to correct coordinates obtained from getBoundingClientRect
        let zoomRatio = 1;
        if (pluginListWidth > 0 && pluginListRect.width > 0) {
            zoomRatio = pluginListRect.width / pluginListWidth;
        }
        // Correct the right position based on the zoom ratio
        const correctedRightPosition = pluginListRect.right / zoomRatio;

        // Set CSS variable (might be useful elsewhere, keep it)
        document.documentElement.style.setProperty('--plugin-list-total-width', `${pluginListWidth}px`);

        // Get the pipeline element
        const pipeline = document.getElementById('pipeline');
        if (!pipeline) return; 

        // Apply static positions based on the current state
        if (!this.isCollapsed) {
             this.pullTab.style.left = `${Math.round(correctedRightPosition)}px`;
             pipeline.style.marginLeft = '0';
        } else {
             this.pullTab.style.left = '0px';
             pipeline.style.marginLeft = `-${pluginListWidth}px`; 
        }
        pipeline.style.transform = 'none'; 
    }
    
    setupPullTabFunctionality() {
        if (!this.pullTab) return;
        
        // Set initial state - pull tab shows ◀ when expanded
        this.pullTab.textContent = '◀';
        
        // Get the pipeline element
        const pipeline = document.getElementById('pipeline');
        
        // Store the original position of the pull tab
        let originalExpandedPosition = null;
        
        // Store the original position in the instance variable
        this.originalExpandedPosition = null;
        
        // Update positions and check window width on resize
        window.addEventListener('resize', () => {
            this.updatePositions();
            this.checkWindowWidthAndAdjust();
        });
        
        this.pullTab.addEventListener('click', () => {
            // Use the togglePluginListCollapse method to handle the collapse/expand functionality
            this.togglePluginListCollapse();
        });
        
        // Initial position update
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
