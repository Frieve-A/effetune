/**
 * PipelineColumnManager - Manages column layout for the pipeline
 * Handles column count, distribution of plugins, and responsive adjustments
 */
const PIPELINE_COLUMN_WIDTH = 1064;

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
            if (!this.isAutomatic() && this.currentColumns > 1) {
                this.currentColumns--;
                this.updatePipelineColumns(this.currentColumns);
                this.updateColumnButtonStates(this.currentColumns);
            }
        });
        
        // Increase button event listener
        increaseBtn.addEventListener('click', () => {
            if (!this.isAutomatic() && this.currentColumns < 8) {
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
        const controlsDisabled = window.uiManager?.layoutMode?.isMobile || this.isAutomatic();
        
        if (decreaseBtn) {
            decreaseBtn.hidden = this.isAutomatic();
            decreaseBtn.disabled = controlsDisabled || columns <= 1;
        }
        
        if (increaseBtn) {
            increaseBtn.hidden = this.isAutomatic();
            increaseBtn.disabled = controlsDisabled || columns >= 8;
        }
    }

    getEffectiveColumnCount(columns = this.currentColumns) {
        if (window.uiManager?.layoutMode?.isMobile) return 1;
        return this.isAutomatic() ? this.getAutomaticColumnCount() : columns;
    }

    isAutomatic() {
        return window.appConfig?.pipelineColumnMode !== 'manual';
    }

    getColumnGap() {
        return typeof getComputedStyle === 'function' && this.pipelineList
            ? parseFloat(getComputedStyle(this.pipelineList).columnGap) || 10
            : 10;
    }

    getAvailablePipelineWidth() {
        const pipeline = document.getElementById('pipeline');
        const pluginList = document.getElementById('pluginList');
        if (!pipeline || !pluginList) return 0;
        const bodyStyle = getComputedStyle(document.body);
        const pipelineStyle = getComputedStyle(pipeline);
        const containerStyle = getComputedStyle(pipeline.parentElement);
        const sidebarStyle = getComputedStyle(pluginList);
        const pixels = value => parseFloat(value) || 0;
        // Reserve the full effect list even when collapsed or in a hidden view.
        let reservedWidth = pixels(bodyStyle.paddingLeft) + pixels(bodyStyle.paddingRight) +
            pixels(sidebarStyle.width) + pixels(containerStyle.columnGap) +
            pixels(pipelineStyle.paddingLeft) + pixels(pipelineStyle.paddingRight) +
            pixels(pipelineStyle.borderLeftWidth) + pixels(pipelineStyle.borderRightWidth);
        const analyzer = document.getElementById('pipelineAnalyzerPanel');
        if (analyzer && !analyzer.hidden && analyzer.parentElement === pipeline.parentElement) {
            const analyzerStyle = getComputedStyle(analyzer);
            // Reserve only the minimum width, so an expanded Analyzer cannot
            // prevent adding columns or restoring the effect list. The basis
            // also remains available while the effects view is hidden.
            reservedWidth += pixels(analyzerStyle.flexBasis) +
                pixels(containerStyle.columnGap);
        }
        const zoom = pixels(bodyStyle.zoom) || 1;
        const viewportWidth = window.uiManager?.layoutViewportWidth ?? document.documentElement.clientWidth / zoom;
        return viewportWidth - reservedWidth;
    }

    canFitWithPluginList() {
        return this.getAvailablePipelineWidth() >= PIPELINE_COLUMN_WIDTH;
    }

    getAutomaticColumnCount() {
        const availableWidth = this.getAvailablePipelineWidth();
        const gap = this.getColumnGap();
        return Math.max(1, Math.min(8, Math.floor((availableWidth + gap) / (PIPELINE_COLUMN_WIDTH + gap))));
    }

    /**
     * Update pipeline column count and adjust layout
     * @param {number} columns - Number of columns to set (1-8)
     */
    updatePipelineColumns(columns) {
        if (!Number.isInteger(columns) || columns < 1 || columns > 8) return;
        const effectiveColumns = this.getEffectiveColumnCount(columns);
        this.renderedColumns = effectiveColumns;
        
        // Update CSS variable for tracking number of columns
        document.documentElement.style.setProperty('--pipeline-columns', effectiveColumns);
        
        // Calculate and set pipeline width
        const gap = this.getColumnGap();
        const pipelineWidth = (PIPELINE_COLUMN_WIDTH * effectiveColumns) + (gap * (effectiveColumns - 1));
        
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
        if (!window.uiManager?.layoutMode?.isMobile && !this.isAutomatic()) {
            this.currentColumns = columns;
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
        this.pendingLayoutObserver?.disconnect();
        this.pendingLayoutObserver = null;
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
        const placeItems = heights => {
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
        };
        placeItems(heights);

        // Finish a hidden-view rebuild once the items have layout. Disconnect after
        // that first measurement so later effect expansion does not move columns.
        if (columnCount > 1 && items.length && !measured.some(height => height > 0) &&
            typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(() => {
                if (this.pendingLayoutObserver !== observer) return;
                const visibleHeights = items.map(item => item.getBoundingClientRect().height);
                if (!visibleHeights.some(height => height > 0)) return;
                observer.disconnect();
                this.pendingLayoutObserver = null;
                placeItems(visibleHeights);
                this.updatePluginListPullTab();
            });
            this.pendingLayoutObserver = observer;
            observer.observe(this.pipelineList);
        }

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
     */
    setupResponsiveColumnAdjustment() {
        window.addEventListener('resize', () => this.adjustColumnsToWindow());
    }

    adjustColumnsToWindow() {
        if (this.isAutomatic() && this.getEffectiveColumnCount() !== this.renderedColumns) {
            this.updatePipelineColumns(this.currentColumns);
        }
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
        this.pendingLayoutObserver?.disconnect();
        this.pendingLayoutObserver = null;
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
