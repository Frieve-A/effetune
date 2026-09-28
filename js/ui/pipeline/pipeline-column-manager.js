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
        const isMobile = window.uiManager?.layoutMode?.isMobile;
        
        if (decreaseBtn) {
            decreaseBtn.disabled = isMobile || columns <= 1;
        }
        
        if (increaseBtn) {
            increaseBtn.disabled = isMobile || columns >= 8;
        }
    }

    getEffectiveColumnCount(columns = this.currentColumns) {
        return window.uiManager?.layoutMode?.isMobile ? 1 : columns;
    }

    /**
     * Update pipeline column count and adjust layout
     * @param {number} columns - Number of columns to set (1-8)
     */
    updatePipelineColumns(columns) {
        if (columns < 1 || columns > 8) return; // Check valid range (1-8)
        const effectiveColumns = this.getEffectiveColumnCount(columns);
        
        // Update CSS variable for tracking number of columns
        document.documentElement.style.setProperty('--pipeline-columns', effectiveColumns);
        
        // Calculate and set pipeline width
        const baseWidth = 1064; // Base width per column
        const gap = 10; // Gap between columns (must match CSS gap value)
        const pipelineWidth = (baseWidth * effectiveColumns) + (gap * (effectiveColumns - 1));
        
        const pipeline = document.getElementById('pipeline');
        if (pipeline) {
            pipeline.style.width = window.uiManager?.layoutMode?.isMobile ? '100%' : `${pipelineWidth}px`;
            if (window.uiManager?.layoutMode?.isMobile) {
                pipeline.style.marginLeft = '0';
            }
        }
        
        // Rather than using updatePipelineUI, we'll explicitly rebuild the columns
        this.rebuildPipelineColumns(effectiveColumns);
        
        // Defer updating the pull tab position to the next animation frame.
        // This ensures layout changes (pipeline width, column rebuild) are processed
        // before reading element dimensions/positions in updatePositions.
        requestAnimationFrame(() => {
            this.updatePluginListPullTab();
        });
        
        // Save column count to localStorage for persistence
        if (!window.uiManager?.layoutMode?.isMobile) {
            localStorage.setItem('pipelineColumns', columns);
        }
        this.updateColumnButtonStates(columns);
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

        // Distribute plugins into the newly created columns
        this.distributePluginsToColumns();
    }

    /**
     * Distribute plugins to columns in a column-first manner, keeping pipeline order.
     * The split points are chosen from the measured item heights so that the tallest
     * column is as short as possible. Expanding or collapsing an effect does not call
     * this, so the columns only change when effects are added, removed, or reordered,
     * or when the column count changes.
     */
    distributePluginsToColumns() {
        const columns = this.pipelineList.querySelectorAll('.pipeline-column');
        if (!columns.length) {
            // If no columns, ensure empty state is handled correctly by updatePipelineUI
            // This might happen if pipeline becomes empty, trigger update
            if (this.audioManager.pipeline.length === 0) {
                this.pipelineCore.updatePipelineUI(true); 
            }
            return;
        }

        const columnCount = columns.length;

        // Clear all columns first to ensure clean distribution
        columns.forEach(column => {
            column.innerHTML = '';
        });

        // Lay every item out in the first column so its height can be measured
        const items = this.audioManager.pipeline.map(plugin => {
            const item = this.pipelineCore.itemBuilder.createPipelineItem(plugin); // Returns the main item element
            columns[0]?.appendChild(item);
            return item;
        });
        const measured = items.map(item => item.getBoundingClientRect().height);
        // A hidden pipeline has no layout; split by item count instead
        const heights = measured.some(height => height > 0) ? measured : measured.map(() => 1);
        const columnSizes = partitionColumns(heights, columnCount);

        let index = 0;
        columnSizes.forEach((size, columnIndex) => {
            const targetColumn = columns[columnIndex];
            for (const end = index + size; index < end; index++) {
                if (targetColumn) {
                    targetColumn.appendChild(items[index]);
                } else {
                    console.warn(`Could not find target column ${columnIndex} for plugin ${index}.`);
                }
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

/**
 * Split ordered item heights into at most columnCount contiguous columns so that the
 * tallest column is as short as possible. Earlier columns are filled first, while each
 * remaining column still receives an item when there are enough items.
 * The gap between items is the same everywhere, so it does not change the best split.
 * @param {number[]} heights - Item heights in pipeline order
 * @param {number} columnCount - Number of columns
 * @returns {number[]} Number of items in each column
 */
function partitionColumns(heights, columnCount) {
    const prefix = [0];
    heights.forEach(height => prefix.push(prefix[prefix.length - 1] + height));
    const count = heights.length;

    // tallest[i]: smallest possible tallest column for the first i items
    let tallest = prefix.slice();
    for (let column = 1; column < columnCount; column++) {
        const next = tallest.slice();
        for (let i = 1; i <= count; i++) {
            for (let j = 1; j < i; j++) {
                const segment = prefix[i] - prefix[j];
                const candidate = tallest[j] > segment ? tallest[j] : segment;
                if (candidate < next[i]) next[i] = candidate;
            }
        }
        tallest = next;
    }
    const limit = tallest[count];

    const sizes = [];
    let start = 0;
    for (let column = 0; column < columnCount; column++) {
        // Leave one item for each later column, as far as the items last
        const columnsAfter = columnCount - column - 1;
        const itemsLeft = count - start;
        const reserve = columnsAfter < itemsLeft ? columnsAfter : itemsLeft - 1;
        const stop = count - (reserve > 0 ? reserve : 0);
        let end = start;
        while (end < stop && prefix[end + 1] - prefix[start] <= limit) {
            end++;
        }
        sizes.push(end - start);
        start = end;
    }
    return sizes;
}
