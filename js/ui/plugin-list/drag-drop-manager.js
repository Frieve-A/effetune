export class DragDropManager {
    constructor(pluginListManager) {
        this.pluginListManager = pluginListManager;
        
        // Create drag message element
        this.dragMessage = document.createElement('div');
        this.dragMessage.className = 'drag-message';
        this.dragMessage.style.position = 'absolute';
        this.dragMessage.style.top = '640px';
        this.dragMessage.style.left = '50%';
        this.dragMessage.style.transform = 'translate(-50%, -50%)';
        this.dragMessage.style.textAlign = 'center';
        this.dragMessage.style.whiteSpace = 'pre';
        this.dragMessage.style.fontSize = '16px';
        this.dragMessage.style.lineHeight = '1.8';
        this.dragMessage.style.maxWidth = '100%';
        // Set drag message text (will be updated by UIManager.updateUITexts)
        this.dragMessage.textContent = 'Drag this effect to add it at your desired position in the Effect Pipeline.\nAlternatively, you can double-click this effect to add it to the Effect Pipeline.';
        document.getElementById('pipeline').appendChild(this.dragMessage);

        // Create insertion indicator
        this.insertionIndicator = document.createElement('div');
        this.insertionIndicator.className = 'insertion-indicator';
        document.getElementById('pipeline').appendChild(this.insertionIndicator);

        // Throttle state
        this.lastDragOverTime = 0;
        this.dragOverThrottleDelay = 100;
        this.rafId = null;
    }

    // Throttle function with RAF
    throttle(func, delay) {
        const now = Date.now();
        if (now - this.lastDragOverTime >= delay) {
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
            }
            this.rafId = requestAnimationFrame(() => {
                func();
                this.lastDragOverTime = now;
                this.rafId = null;
            });
        }
    }

    /**
     * Finds the potential insertion target (column and item indices) based on coordinates using elementFromPoint.
     * @param {number} clientX - Raw viewport X coordinate.
     * @param {number} clientY - Raw viewport Y coordinate.
     * @returns {{columnIndex: number|null, itemIndex: number|null}} 
     *          The index of the target column, and the index within that column (null if no valid target).
     */
    findPotentialInsertionTarget(clientX, clientY) {
        // Use elementFromPoint to find the element directly under the cursor
        const hoveredElement = document.elementFromPoint(clientX, clientY);
        if (!hoveredElement) {
            return { columnIndex: null, itemIndex: null };
        }

        // Find the pipeline list and potential parent column/item
        const targetColumn = hoveredElement.closest('.pipeline-column');
        const targetItemElement = hoveredElement.closest('.pipeline-item');
        const pipelineList = document.getElementById('pipelineList'); // Need the container
        
        if (!targetColumn || !pipelineList) {
            // If not hovering over a column, check if hovering over the pipeline list itself
            if (pipelineList && pipelineList.contains(hoveredElement)) {
                // Hovering over the empty list background or between columns
                // Try to determine the nearest column based on X coordinate
                const columns = Array.from(pipelineList.querySelectorAll('.pipeline-column'));
                if (columns.length === 0) {
                    // No columns exist yet (empty pipeline), target the conceptual first column
                    return { columnIndex: 0, itemIndex: 0 };
                }
                // Find the column whose horizontal range contains clientX
                let bestColumnIndex = 0; // Default to first column
                for (let i = 0; i < columns.length; i++) {
                    const colRect = columns[i].getBoundingClientRect();
                    if (clientX >= colRect.left && clientX <= colRect.right) {
                        bestColumnIndex = i;
                        break;
                    }
                    // If beyond the last column's right edge, target the last column
                    if (i === columns.length - 1 && clientX > colRect.right) {
                         bestColumnIndex = i;
                    }
                }
                // Determine item index within the chosen column (likely the end if hovering in gap)
                const chosenColumn = columns[bestColumnIndex];
                const itemsInChosenColumn = Array.from(chosenColumn.children);
                let itemIndexInChosen = itemsInChosenColumn.length; // Default to end
                for (let i = 0; i < itemsInChosenColumn.length; i++) {
                     const itemRect = itemsInChosenColumn[i].getBoundingClientRect();
                     const midpointY = itemRect.top + itemRect.height / 2;
                     if (clientY < midpointY) {
                         itemIndexInChosen = i;
                         break;
                     }
                 }
                 return { columnIndex: bestColumnIndex, itemIndex: itemIndexInChosen };
            }
            // Otherwise, not a valid target within the pipeline
            return { columnIndex: null, itemIndex: null };
        }

        const columns = Array.from(pipelineList.querySelectorAll('.pipeline-column'));
        const columnIndex = columns.indexOf(targetColumn);
        // If somehow the column exists but is not in the list query, treat as invalid
        // Example: Drag starts, UI updates, then drag event fires with stale targetColumn reference.
        if (columnIndex === -1) {
             // console.warn("Target column found but not in current list query results.");
             return { columnIndex: null, itemIndex: null };
        }

        const items = Array.from(targetColumn.children);
        let itemIndex = null;

        if (targetItemElement && targetColumn.contains(targetItemElement)) {
            // Hovering directly over an item or its child
            const itemRect = targetItemElement.getBoundingClientRect();
            const midpointY = itemRect.top + itemRect.height / 2;
            
            // Determine if cursor is above or below the midpoint
            if (clientY < midpointY) {
                itemIndex = items.indexOf(targetItemElement); // Insert before this item
            } else {
                itemIndex = items.indexOf(targetItemElement) + 1; // Insert after this item
            }
        } else {
            // Hovering over the column itself or the gap between items
            // Iterate through items to find where clientY falls relative to item midpoints
            itemIndex = items.length; // Default to end of column
            for (let i = 0; i < items.length; i++) {
                const itemRect = items[i].getBoundingClientRect();
                // If the column is empty, midpoint calculation might be off,
                // but the loop won't run anyway. If there are items, proceed.
                let midpointY = itemRect.top + itemRect.height / 2;
                // Handle potential zero-height items if necessary
                if (itemRect.height === 0) {
                    midpointY = itemRect.top;
                }
                if (clientY < midpointY) {
                    itemIndex = i;
                    break;
                }
            }
        }

        return { columnIndex, itemIndex };
    }

    // Update insertion indicator using the calculated target and corrected coordinates for rendering
    updateInsertionIndicator(clientX, clientY) {
        // Find the logical target using the elementFromPoint method (uses raw coordinates)
        const targetInfo = this.findPotentialInsertionTarget(clientX, clientY);
        const targetColumnIndex = targetInfo.columnIndex;
        const targetItemIndex = targetInfo.itemIndex;

        const indicator = this.getInsertionIndicator();
        const columns = document.querySelectorAll('.pipeline-column');
        const pipelineListElement = document.getElementById('pipelineList'); // Needed for scroll context and offsetTop
        const pipelineContainer = document.getElementById('pipeline'); // Indicator's expected offsetParent

        if (targetColumnIndex === null || !indicator || !pipelineListElement || !pipelineContainer) {
            if (indicator) indicator.style.display = 'none';
            return;
        }

        const listOffsetTopInPipeline = pipelineListElement.offsetTop;
        const listOffsetLeftInPipeline = pipelineListElement.offsetLeft; // Moved declaration here

        // Handle empty pipeline case (no columns rendered)
        if (columns.length === 0 && targetColumnIndex === 0) {
            // Get list padding (CSS Pixels)
            const listStyle = window.getComputedStyle(pipelineListElement);
            const listPaddingTop = parseFloat(listStyle.paddingTop) || 0;
            const listPaddingLeft = parseFloat(listStyle.paddingLeft) || 0;

            // Top: Position relative to pipeline = list's offsetTop + list's paddingTop
            const finalIndicatorTop = listOffsetTopInPipeline + listPaddingTop; 

            // Left: Position relative to pipeline = list's offsetLeft + list's paddingLeft
            const indicatorLeft = listOffsetLeftInPipeline + listPaddingLeft;

            // Width: Approximate using list's clientWidth
            const indicatorWidth = pipelineListElement.clientWidth;

            indicator.style.top = `${Math.round(finalIndicatorTop)}px`;
            indicator.style.left = `${Math.round(indicatorLeft)}px`;
            indicator.style.width = `${Math.round(indicatorWidth)}px`;
            indicator.style.display = 'block';
            indicator.style.opacity = '1';
            return;
        }

        // --- Normal case: Calculate indicator position --- 
        const targetColumn = columns[targetColumnIndex];
        // Guard if target column somehow doesn't exist at the retrieved index (Style unified)
        if (!targetColumn) {
            if (indicator) indicator.style.display = 'none';
            return;
        }
        const items = Array.from(targetColumn.children);
        const listScrollTop = pipelineListElement.scrollTop; 

        // Calculate base top position relative to list content top (includes scroll)
        let baseTopRelativeToListContent = 0;
        let finalIndicatorTop; // Declare finalIndicatorTop here

        if (targetItemIndex !== null && targetItemIndex < items.length && items[targetItemIndex]) {
            const targetItemElement = items[targetItemIndex];
            baseTopRelativeToListContent = targetItemElement.offsetTop + targetColumn.offsetTop + listScrollTop;
            // Keep the original calculation for this case, assuming it's correct
            finalIndicatorTop = baseTopRelativeToListContent - listOffsetTopInPipeline; 
        } else {
            if (items.length > 0) {
                 const lastItemElement = items[items.length - 1];
                 baseTopRelativeToListContent = lastItemElement.offsetTop + lastItemElement.offsetHeight + targetColumn.offsetTop + listScrollTop;
                 // Keep the original calculation for this case, assuming it's correct
                 finalIndicatorTop = baseTopRelativeToListContent - listOffsetTopInPipeline; 
            } else { 
                 // Empty column: Calculate position directly relative to pipelineList top + padding
                 const listStyle = window.getComputedStyle(pipelineListElement);
                 const listPaddingTop = parseFloat(listStyle.paddingTop) || 0;
                 // Set finalIndicatorTop directly to the desired value relative to #pipeline
                 finalIndicatorTop = listOffsetTopInPipeline + listPaddingTop;
                 // baseTopRelativeToListContent is not used for this specific override
            }
        }
        
        // Calculate left position: Assume targetColumn.offsetLeft is relative to pipelineList's offset parent (#pipeline)
        const indicatorLeft = targetColumn.offsetLeft;
        const indicatorWidth = targetColumn.offsetWidth;

        // Set styles
        indicator.style.top = `${Math.round(finalIndicatorTop)}px`;
        indicator.style.left = `${Math.round(indicatorLeft)}px`;
        indicator.style.width = `${Math.round(indicatorWidth)}px`;
        indicator.style.display = 'block';
        indicator.style.opacity = '1';
    }

    /**
     * Find insertion index based on the logical target found by findPotentialInsertionTarget.
     * @param {number} clientX - Raw viewport X coordinate.
     * @param {number} clientY - Raw viewport Y coordinate.
     * @param {Array} pipeline - The current pipeline array.
     * @returns {number} The insertion index.
     */
    findInsertionIndex(clientX, clientY, pipeline) {
        // Calculate the logical target using the raw coordinates.
        const targetInfo = this.findPotentialInsertionTarget(clientX, clientY);
        const columnIndex = targetInfo.columnIndex;
        const positionInColumn = targetInfo.itemIndex;

        // If target is invalid, append to the end.
        if (columnIndex === null || positionInColumn === null) {
            return pipeline.length;
        }

        // Get the number of columns.
        const columns = document.querySelectorAll('.pipeline-column');
        const columnCount = columns.length;
        const totalPlugins = pipeline.length;
        
        // Guard against division by zero if there are no columns.
        if (columnCount === 0) {
            return totalPlugins; // If pipeline is empty, this will be 0
        }

        // Calculate plugins per column based on the current pipeline length.
        // This logic assumes column-first filling.
        const pluginsPerColumn = Math.ceil(totalPlugins / columnCount);

        // Calculate the actual insertion index in the pipeline array.
        // Ensure index doesn't exceed the total number of plugins.
        // Calculate the base index based on column-first filling.
        let calculatedIndex = columnIndex * pluginsPerColumn + positionInColumn;

        // Adjust index if dropping into a column that isn't the last *full* column
        // Example: 3 columns, 7 plugins (3, 3, 1). Dropping at col 0, pos 1 = index 1.
        // Dropping at col 1, pos 0 = index 3. Dropping at col 2, pos 0 = index 6.
        // The formula columnIndex * pluginsPerColumn + positionInColumn works correctly for column-first filling.
        
        const finalIndex = Math.min(calculatedIndex, totalPlugins);
        return finalIndex;
    }

    setupPluginItemDragEvents(item, plugin) {
        const isMobileLayout = () => window.uiManager?.layoutMode?.isMobile;

        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', plugin.name);
            item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
            this.dragMessage.style.display = 'none';
            item.classList.remove('dragging');
            
            // Clear pending timeouts/rAF and hide indicator immediately
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
            this.insertionIndicator.style.display = 'none'; 
        });

        // Touch events
        let isDragging = false;
        let clone = null;
        let touchOffsetX = 0;
        let touchOffsetY = 0;

        item.addEventListener('touchstart', (e) => {
            if (isMobileLayout()) return;

            const touch = e.touches[0];
            this.dragMessage.style.display = 'block';

            // Calculate touch offset from item's top-left corner
            const rect = item.getBoundingClientRect();
            touchOffsetX = touch.clientX - rect.left;
            touchOffsetY = touch.clientY - rect.top;

            // Start dragging immediately
            isDragging = true;
            item.classList.add('dragging');

            // Create visual clone for dragging
            clone = item.cloneNode(true);
            clone.style.position = 'fixed';
            clone.style.zIndex = '1000';
            clone.style.width = item.offsetWidth + 'px';
            clone.style.opacity = '0.9';
            clone.style.backgroundColor = '#ffffff';
            clone.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
            clone.style.pointerEvents = 'none';
            clone.style.left = (touch.clientX - touchOffsetX) + 'px';
            clone.style.top = (touch.clientY - touchOffsetY) + 'px';
            document.body.appendChild(clone);
        });

        item.addEventListener('touchmove', (e) => {
            if (isMobileLayout()) return;

            e.preventDefault();
            const touch = e.touches[0];

            if (isDragging && clone) {
                clone.style.left = (touch.clientX - touchOffsetX) + 'px';
                clone.style.top = (touch.clientY - touchOffsetY) + 'px';
                
                // Throttle dragover events
                this.throttle(() => {
                    this.updateInsertionIndicator(touch.clientX, touch.clientY);
                }, this.dragOverThrottleDelay);
            }
        });

        item.addEventListener('touchend', (e) => {
            if (isMobileLayout()) {
                isDragging = false;
                clone?.remove();
                clone = null;
                item.classList.remove('dragging');
                this.dragMessage.style.display = 'none';
                this.insertionIndicator.style.display = 'none';
                return;
            }

            this.dragMessage.style.display = 'none';
            
            if (isDragging) {
                e.preventDefault();
                const touch = e.changedTouches[0];
                const pipeline = document.getElementById('pipeline');
                const pipelineRect = pipeline.getBoundingClientRect();
                
                // Check if touch position is within pipeline element
                if (touch.clientX >= pipelineRect.left && 
                    touch.clientX <= pipelineRect.right && 
                    touch.clientY >= pipelineRect.top && 
                    touch.clientY <= pipelineRect.bottom) {
                    
                    // Create and dispatch drop event
                    const dropEvent = new Event('drop', { bubbles: true });
                    dropEvent.clientX = touch.clientX;
                    dropEvent.clientY = touch.clientY;
                    dropEvent.preventDefault = () => {};
                    dropEvent.dataTransfer = {
                        getData: (type) => type === 'text/plain' ? plugin.name : '',
                        dropEffect: 'move'
                    };
                    
                    pipeline.dispatchEvent(dropEvent);
                    
                    // Check window width and adjust plugin list collapse state after drop
                    setTimeout(() => this.pluginListManager.collapseManager.checkWindowWidthAndAdjust(), 100);
                }

                // Cleanup
                if (clone) {
                    clone.remove();
                    clone = null;
                }
                item.classList.remove('dragging');
                this.insertionIndicator.style.display = 'none';
            }
            
            isDragging = false;
        });
    }

    setupPresetItemDragEvents(item, presetName, isUserPreset = false) {
        const isMobileLayout = () => window.uiManager?.layoutMode?.isMobile;
        let dragStartTime = 0;

        // Mouse events - show drag message on mousedown
        item.addEventListener('mousedown', () => {
            // Update drag message text for presets
            if (window.uiManager && window.uiManager.t) {
                this.dragMessage.textContent = window.uiManager.t('ui.dragEffectMessage');
            }
            this.dragMessage.style.display = 'block';
        });

        item.addEventListener('mouseup', () => {
            // Hide message if drag didn't start
            if (!item.matches('.dragging')) {
                this.dragMessage.style.display = 'none';
            }
        });

        // Drag start
        item.addEventListener('dragstart', (e) => {
            dragStartTime = Date.now();
            e.dataTransfer.setData('text/plain', JSON.stringify({
                type: isUserPreset ? 'userPreset' : 'preset',
                name: presetName
            }));
            item.classList.add('dragging');
        });

        // Drag end
        item.addEventListener('dragend', () => {
            this.dragMessage.style.display = 'none';
            item.classList.remove('dragging');
            
            // Clear pending timeouts/rAF and hide indicator immediately
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
            this.insertionIndicator.style.display = 'none';
        });

        // Drag over pipeline to show insertion indicator
        item.addEventListener('drag', (e) => {
            if (Date.now() - dragStartTime > 100) {
                this.throttle(() => {
                    this.updateInsertionIndicator(e.clientX, e.clientY);
                }, this.dragOverThrottleDelay);
            }
        });

        // Touch events for mobile
        let isDragging = false;
        let clone = null;
        let touchOffsetX = 0;
        let touchOffsetY = 0;

        item.addEventListener('touchstart', (e) => {
            if (isMobileLayout()) return;

            const touch = e.touches[0];
            
            // Update drag message text for presets (for touch devices)
            if (window.uiManager && window.uiManager.t) {
                this.dragMessage.textContent = window.uiManager.t('ui.dragEffectMessage');
            }
            this.dragMessage.style.display = 'block';

            // Calculate touch offset from item's top-left corner
            const rect = item.getBoundingClientRect();
            touchOffsetX = touch.clientX - rect.left;
            touchOffsetY = touch.clientY - rect.top;

            // Start dragging immediately
            isDragging = true;
            item.classList.add('dragging');

            // Create visual clone for dragging
            clone = item.cloneNode(true);
            clone.style.position = 'fixed';
            clone.style.zIndex = '1000';
            clone.style.width = item.offsetWidth + 'px';
            clone.style.opacity = '0.9';
            clone.style.backgroundColor = '#ffffff';
            clone.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
            clone.style.pointerEvents = 'none';
            clone.style.left = (touch.clientX - touchOffsetX) + 'px';
            clone.style.top = (touch.clientY - touchOffsetY) + 'px';
            document.body.appendChild(clone);
        });

        item.addEventListener('touchmove', (e) => {
            if (isMobileLayout()) return;

            e.preventDefault();
            const touch = e.touches[0];

            if (isDragging && clone) {
                clone.style.left = (touch.clientX - touchOffsetX) + 'px';
                clone.style.top = (touch.clientY - touchOffsetY) + 'px';
                
                // Throttle dragover events
                this.throttle(() => {
                    this.updateInsertionIndicator(touch.clientX, touch.clientY);
                }, this.dragOverThrottleDelay);
            }
        });

        item.addEventListener('touchend', async (e) => {
            if (isMobileLayout()) {
                isDragging = false;
                clone?.remove();
                clone = null;
                item.classList.remove('dragging');
                this.dragMessage.style.display = 'none';
                this.insertionIndicator.style.display = 'none';
                return;
            }

            this.dragMessage.style.display = 'none';
            
            if (isDragging) {
                e.preventDefault();
                const touch = e.changedTouches[0];
                const pipeline = document.getElementById('pipeline');
                const pipelineRect = pipeline.getBoundingClientRect();
                
                // Check if touch position is within pipeline element
                if (touch.clientX >= pipelineRect.left && 
                    touch.clientX <= pipelineRect.right && 
                    touch.clientY >= pipelineRect.top && 
                    touch.clientY <= pipelineRect.bottom) {
                    
                    // Create and dispatch drop event (same as plugin touch events)
                    const dropEvent = new Event('drop', { bubbles: true });
                    dropEvent.clientX = touch.clientX;
                    dropEvent.clientY = touch.clientY;
                    dropEvent.preventDefault = () => {};
                    dropEvent.dataTransfer = {
                        getData: (type) => {
                            if (type === 'text/plain') {
                                return JSON.stringify({
                                    type: isUserPreset ? 'userPreset' : 'preset',
                                    name: presetName
                                });
                            }
                            return '';
                        },
                        dropEffect: 'move'
                    };
                    
                    pipeline.dispatchEvent(dropEvent);
                    
                    // Check window width and adjust plugin list collapse state after drop
                    setTimeout(() => this.pluginListManager.collapseManager.checkWindowWidthAndAdjust(), 100);
                }

                // Cleanup
                if (clone) {
                    clone.remove();
                    clone = null;
                }
                item.classList.remove('dragging');
                this.insertionIndicator.style.display = 'none';
            }
            
            isDragging = false;
        });
    }

    getDragMessage() {
        return this.dragMessage;
    }

    getInsertionIndicator() {
        return this.insertionIndicator;
    }
}
