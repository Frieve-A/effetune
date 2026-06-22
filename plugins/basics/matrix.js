class MatrixPlugin extends PluginBase {
    constructor() {
        super('Matrix', 'Routes and mixes audio channels with optional phase inversion');
        
        // Initialize parameter - mx: Matrix Routing
        this.mx = "";
        
        // Register processor function
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            const { 
                mx: matrixParam,
                channelCount, 
                blockSize 
            } = parameters;
            
            if (context.matrixParam !== matrixParam || context.channelCount !== channelCount) {
                const routeCapacity = matrixParam.length > 0 ? matrixParam.length : 1;
                if (!context.routeInputs || context.routeInputs.length < routeCapacity) {
                    context.routeInputs = new Int16Array(routeCapacity);
                    context.routeOutputs = new Int16Array(routeCapacity);
                    context.routePhase = new Int8Array(routeCapacity);
                }

                let routeCount = 0;
                let i = 0;
                while (i < matrixParam.length) {
                    let hasPhaseInvert = 0;

                    // Check for phase inversion flag
                    if (matrixParam[i] === 'p') {
                        hasPhaseInvert = 1;
                        i++;
                    }

                    // Need at least 2 more characters for input/output
                    if (i + 1 >= matrixParam.length) break;

                    // Parse input and output channel indices
                    const inputCh = parseInt(matrixParam[i], 10);
                    const outputCh = parseInt(matrixParam[i+1], 10);

                    // Validate channel indices
                    if (!isNaN(inputCh) && !isNaN(outputCh) &&
                        inputCh >= 0 && inputCh < channelCount &&
                        outputCh >= 0 && outputCh < channelCount) {
                        context.routeInputs[routeCount] = inputCh;
                        context.routeOutputs[routeCount] = outputCh;
                        context.routePhase[routeCount] = hasPhaseInvert;
                        routeCount++;
                    }

                    i += 2; // Move to next routing pair
                }

                context.routeCount = routeCount;
                context.matrixParam = matrixParam;
                context.channelCount = channelCount;
            }

            const dataLength = data.length;
            if (!context.outputData || context.outputData.length !== dataLength) {
                context.outputData = new Float32Array(dataLength);
            }
            const outputData = context.outputData;
            
            // Initialize output buffer with zeros (don't copy input data)
            outputData.fill(0, 0, dataLength);
            
            // Apply routing for each input/output mapping
            for (let routeIndex = 0; routeIndex < context.routeCount; routeIndex++) {
                const input = context.routeInputs[routeIndex];
                const output = context.routeOutputs[routeIndex];
                const phaseInvert = context.routePhase[routeIndex] !== 0;
                const phaseMultiplier = phaseInvert ? -1 : 1;
                
                // Mix input channel to output channel
                for (let i = 0; i < blockSize; i++) {
                    const inputIndex = input * blockSize + i;
                    const outputIndex = output * blockSize + i;
                    outputData[outputIndex] += data[inputIndex] * phaseMultiplier;
                }
            }
            
            // Copy mixed data back to the original buffer
            for (let i = 0; i < dataLength; i++) {
                data[i] = outputData[i];
            }
            
            data.measurements = { channels: channelCount };
            return data;
        `);
        
        // Matrix state - tracks which input/output pairs are active and phase-inverted
        this.matrixState = this._createEmptyMatrixState();
        
        // Initialize diagonal elements to ON by default
        for (let i = 0; i < 2; i++) {
            this.matrixState[i][i].active = true;
        }
        
        // Initialize mx parameter with diagonal routing
        this.mx = this.generateRouting();
    }

    _createEmptyMatrixState() {
        return Array(9).fill().map(() => Array(9).fill().map(() => ({
            active: false,
            phaseInvert: false
        })));
    }
    
    // Parse routing string and update matrixState
    parseRouting(routingStr) {
        // Reset matrix state
        this.matrixState = this._createEmptyMatrixState();

        if (typeof routingStr !== 'string' || routingStr.length === 0) return;
        
        let i = 0;
        while (i < routingStr.length) {
            let hasPhaseInvert = false;
            
            // Check for phase inversion flag
            if (routingStr[i] === 'p') {
                hasPhaseInvert = true;
                i++;
            }
            
            // Need at least 2 more characters for input/output
            if (i + 1 >= routingStr.length) break;
            
            // Parse input and output channel indices
            const inputCh = parseInt(routingStr[i], 10);
            const outputCh = parseInt(routingStr[i+1], 10);
            
            // Validate and update matrix state
            if (!isNaN(inputCh) && !isNaN(outputCh) && 
                inputCh >= 0 && inputCh < 9 && 
                outputCh >= 0 && outputCh < 9) {
                
                this.matrixState[inputCh][outputCh] = {
                    active: true,
                    phaseInvert: hasPhaseInvert
                };
            }
            
            i += 2;
        }
    }
    
    // Generate routing string from matrixState
    generateRouting() {
        let routingStr = "";
        
        for (let inputCh = 0; inputCh < this.matrixState.length; inputCh++) {
            for (let outputCh = 0; outputCh < this.matrixState[inputCh].length; outputCh++) {
                const cell = this.matrixState[inputCh][outputCh];
                
                if (cell.active) {
                    if (cell.phaseInvert) {
                        routingStr += "p";
                    }
                    routingStr += inputCh.toString() + outputCh.toString();
                }
            }
        }
        
        return routingStr;
    }
    
    // Set parameters
    setParameters(params) {
        if (params.mx !== undefined) {
            this.mx = typeof params.mx === 'string' ? params.mx : this.mx;
            this.parseRouting(this.mx);
        }
        
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        
        this.updateParameters();
    }
    
    // Get parameters
    getParameters() {
        return {
            type: this.constructor.name,
            mx: this.mx,
            enabled: this.enabled
        };
    }
    
    // Toggle cell active state
    toggleCellActive(inputCh, outputCh) {
        if (inputCh >= 0 && inputCh < 9 && outputCh >= 0 && outputCh < 9) {
            this.matrixState[inputCh][outputCh].active = !this.matrixState[inputCh][outputCh].active;
            
            // If cell becomes inactive, also disable phase inversion
            if (!this.matrixState[inputCh][outputCh].active) {
                this.matrixState[inputCh][outputCh].phaseInvert = false;
            }
            
            // Update routing parameter
            this.mx = this.generateRouting();
            this.updateParameters();
        }
    }
    
    // Toggle cell phase inversion (only if active)
    toggleCellPhaseInvert(inputCh, outputCh) {
        if (inputCh >= 0 && inputCh < 9 && outputCh >= 0 && outputCh < 9 && 
            this.matrixState[inputCh][outputCh].active) {
            
            this.matrixState[inputCh][outputCh].phaseInvert = !this.matrixState[inputCh][outputCh].phaseInvert;
            
            // Update routing parameter
            this.mx = this.generateRouting();
            this.updateParameters();
        }
    }
    
    // Create UI elements for the plugin
    createUI() {
        const container = document.createElement('div');
        container.className = 'matrix-plugin-ui plugin-parameter-ui';
        
        // Initialize matrix state from parameter if not already done
        if (this.mx && this.matrixState.every(row => row.every(cell => !cell.active))) {
            this.parseRouting(this.mx);
        }
        
        // Create table element
        const table = document.createElement('table');
        table.className = 'matrix-table';
        this.table = table;
        
        // Create table header row (output channels)
        const headerRow = document.createElement('tr');
        
        // Add empty corner cell
        const cornerCell = document.createElement('th');
        cornerCell.textContent = '';
        headerRow.appendChild(cornerCell);
        
        // Add "Output" label cell
        const outputLabelCell = document.createElement('th');
        outputLabelCell.textContent = 'Output';
        outputLabelCell.colSpan = 8;
        headerRow.appendChild(outputLabelCell);
        
        table.appendChild(headerRow);
        
        // Create second header row with channel labels
        const channelHeaderRow = document.createElement('tr');
        
        // Add "Input" label
        const inputLabelCell = document.createElement('th');
        inputLabelCell.textContent = 'Input';
        channelHeaderRow.appendChild(inputLabelCell);
        
        // Add channel labels (Ch 1-8)
        const channelLabels = ['Ch 1', 'Ch 2', 'Ch 3', 'Ch 4', 'Ch 5', 'Ch 6', 'Ch 7', 'Ch 8'];
        for (let i = 0; i < 8; i++) {
            const th = document.createElement('th');
            th.textContent = channelLabels[i];
            channelHeaderRow.appendChild(th);
        }
        
        table.appendChild(channelHeaderRow);
        
        // Create rows for each input channel
        for (let inputCh = 0; inputCh < 8; inputCh++) {
            const row = document.createElement('tr');
            
            // Add row header (input channel label)
            const rowHeader = document.createElement('th');
            rowHeader.textContent = channelLabels[inputCh];
            row.appendChild(rowHeader);
            
            // Create cells for each output channel
            for (let outputCh = 0; outputCh < 8; outputCh++) {
                const cell = document.createElement('td');
                
                const cellState = this.matrixState[inputCh][outputCh];
                
                // Create ON button
                const onButton = document.createElement('button');
                onButton.textContent = 'ON';
                onButton.className = cellState.active ? 'matrix-button active' : 'matrix-button';
                onButton.addEventListener('click', () => {
                    this.toggleCellActive(inputCh, outputCh);
                    onButton.className = this.matrixState[inputCh][outputCh].active ? 
                        'matrix-button active' : 'matrix-button';
                    phaseButton.className = this.matrixState[inputCh][outputCh].active && 
                        this.matrixState[inputCh][outputCh].phaseInvert ? 
                        'matrix-button phase-button active' : 'matrix-button phase-button';
                });
                
                // Create phase inversion button
                const phaseButton = document.createElement('button');
                phaseButton.innerHTML = '&Oslash;';
                phaseButton.className = cellState.active && cellState.phaseInvert ? 
                    'matrix-button phase-button active' : 'matrix-button phase-button';
                phaseButton.addEventListener('click', () => {
                    if (this.matrixState[inputCh][outputCh].active) {
                        this.toggleCellPhaseInvert(inputCh, outputCh);
                        phaseButton.className = this.matrixState[inputCh][outputCh].phaseInvert ? 
                            'matrix-button phase-button active' : 'matrix-button phase-button';
                    }
                });
                
                cell.appendChild(onButton);
                cell.appendChild(phaseButton);
                row.appendChild(cell);
            }
            
            table.appendChild(row);
        }
        
        container.appendChild(table);
        
        return container;
    }
    
    // Handle messages from audio processor
    onMessage(message) {
        // Update UI if channel count changes
        if (message.type === 'processBuffer' && message.pluginId === this.id && message.measurements) {
            const actualChannelCount = message.measurements.channels || 2;
            this.updateChannelAvailability(actualChannelCount);
        }
    }
    
    // Update channel availability based on actual channel count
    updateChannelAvailability(channelCount) {
        const table = this.table;
        if (!table) return;
        
        // Update rows (input channels)
        const rows = table.querySelectorAll('tr');
        for (let i = 2; i < rows.length; i++) { // Skip header rows
            const inputCh = i - 2;
            const row = rows[i];
            
            if (inputCh >= channelCount) {
                // Disable row for unavailable input channels
                row.classList.add('disabled');
                
                // Also disable all cells in this row
                const cells = row.querySelectorAll('td');
                cells.forEach(cell => {
                    cell.classList.add('disabled');
                    // Keep buttons enabled but with visual indication
                });
            } else {
                row.classList.remove('disabled');
            }
            
            // Update cells (output channels)
            const cells = row.querySelectorAll('td');
            cells.forEach((cell, cellIndex) => {
                const outputCh = cellIndex;
                
                if (outputCh >= channelCount) {
                    // Disable cell for unavailable output channels
                    cell.classList.add('disabled');
                    // Keep buttons enabled but with visual indication
                } else if (inputCh < channelCount) {
                    // Only enable if both input and output channels are available
                    cell.classList.remove('disabled');
                }
            });
        }
    }
}

// Register the plugin
window.MatrixPlugin = MatrixPlugin;
