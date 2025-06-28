/**
 * PipelineRoutingDialog - Handles the routing dialog for bus and channel configuration
 * Manages the UI for configuring plugin input/output bus routing and channel selection
 */
export class PipelineRoutingDialog {
    /**
     * Create a new PipelineRoutingDialog instance
     * @param {PipelineCore} pipelineCore - Reference to pipeline core instance
     */
    constructor(pipelineCore) {
        this.pipelineCore = pipelineCore;
    }

    /**
     * Show the routing dialog for a plugin
     * @param {Object} plugin - The plugin to configure routing for
     * @param {HTMLElement} button - The button that was clicked
     */
    showRoutingDialog(plugin, button) {
        // Remove any existing dialog
        const existingDialog = document.querySelector('.routing-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }
        
        // Create dialog
        const dialog = document.createElement('div');
        dialog.className = 'routing-dialog';
        
        // Create dialog header
        const header = this.createDialogHeader();
        dialog.appendChild(header);
        
        // Create channel selector
        const channelContainer = this.createChannelSelector(plugin);
        dialog.appendChild(channelContainer);

        // Create input bus selector
        const inputBusContainer = this.createInputBusSelector(plugin);
        dialog.appendChild(inputBusContainer);
        
        // Create output bus selector
        const outputBusContainer = this.createOutputBusSelector(plugin);
        dialog.appendChild(outputBusContainer);
        
        // Position the dialog
        this.positionDialog(dialog, button);
        
        // Add dialog to the document
        document.body.appendChild(dialog);
        
        // Setup close handler
        this.setupCloseHandler(dialog, button);
    }

    /**
     * Create dialog header with close button
     * @returns {HTMLElement} The header element
     */
    createDialogHeader() {
        const header = document.createElement('div');
        header.className = 'routing-dialog-header';
        header.textContent = window.uiManager.t('ui.busRouting');
        
        // Create close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'routing-dialog-close';
        closeBtn.textContent = '✕';
        closeBtn.title = window.uiManager
            ? window.uiManager.t('ui.title.close')
            : 'Close';
        closeBtn.onclick = () => {
            const dialog = document.querySelector('.routing-dialog');
            if (dialog) dialog.remove();
        };
        header.appendChild(closeBtn);
        
        return header;
    }

    /**
     * Create channel selector
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The channel selector container
     */
    createChannelSelector(plugin) {
        const channelContainer = document.createElement('div');
        channelContainer.className = 'routing-dialog-row';

        const channelLabel = document.createElement('label');
        channelLabel.textContent = window.uiManager.t('ui.channel'); // Add translation key 'ui.channel'
        channelContainer.appendChild(channelLabel);

        const channelSelect = document.createElement('select');

        // Define channel options - changed for multi-channel support
        const channelOptions = [
            { text: 'Stereo', value: '' },  // Default - process first 2 channels only (null)
            { text: 'All', value: 'A' },    // All channels
            { text: 'Left', value: 'L' },   // Left channel only
            { text: 'Right', value: 'R' },  // Right channel only
            { text: '3+4', value: '34' },   // Channels 3 & 4 as stereo pair
            { text: '5+6', value: '56' },   // Channels 5 & 6 as stereo pair
            { text: '7+8', value: '78' }    // Channels 7 & 8 as stereo pair
        ];

        // Add individual channel options 3-8 based on output channel count
        for (let i = 3; i <= 8; i++) {
            channelOptions.push({ text: `Ch ${i}`, value: String(i) });
        }

        channelOptions.forEach(option => {
            const optionEl = document.createElement('option');
            optionEl.value = option.value;
            optionEl.textContent = option.text;
            // Compare plugin.channel with option value
            const currentChannelValue = plugin.channel === null ? '' : plugin.channel;
            optionEl.selected = currentChannelValue === option.value;
            channelSelect.appendChild(optionEl);
        });

        channelSelect.onchange = () => {
            const value = channelSelect.value;
            // Store null for empty string (Stereo), otherwise store the value
            plugin.channel = value === '' ? null : value;
            plugin.updateParameters(); 
            this.pipelineCore.updateBusInfo(plugin); // Call updateBusInfo to reflect channel change
        };

        channelContainer.appendChild(channelSelect);
        return channelContainer;
    }

    /**
     * Create input bus selector
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The input bus selector container
     */
    createInputBusSelector(plugin) {
        const inputBusContainer = document.createElement('div');
        inputBusContainer.className = 'routing-dialog-row';
        
        const inputBusLabel = document.createElement('label');
        inputBusLabel.textContent = window.uiManager.t('ui.inputBus');
        inputBusContainer.appendChild(inputBusLabel);
        
        const inputBusSelect = document.createElement('select');
        // Add Main bus option (index 0)
        const inputMainOption = document.createElement('option');
        inputMainOption.value = 0;
        inputMainOption.textContent = 'Main';
        inputMainOption.selected = plugin.inputBus === null || plugin.inputBus === 0;
        inputBusSelect.appendChild(inputMainOption);
        
        // Add Bus 1-4 options
        for (let i = 1; i <= 4; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Bus ${i}`;
            option.selected = plugin.inputBus === i;
            inputBusSelect.appendChild(option);
        }
        
        inputBusSelect.onchange = () => {
            const value = parseInt(inputBusSelect.value, 10);
            plugin.inputBus = value === 0 ? null : value;
            plugin.updateParameters();
            this.pipelineCore.updateBusInfo(plugin);
        };
        
        inputBusContainer.appendChild(inputBusSelect);
        return inputBusContainer;
    }

    /**
     * Create output bus selector
     * @param {Object} plugin - The plugin
     * @returns {HTMLElement} The output bus selector container
     */
    createOutputBusSelector(plugin) {
        const outputBusContainer = document.createElement('div');
        outputBusContainer.className = 'routing-dialog-row';
        
        const outputBusLabel = document.createElement('label');
        outputBusLabel.textContent = window.uiManager.t('ui.outputBus');
        outputBusContainer.appendChild(outputBusLabel);
        
        const outputBusSelect = document.createElement('select');
        // Add Main bus option (index 0)
        const outputMainOption = document.createElement('option');
        outputMainOption.value = 0;
        outputMainOption.textContent = 'Main';
        outputMainOption.selected = plugin.outputBus === null || plugin.outputBus === 0;
        outputBusSelect.appendChild(outputMainOption);
        
        // Add Bus 1-4 options
        for (let i = 1; i <= 4; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Bus ${i}`;
            option.selected = plugin.outputBus === i;
            outputBusSelect.appendChild(option);
        }
        
        outputBusSelect.onchange = () => {
            const value = parseInt(outputBusSelect.value, 10);
            plugin.outputBus = value === 0 ? null : value;
            plugin.updateParameters();
            this.pipelineCore.updateBusInfo(plugin);
        };
        
        outputBusContainer.appendChild(outputBusSelect);
        return outputBusContainer;
    }

    /**
     * Position the dialog near the button
     * @param {HTMLElement} dialog - The dialog element
     * @param {HTMLElement} button - The button element
     */
    positionDialog(dialog, button) {
        // Calculate current zoom factor - This is what was missing in previous solutions
        // Create a temporary measuring element to accurately determine zoom level
        const zoomMeasureEl = document.createElement('div');
        zoomMeasureEl.style.width = '100px';
        zoomMeasureEl.style.height = '100px';
        zoomMeasureEl.style.position = 'absolute';
        zoomMeasureEl.style.opacity = '0';
        zoomMeasureEl.style.pointerEvents = 'none';
        document.body.appendChild(zoomMeasureEl);
        
        // Get the actual rendered size which changes with zoom
        const actualSize = zoomMeasureEl.getBoundingClientRect();
        // Calculate zoom factor (100px is expected size at 100% zoom)
        const zoomFactor = 100 / actualSize.width;
        // Clean up the measuring element
        document.body.removeChild(zoomMeasureEl);
        
        // Position the dialog near the button, accounting for zoom
        const buttonRect = button.getBoundingClientRect();
        dialog.style.position = 'absolute';
        
        // Apply zoom correction to make position consistent at any zoom level
        const correctedTop = buttonRect.bottom * zoomFactor + window.scrollY;
        const correctedLeft = buttonRect.left * zoomFactor + window.scrollX;
        
        dialog.style.top = `${correctedTop}px`;
        dialog.style.left = `${correctedLeft}px`;
    }

    /**
     * Setup close handler for the dialog
     * @param {HTMLElement} dialog - The dialog element
     * @param {HTMLElement} button - The button element
     */
    setupCloseHandler(dialog, button) {
        // Prevent immediate closing by delaying the click handler
        setTimeout(() => {
            // Close dialog when clicking outside
            document.addEventListener('click', function closeDialog(e) {
                if (!dialog.contains(e.target) && e.target !== button) {
                    dialog.remove();
                    document.removeEventListener('click', closeDialog);
                }
            });
        }, 100);
    }

    /**
     * Update the bus info display for a plugin
     * @param {Object} plugin - The plugin to update bus info for
     */
    updateBusInfo(plugin) {
        const pipelineList = this.pipelineCore.pipelineList;
        
        // Find the plugin's pipeline item using its data-plugin-id
        const pipelineItem = pipelineList.querySelector(`.pipeline-item[data-plugin-id='${plugin.id}']`);
        if (!pipelineItem) return;
        
        // Find or create the bus info element
        let busInfo = pipelineItem.querySelector('.bus-info');
        const header = pipelineItem.querySelector('.pipeline-item-header');
        const routingBtn = pipelineItem.querySelector('.routing-button'); // Find routing button for insertion point

        // Determine if there's bus or channel info to display
        const hasBusInfo = plugin.inputBus !== null || plugin.outputBus !== null;
        const hasChannelInfo = plugin.channel !== null;

        if (hasBusInfo || hasChannelInfo) {
            if (!busInfo) {
                busInfo = document.createElement('div');
                busInfo.className = 'bus-info';
                // Insert before the routing button or as the first child if no routing button
                if (routingBtn) {
                    header.insertBefore(busInfo, routingBtn);
                } else {
                    // Fallback: insert before the first element (e.g., move up/down buttons)
                    // This might need adjustment based on exact header structure if routingBtn is absent
                    header.insertBefore(busInfo, header.children[2] || null); 
                }
            }
            
            let busText = '';
            if (hasBusInfo) {
                const inputBusName = plugin.inputBus === null ? 'Main' : `Bus ${plugin.inputBus || 0}`;
                const outputBusName = plugin.outputBus === null ? 'Main' : `Bus ${plugin.outputBus || 0}`;
                busText = `${inputBusName}→${outputBusName}`;
            }
            
            let channelText = '';
            if (hasChannelInfo) {
                if (plugin.channel === 'L') {
                    channelText = 'Left';
                } else if (plugin.channel === 'R') {
                    channelText = 'Right';
                } else if (plugin.channel === 'A') {
                    channelText = 'All';
                } else if (plugin.channel === '34') {
                    channelText = '3+4';
                } else if (plugin.channel === '56') {
                    channelText = '5+6';
                } else if (plugin.channel === '78') {
                    channelText = '7+8';
                } else if (plugin.channel >= '3' && plugin.channel <= '8') {
                    channelText = `Ch ${plugin.channel}`;
                } else {
                    channelText = plugin.channel;
                }
            }

            // Combine bus and channel info
            busInfo.textContent = [busText, channelText].filter(Boolean).join(' '); // Filter out empty strings and join with space

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
                const actualRoutingBtn = pipelineItem.querySelector('.routing-button'); // Re-query in case it was added
                this.showRoutingDialog(plugin, actualRoutingBtn || busInfo);
            };
        } else if (busInfo) {
            // Remove busInfo element if no bus or channel info is set
            busInfo.remove();
        }
        
        // Save state for undo/redo
        if (this.pipelineCore.pipelineManager && this.pipelineCore.pipelineManager.historyManager) {
            this.pipelineCore.pipelineManager.historyManager.saveState();
        }
    }
}