/**
 * PipelineColumnManager - Manages column layout for the pipeline
 * Handles column count, distribution of plugins, and responsive adjustments
 */
export class PipelineColumnManager {
    /**
     * Create a new PipelineColumnManager instance
     * @param {PipelineCore} pipelineCore - Reference to pipeline core instance
     */
    constructor(pipelineCore) {
        this.pipelineCore = pipelineCore;
        this.audioManager = pipelineCore.audioManager;
        this.pipelineList = pipelineCore.pipelineList;
        this.currentColumns = 1;
        
        // Initialize with saved column count
        const savedColumns = localStorage.getItem('pipelineColumns');
        if (savedColumns) {
            this.currentColumns = parseInt(savedColumns);
        }
    }

    /**
     * Set up column control for the pipeline
     * This method initializes the column control buttons and their event handlers
     */
    setupColumnControl() {
        const decreaseBtn = document.getElementById('decreaseColumnsButton');
        const increaseBtn = document.getElementById('increaseColumnsButton');
        if (!decreaseBtn || !increaseBtn) return;
        
        // Set initial column count
        this.updatePipelineColumns(this.currentColumns);
        
        // Update button states
        this.updateColumnButtonStates(this.currentColumns);
        
        // Decrease button event listener
        decreaseBtn.addEventListener('click', () => {
            if (this.currentColumns > 1) {
                this.currentColumns--;
                this.updatePipelineColumns(this.currentColumns);
                this.updateColumnButtonStates(this.currentColumns);
            }
        });
        
        // Increase button event listener
        increaseBtn.addEventListener('click', () => {
            if (this.currentColumns < 8) {
                this.currentColumns++;
                this.updatePipelineColumns(this.currentColumns);
                this.updateColumnButtonStates(this.currentColumns);
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
                this.pipelineCore.updatePipelineUI(true); 
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
            const item = this.pipelineCore.itemBuilder.createPipelineItem(plugin); // Returns the main item element

            // --- Correctly get handle AFTER creating item ---
            const handle = item.querySelector('.handle');

            // Determine target column index
            const columnIndex = Math.floor(index / pluginsPerColumn);
            const targetColumn = columns[Math.min(columnIndex, columnCount - 1)];

            if (targetColumn) {
                targetColumn.appendChild(item);
                // --- Setup drag events AFTER appending and having the handle ---
                if (this.pipelineCore.pipelineManager && this.pipelineCore.pipelineManager.uiEventHandler && handle) {
                    this.pipelineCore.pipelineManager.uiEventHandler.setupDragEvents(handle, item, plugin);
                } else if (!handle) {
                     console.warn(`No handle found for plugin item ${index} to set up drag events.`);
                } else if (!this.pipelineCore.pipelineManager?.uiEventHandler) {
                    console.warn("uiEventHandler not available in PipelineCore to set up drag events.");
                }
            } else {
                 console.warn(`Could not find target column ${columnIndex} for plugin ${index}.`);
            }
        });

        // Update selection classes after distributing
        this.pipelineCore.updateSelectionClasses();
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

    /**
     * Get current column count
     * @returns {number} Current number of columns
     */
    getCurrentColumns() {
        return this.currentColumns;
    }

    /**
     * Handle empty pipeline state
     */
    handleEmptyPipelineState() {
        const pipelineEmptyElement = this.pipelineList.querySelector('#pipelineEmpty'); 
        
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
    }

    /**
     * Handle non-empty pipeline state
     */
    handleNonEmptyPipelineState() {
        const pipelineEmptyElement = this.pipelineList.querySelector('#pipelineEmpty'); 
        
        this.pipelineList.classList.remove('is-empty');
        if (pipelineEmptyElement) { 
             pipelineEmptyElement.style.display = 'none';
        }
    }
}