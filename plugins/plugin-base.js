// IMPORTANT: Do not add individual plugin implementations directly in this file.
// This file contains the base plugin class that all plugins should extend.
// Plugin implementations should be created in their own files under the plugins directory.
// See docs/plugin-development.md for plugin development guidelines.

class PluginBase {
    constructor(name, description) {
        this.name = name;
        this.description = description;
        this.enabled = true;
        // Whether the section the plugin belongs to is enabled. The pipeline
        // updates this when the user toggles a Section's ON button; used
        // together with `enabled` to decide whether the plugin's redraw loop
        // (startAnimation/stopAnimation) should run.
        this._sectionEnabled = true;
        this.id = null; // Will be set by createPlugin
        this.errorState = null; // Holds error state
        this.inputBus = null; // Input bus (null = default Main bus, index 0)
        this.outputBus = null; // Output bus (null = default Main bus, index 0)
        this.channel = null; // Channel processing: null ('All'), 'Left', 'Right'
        this._responsiveGraphDisposers = new Set();

        // Message control properties
        this.lastUpdateTime = 0;
        this.UPDATE_INTERVAL = 16; // Minimum update interval in ms
        this.pendingUpdate = null;
        this._pendingTimeoutId = null; // Stores the timeout ID for queued updates

        // Processor storage
        this.processorString = null;
        this.compiledFunction = null;

        // Flag to track message handler registration
        this._hasMessageHandler = false;
        this._messageHandlerWorkletNode = null;
        this._messageHandlerObserver = null;

        // Bind _handleMessage only once for performance
        this._boundHandleMessage = this._handleMessage.bind(this);

        // If workletNode exists, set up the message handler immediately
        if (window.workletNode) {
            this._setupMessageHandler();
        }

        // Observe mutations to detect when workletNode becomes available
        this._messageHandlerObserver = new MutationObserver(() => {
            if (window.workletNode && !this._hasMessageHandler) {
                this._setupMessageHandler();
                this._messageHandlerObserver?.disconnect();
                this._messageHandlerObserver = null;
            }
        });
        this._messageHandlerObserver.observe(document, {
            attributes: true,
            childList: true,
            subtree: true
        });
    }

    _setupMessageHandler() {
        const currentWorkletNode = window.workletNode;
        if (!currentWorkletNode?.port) {
            return;
        }

        if (this._messageHandlerWorkletNode === currentWorkletNode && this._hasMessageHandler) {
            return;
        }

        if (this._messageHandlerWorkletNode?.port && this._hasMessageHandler) {
            try {
                this._messageHandlerWorkletNode.port.removeEventListener('message', this._boundHandleMessage);
            } catch (error) {
                // Ignore stale port cleanup failures.
            }
        }

        currentWorkletNode.port.addEventListener('message', this._boundHandleMessage);
        this._messageHandlerWorkletNode = currentWorkletNode;
        this._hasMessageHandler = true;
    }
    
    _disposeResponsiveGraphs() {
        if (!this._responsiveGraphDisposers) return;
        const disposers = Array.from(this._responsiveGraphDisposers);
        this._responsiveGraphDisposers.clear();
        for (const dispose of disposers) {
            try {
                dispose();
            } catch (error) {
                console.warn(`[${this.name}] Failed to dispose responsive graph:`, error);
            }
        }
    }

    // Clean up resources when plugin is removed
    cleanup() {
        this._disposeResponsiveGraphs();

        if (this._messageHandlerObserver) {
            this._messageHandlerObserver.disconnect();
            this._messageHandlerObserver = null;
        }

        // Remove message event listener to prevent memory leaks
        if (this._hasMessageHandler && window.workletNode) {
            window.workletNode.port.removeEventListener('message', this._boundHandleMessage);
            this._hasMessageHandler = false;
        }
        
        // Clear any pending timeouts
        if (this._pendingTimeoutId !== null) {
            clearTimeout(this._pendingTimeoutId);
            this._pendingTimeoutId = null;
        }
        
        // Clear any other resources
        this.pendingUpdate = null;
    }

    _handleMessage(event) {
        if (event.data.pluginId === this.id) {
            const currentTime = performance.now();
            if (currentTime - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
                // Process immediately if enough time has passed
                this.onMessage(event.data);
                this.lastUpdateTime = currentTime;
                this.pendingUpdate = null;
                if (this._pendingTimeoutId !== null) {
                    clearTimeout(this._pendingTimeoutId);
                    this._pendingTimeoutId = null;
                }
            } else {
                // Queue update by overwriting any existing pending update
                this.pendingUpdate = event.data;
                // Schedule a timeout only if one is not already pending
                if (this._pendingTimeoutId === null) {
                    const timeUntilNextUpdate = this.UPDATE_INTERVAL - (currentTime - this.lastUpdateTime);
                    this._pendingTimeoutId = setTimeout(() => {
                        if (this.pendingUpdate) {
                            this.onMessage(this.pendingUpdate);
                            this.lastUpdateTime = performance.now();
                            this.pendingUpdate = null;
                        }
                        this._pendingTimeoutId = null;
                    }, timeUntilNextUpdate);
                }
            }
        }
    }

    // Default message handler (can be overridden by subclasses)
    onMessage(message) {
        // Default implementation does nothing
    }

    // Default process function (can be overridden by subclasses)
    process(context, data, parameters, time) {
        return data;
    }

    // Compile the processor function using the stored processor string.
    // The 'with' statement is maintained to preserve functionality.
    _compileProcessor(processorStr) {
        try {
            return new Function('context', 'data', 'parameters', 'time', `
                with (context) {
                    const result = (function() {
                        ${processorStr}
                    })();
                    return result;
                }
            `);
        } catch (error) {
            console.error('Failed to compile processor:', {
                type: this.constructor.name,
                error: error.message
            });
            return null;
        }
    }

    // Register the processor function with the audio worklet and store it for offline processing.
    registerProcessor(processorFunction) {
        this.processorString = processorFunction.toString();
        this.compiledFunction = this._compileProcessor(this.processorString);

        if (window.workletNode) {
            this._setupMessageHandler();
            window.workletNode.port.postMessage({
                type: 'registerProcessor',
                pluginType: this.constructor.name,
                processor: this.processorString,
                process: this.process.toString()
            });
        }
    }

    // Execute the compiled processor function for offline processing.
    executeProcessor(context, data, parameters, time) {
        if (!this.compiledFunction) {
            console.warn('No compiled function available for plugin:', this.name);
            return data;
        }
        try {
            return this.compiledFunction.call(null, context, data, parameters, time);
        } catch (error) {
            console.error('Failed to execute processor:', {
                type: this.constructor.name,
                error: error.message
            });
            return data;
        }
    }

    // Update plugin parameters via the worklet.
    updateParameters() {
        if (window.workletNode) {
            const parameters = this.getParameters();
            
            window.workletNode.port.postMessage({
                type: 'updatePlugin',
                plugin: this.getWorkletPluginData(parameters)
            });
            if (window.uiManager) {
                window.uiManager.updateURL();
            }
        }
    }

    // Build the control-rate payload shared by direct, bulk, and DBT worklet updates.
    getWorkletPluginData(parameters = this.getParameters()) {
        const type = this.constructor.name;
        const payload = {
            id: this.id,
            type,
            enabled: this.enabled,
            parameters,
            inputBus: this.inputBus,
            outputBus: this.outputBus,
            channel: this.channel
        };
        const packer = window.dspParamPackers?.get(type);
        if (!packer) return payload;

        try {
            const wasmParams = packer.pack(parameters);
            if (!(wasmParams instanceof Float32Array)) {
                throw new TypeError('parameter packer did not return Float32Array');
            }
            let wasmParamBytes = null;
            if (typeof packer.packBytes === 'function') {
                wasmParamBytes = packer.packBytes(parameters);
                if (!(wasmParamBytes instanceof Uint8Array) ||
                    wasmParamBytes.byteLength > packer.byteCapacity) {
                    throw new TypeError('structured parameter packer returned an invalid byte block');
                }
            }
            payload.wasmParams = wasmParams;
            payload.wasmParamsHash = packer.hash >>> 0;
            if (wasmParamBytes) payload.wasmParamBytes = wasmParamBytes;
            this._dspPackingFailed = false;
        } catch (error) {
            if (!this._dspPackingFailed) {
                console.warn(`[dsp-wasm] Parameter packing failed for ${type}; using the JS path.`, error);
                this._dspPackingFailed = true;
            }
        }
        return payload;
    }

    // Get current parameters; can be overridden by subclasses.
    getParameters() {
        return {
            type: this.constructor.name,
            id: this.id,
            enabled: this.enabled,
            ...(this.inputBus !== null && { inputBus: this.inputBus }),
            ...(this.outputBus !== null && { outputBus: this.outputBus }),
            ...(this.channel !== null && { channel: this.channel })
        };
    }

    // Return serializable parameters for URL state using a deep copy.
    getSerializableParameters() {
        const params = this.getParameters();
        const serializedParams = JSON.parse(JSON.stringify(params));
        // Remove internal properties that should not be serialized
        const { type, id, inputBus, outputBus, channel, ...cleanParams } = serializedParams;
        
        // Add input and output bus with short names if they exist
        if (inputBus !== undefined) {
            cleanParams.ib = inputBus;
        }
        if (outputBus !== undefined) {
            cleanParams.ob = outputBus;
        }
        // Add channel with short name if it exists and is not default (Stereo which is null)
        if (channel !== null && channel !== undefined) {
            cleanParams.ch = channel;
        }
        
        return cleanParams;
    }

    // Set parameters from a serialized state.
    setSerializedParameters(params) {
        const { nm, en, id, ib, ob, ch, ...pluginParams } = params;
        const parameters = {
            type: this.constructor.name,
            enabled: en,
            ...(id !== undefined && { id }),
            ...(ib !== undefined && { inputBus: ib }),
            ...(ob !== undefined && { outputBus: ob }),
            ...(ch !== undefined && { channel: ch }),
            ...pluginParams
        };
        this.setParameters(parameters);
    }

    // Set parameters (must be implemented by subclasses).
    setParameters(params) {
        try {
            this._validateParameters(params);
            this._setValidatedParameters(params);
        } catch (error) {
            this._handleError('Parameter Error', error.message);
        }
    }

    // Validate parameters (can be overridden by subclasses).
    _validateParameters(params) {
        if (params === null || typeof params !== 'object') {
            throw new Error('Parameters must be an object');
        }
    }

    parseFiniteNumber(value, min, max, previous) {
        let numericValue;
        if (typeof value === 'number') {
            numericValue = value;
        } else if (typeof value === 'string') {
            const trimmedValue = value.trim();
            if (trimmedValue === '') {
                return Number.isFinite(previous) ? previous : min;
            }
            numericValue = Number(trimmedValue);
        } else {
            return Number.isFinite(previous) ? previous : min;
        }

        if (!Number.isFinite(numericValue)) {
            return Number.isFinite(previous) ? previous : min;
        }
        if (numericValue < min) return min;
        if (numericValue > max) return max;
        return numericValue;
    }

    isAllowedEnum(value, allowed, previous) {
        return allowed.includes(value) ? value : previous;
    }

    // Apply validated parameters (must be implemented by subclasses).
    _setValidatedParameters(params) {
        // Set common parameters
        if (params.enabled !== undefined) {
            this.enabled = Boolean(params.enabled);
        }
        
        // Set bus parameters
        if (params.inputBus !== undefined) {
            this.inputBus = params.inputBus;
        }
        if (params.outputBus !== undefined) {
            this.outputBus = params.outputBus;
        }
        if (params.channel !== undefined) {
            this.channel = params.channel;
        }
        
        // Subclasses must override this method to handle their specific parameters
        // but should call super._setValidatedParameters(params) to handle common parameters
    }

    // Handle errors by storing error state and updating the error UI.
    _handleError(type, message) {
        this.errorState = {
            type: type,
            message: message,
            timestamp: Date.now()
        };
        this._updateErrorUI();
        console.error(`[${this.name}] ${type}: ${message}`);
    }

    // Update the error UI display.
    _updateErrorUI() {
        const container = document.getElementById(`plugin-${this.id}`);
        if (!container) return;

        const existingError = container.querySelector('.plugin-error');
        if (existingError) {
            existingError.remove();
        }
        if (this.errorState) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'plugin-error';
            errorDiv.innerHTML = `
                <div class="error-header">${this.errorState.type}</div>
                <div class="error-message">${this.errorState.message}</div>
                <div class="error-timestamp">${new Date(this.errorState.timestamp).toLocaleTimeString()}</div>
            `;
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.remove();
                    this.errorState = null;
                }
            }, 5000);
            container.appendChild(errorDiv);
        }
    }

    // Helper function to create slider/number input parameter controls
    createParameterControl(label, min, max, step, value, setter, unit = '') {
        const row = document.createElement('div');
        row.className = 'parameter-row';

        const paramName = label.toLowerCase().replace(/\s+/g, '-');
        const sliderId = `${this.id}-${this.name}-${paramName}-slider`;
        const valueId = `${this.id}-${this.name}-${paramName}-value`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}${unit ? ' (' + unit + ')' : ''}:`;
        labelEl.htmlFor = sliderId;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.name = sliderId;
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        slider.autocomplete = "off";

        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.id = valueId;
        valueInput.name = valueId;
        valueInput.min = min;
        valueInput.max = max;
        valueInput.step = step;
        valueInput.value = value;
        valueInput.autocomplete = "off";

        slider.addEventListener('input', (e) => {
            // Use setter directly, assuming it handles parseFloat if needed
            setter(parseFloat(e.target.value));
            valueInput.value = e.target.value; // Keep number input synced
        });

        valueInput.addEventListener('input', (e) => {
            // Allow typing slightly outside bounds temporarily before clamping on blur/enter
            // Use setter immediately, assuming it handles parseFloat if needed
            const val = parseFloat(e.target.value) || 0; // Use 0 as fallback for invalid input
            setter(val); // Update internal value immediately
            // Update slider thumb, clamping it within bounds
            slider.value = Math.max(min, Math.min(max, val));
        });

        // Clamp value on blur or Enter key press for the number input
         const clampAndUpdate = (e) => {
            const val = parseFloat(e.target.value) || 0; // Use 0 as fallback
            const clampedVal = Math.max(min, Math.min(max, val));
            // Only update if the value was actually clamped
            if (clampedVal !== val) {
                setter(clampedVal); // Ensure internal state matches clamped value
                e.target.value = clampedVal; // Update display
                slider.value = clampedVal;   // Update slider thumb
            } else if (isNaN(val)) { // Handle NaN case explicitly
                 setter(min); // Or some default fallback like min
                 e.target.value = min;
                 slider.value = min;
            }
         };
         valueInput.addEventListener('blur', clampAndUpdate);
         valueInput.addEventListener('keydown', (e) => {
             if (e.key === 'Enter') {
                 clampAndUpdate(e);
                 e.preventDefault(); // Prevent form submission if inside a form
             }
         });


        row.appendChild(labelEl);
        row.appendChild(slider);
        row.appendChild(valueInput);

        return row;
    }

    // Helper function to create logarithmic slider/number input parameter controls
    // The slider displays logarithmically but the actual value remains linear
    createLogarithmicParameterControl(label, min, max, step, value, setter, unit = '') {
        const row = document.createElement('div');
        row.className = 'parameter-row';

        const paramName = label.toLowerCase().replace(/\s+/g, '-');
        const sliderId = `${this.id}-${this.name}-${paramName}-slider`;
        const valueId = `${this.id}-${this.name}-${paramName}-value`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}${unit ? ' (' + unit + ')' : ''}:`;
        labelEl.htmlFor = sliderId;

        // Logarithmic conversion functions
        const logMin = Math.log10(min);
        const logMax = Math.log10(max);
        const logRange = logMax - logMin;

        // Convert linear value to logarithmic slider position (0-100)
        const linearToLogSlider = (linearValue) => {
            const logValue = Math.log10(linearValue);
            return ((logValue - logMin) / logRange) * 100;
        };

        // Convert logarithmic slider position (0-100) to linear value
        const logSliderToLinear = (sliderPos) => {
            const logValue = logMin + (sliderPos / 100) * logRange;
            return Math.pow(10, logValue);
        };

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.name = sliderId;
        slider.min = 0;
        slider.max = 100;
        slider.step = 0.1;
        slider.value = linearToLogSlider(value);
        slider.autocomplete = "off";

        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.id = valueId;
        valueInput.name = valueId;
        valueInput.min = min;
        valueInput.max = max;
        valueInput.step = step;
        valueInput.value = value.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0));
        valueInput.autocomplete = "off";

        slider.addEventListener('input', (e) => {
            const linearValue = logSliderToLinear(parseFloat(e.target.value));
            setter(linearValue);
            valueInput.value = linearValue.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0));
        });

        valueInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value) || min;
            const clampedVal = Math.max(min, Math.min(max, val));
            setter(clampedVal);
            e.target.value = clampedVal.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0));
            slider.value = linearToLogSlider(clampedVal);
        });

        // Clamp value on blur or Enter key press for the number input
        const clampAndUpdate = (e) => {
            const val = parseFloat(e.target.value) || min;
            const clampedVal = Math.max(min, Math.min(max, val));
            if (clampedVal !== val) {
                setter(clampedVal);
                e.target.value = clampedVal.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0));
                slider.value = linearToLogSlider(clampedVal);
            } else if (isNaN(val)) {
                setter(min);
                e.target.value = min.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0));
                slider.value = linearToLogSlider(min);
            }
        };
        valueInput.addEventListener('blur', clampAndUpdate);
        valueInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clampAndUpdate(e);
                e.preventDefault();
            }
        });

        row.appendChild(labelEl);
        row.appendChild(slider);
        row.appendChild(valueInput);

        return row;
    }

    createSelectControl(label, options, value, setter) {
        const row = document.createElement('div');
        row.className = 'parameter-row';
        const paramName = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const selectId = `${this.id}-${this.name}-${paramName}-select`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}:`;
        labelEl.htmlFor = selectId;

        const select = document.createElement('select');
        select.id = selectId;
        select.name = selectId;
        select.autocomplete = 'off';

        options.forEach(option => {
            const optionEl = document.createElement('option');
            optionEl.value = typeof option === 'string' ? option : option.value;
            optionEl.textContent = typeof option === 'string' ? option : option.label;
            select.appendChild(optionEl);
        });
        select.value = value;
        select.addEventListener('change', event => setter(event.target.value));

        row.appendChild(labelEl);
        row.appendChild(select);
        return row;
    }

    createCheckboxControl(label, checked, setter) {
        const row = document.createElement('div');
        row.className = 'parameter-row checkbox-row';
        const paramName = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const checkboxId = `${this.id}-${this.name}-${paramName}-checkbox`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}:`;
        labelEl.htmlFor = checkboxId;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = checkboxId;
        checkbox.name = checkboxId;
        checkbox.checked = !!checked;
        checkbox.autocomplete = 'off';
        checkbox.addEventListener('change', event => setter(event.target.checked));

        row.appendChild(labelEl);
        row.appendChild(checkbox);
        return row;
    }

    createRadioGroup(label, options, value, setter) {
        const row = document.createElement('div');
        row.className = 'parameter-row radio-group';
        const paramName = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const groupName = `${this.id}-${this.name}-${paramName}`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}:`;
        row.appendChild(labelEl);

        options.forEach((option, index) => {
            const optionValue = typeof option === 'string' ? option : option.value;
            const optionLabel = typeof option === 'string' ? option : option.label;
            const radioId = `${groupName}-${index}`;

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.id = radioId;
            radio.name = groupName;
            radio.value = optionValue;
            radio.checked = optionValue === value;
            radio.autocomplete = 'off';
            radio.addEventListener('change', event => {
                if (event.target.checked) setter(event.target.value);
            });

            const radioLabel = document.createElement('label');
            radioLabel.htmlFor = radioId;
            radioLabel.textContent = optionLabel;

            row.appendChild(radio);
            row.appendChild(radioLabel);
        });

        return row;
    }

    createGraphContainer({ maxWidth = 1024, canvasWidth, canvasHeight, className } = {}) {
        const container = document.createElement('div');
        container.className = className ? `graph-container ${className}` : 'graph-container';
        container.style.width = '100%';
        container.style.maxWidth = `${maxWidth}px`;
        container.style.position = 'relative';

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;
        container.appendChild(canvas);

        return { container, canvas };
    }

    createResponsiveGraph({ maxWidth = 1024, aspectRatio = '2.5 / 1', mobileAspectRatio = null, className, onResize } = {}) {
        const container = document.createElement('div');
        container.className = className
            ? `graph-container responsive-graph-container ${className}`
            : 'graph-container responsive-graph-container';
        container.style.width = '100%';
        container.style.maxWidth = `${maxWidth}px`;
        container.style.position = 'relative';
        container.style.aspectRatio = aspectRatio;
        if (mobileAspectRatio) {
            if (typeof container.style.setProperty === 'function') {
                container.style.setProperty('--mobile-aspect-ratio', mobileAspectRatio);
            } else {
                container.style['--mobile-aspect-ratio'] = mobileAspectRatio;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        container.appendChild(canvas);

        let disposed = false;
        let observer = null;
        let windowResizeHandler = null;

        const resize = () => {
            if (disposed) return;
            const rect = container.getBoundingClientRect();
            const cssWidth = rect.width || container.clientWidth || 0;
            const cssHeight = rect.height || container.clientHeight || 0;
            if (!cssWidth || !cssHeight) return;

            const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
            const width = Math.max(1, Math.round(cssWidth * dpr));
            const height = Math.max(1, Math.round(cssHeight * dpr));
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;

            onResize?.({ canvas, cssWidth, cssHeight, dpr });
        };

        const ResizeObserverClass = typeof ResizeObserver !== 'undefined'
            ? ResizeObserver
            : (typeof window !== 'undefined' ? window.ResizeObserver : null);
        if (typeof ResizeObserverClass === 'function') {
            observer = new ResizeObserverClass(resize);
            observer.observe(container);
        } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            windowResizeHandler = resize;
            window.addEventListener('resize', windowResizeHandler);
        }

        const scheduleInitialResize = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame.bind(window)
                : null);
        if (scheduleInitialResize) {
            scheduleInitialResize(resize);
        } else {
            setTimeout(resize, 0);
        }

        const dispose = () => {
            if (disposed) return;
            disposed = true;
            this._responsiveGraphDisposers?.delete(dispose);
            observer?.disconnect();
            observer = null;
            if (windowResizeHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
                window.removeEventListener('resize', windowResizeHandler);
            }
            windowResizeHandler = null;
        };

        this._responsiveGraphDisposers?.add(dispose);
        return { container, canvas, resize, dispose };
    }

    getGraphCoords(canvas, ev) {
        const rect = canvas.getBoundingClientRect();
        const touch = ev.touches?.[0] || ev.changedTouches?.[0];
        const clientX = ev.clientX ?? touch?.clientX ?? rect.left;
        const clientY = ev.clientY ?? touch?.clientY ?? rect.top;
        const rectWidth = rect.width || canvas.width || 1;
        const rectHeight = rect.height || canvas.height || 1;
        return {
            x: (clientX - rect.left) * (canvas.width / rectWidth),
            y: (clientY - rect.top) * (canvas.height / rectHeight)
        };
    }

    bindGraphPointer(element, { onDragStart, onDragMove, onDragEnd, onTap } = {}) {
        let activePointerId = null;
        let startX = 0;
        let startY = 0;
        let startEvent = null;
        let dragging = false;
        const tapThreshold = 8;
        element.style.touchAction = 'none';

        const onPointerDown = event => {
            if (activePointerId !== null || event.isPrimary === false) return;
            activePointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            startEvent = event;
            dragging = false;
            element.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        };

        const onPointerMove = event => {
            if (activePointerId !== event.pointerId) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (!dragging && distance >= tapThreshold) {
                dragging = true;
                onDragStart?.(startEvent || event);
            }
            if (dragging) {
                onDragMove?.(event);
                event.preventDefault();
            }
        };

        const finishPointer = event => {
            if (activePointerId !== event.pointerId) return;
            element.releasePointerCapture?.(event.pointerId);
            if (dragging) {
                onDragEnd?.(event);
            } else {
                onTap?.(event);
            }
            activePointerId = null;
            startEvent = null;
            dragging = false;
            event.preventDefault();
        };

        const cancelPointer = event => {
            if (activePointerId !== event.pointerId) return;
            element.releasePointerCapture?.(event.pointerId);
            if (dragging) {
                onDragEnd?.(event);
            }
            activePointerId = null;
            startEvent = null;
            dragging = false;
            event.preventDefault();
        };

        element.addEventListener('pointerdown', onPointerDown);
        element.addEventListener('pointermove', onPointerMove);
        element.addEventListener('pointerup', finishPointer);
        element.addEventListener('pointercancel', cancelPointer);

        return () => {
            element.removeEventListener('pointerdown', onPointerDown);
            element.removeEventListener('pointermove', onPointerMove);
            element.removeEventListener('pointerup', finishPointer);
            element.removeEventListener('pointercancel', cancelPointer);
        };
    }

    // Intelligently place the freq/gain text labels attached to graph markers
    // (e.g. the PEQ family) so they do not collide with each other, do not sit
    // on top of other markers, and never spill outside the graph box.
    //
    // Each label element is expected to be absolutely positioned inside its
    // marker (the marker being its offsetParent). We try a set of candidate
    // offsets around the marker in a preference order, score each by how much
    // it overlaps already-placed labels / other markers and how far it had to
    // be clamped to stay inside the box, then commit the best one.
    //
    // @param {Object} opts
    // @param {Array}  opts.items  - [{ el, cx, cy }] label element + marker centre (px, container-local)
    // @param {number} opts.width  - graph container width (px)
    // @param {number} opts.height - graph container height (px)
    // @param {string} [opts.axis='horizontal'] - preferred side: 'horizontal' (left/right) or 'vertical' (top/bottom)
    // @param {number} [opts.radius=14] - marker radius (px), border box
    // @param {number} [opts.gap=6]     - gap between marker edge and label (px)
    layoutMarkerLabels({ items, width, height, axis = 'horizontal', radius = 14, gap = 6 } = {}) {
        if (!items || !items.length || !width || !height) return;

        // Pass 1: batch-read every label's rendered size (avoids layout thrash).
        const labels = items.map(it => {
            const el = it.el;
            return { el, cx: it.cx, cy: it.cy, w: el ? el.offsetWidth : 0, h: el ? el.offsetHeight : 0 };
        });
        const markers = labels.map(l => ({ cx: l.cx, cy: l.cy, r: radius }));

        const overlap = (a, b) => {
            const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
            const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
            return ox * oy;
        };

        const placed = [];
        // Pass 2: place and write inline styles for every label.
        for (let i = 0; i < labels.length; i++) {
            const { el, cx, cy, w, h } = labels[i];
            if (!el || !w || !h) continue;

            const d = radius + gap;          // straight offset (E/W/N/S)
            const dd = radius * 0.7 + gap;    // diagonal offset (corners)
            const dirs = {
                E:  { x: cx + d,      y: cy - h / 2 },
                W:  { x: cx - d - w,  y: cy - h / 2 },
                N:  { x: cx - w / 2,  y: cy - d - h },
                S:  { x: cx - w / 2,  y: cy + d },
                NE: { x: cx + dd,     y: cy - dd - h },
                NW: { x: cx - dd - w, y: cy - dd - h },
                SE: { x: cx + dd,     y: cy + dd },
                SW: { x: cx - dd - w, y: cy + dd }
            };
            // Prefer pushing the label toward the OUTSIDE of the graph (away
            // from the centre) so labels fan out to the edges instead of
            // bunching up in the middle. H/V are the outward directions for
            // this marker; Hi/Vi the inward fallbacks. Straight up/down (N/S)
            // and straight left/right (E/W) are always candidates.
            const H = cx < width / 2 ? 'W' : 'E';
            const Hi = H === 'W' ? 'E' : 'W';
            const V = cy < height / 2 ? 'N' : 'S';
            const Vi = V === 'N' ? 'S' : 'N';
            const diag = (v, h) => v + h; // 'N'/'S' + 'W'/'E' -> NE/NW/SE/SW
            let order;
            if (axis === 'vertical') {
                // Straight out along the vertical axis first, then fan sideways.
                order = [V, diag(V, H), H, diag(V, Hi), Hi, diag(Vi, H), Vi, diag(Vi, Hi)];
            } else {
                // Straight out along the horizontal axis first, then fan up/down.
                order = [H, diag(V, H), V, diag(Vi, H), Vi, diag(V, Hi), Hi, diag(Vi, Hi)];
            }

            let best = null;
            let bestScore = Infinity;
            for (let k = 0; k < order.length; k++) {
                const cand = dirs[order[k]];
                const bx = Math.max(0, Math.min(cand.x, width - w));
                const by = Math.max(0, Math.min(cand.y, height - h));
                const moved = Math.abs(bx - cand.x) + Math.abs(by - cand.y);
                const box = { x: bx, y: by, w, h };
                // Keep the label as close to its marker as possible: distance
                // from marker centre to label centre is the main cost, so a
                // straight N/S/E/W spot (nearer) always beats a diagonal one
                // (farther) when both are collision-free. The outward-order
                // rank (k) is only a gentle tie-breaker between similar spots,
                // never enough to override a genuinely closer placement.
                const dx = (bx + w / 2) - cx;
                const dy = (by + h / 2) - cy;
                let score = Math.sqrt(dx * dx + dy * dy) + moved + k * 1.5;
                // Penalise overlap with EVERY marker, including this label's own
                // marker: near the top/bottom edge a straight up/down candidate
                // gets clamped back inside and would otherwise land on top of its
                // marker. Counting self-overlap pushes it out to the side (E/W)
                // or the opposite (down/up) side instead.
                for (let m = 0; m < markers.length; m++) {
                    const mk = markers[m];
                    score += overlap(box, { x: mk.cx - mk.r, y: mk.cy - mk.r, w: mk.r * 2, h: mk.r * 2 }) * 4;
                }
                for (let p = 0; p < placed.length; p++) {
                    score += overlap(box, placed[p]) * 5;
                }
                if (score < bestScore) { bestScore = score; best = box; }
            }
            if (!best) continue;
            placed.push(best);

            // Convert container-local box top-left into marker-relative offsets.
            // The label's offsetParent is the marker; its containing block origin
            // sits half a marker-width in from the marker centre.
            const parent = el.offsetParent;
            const halfW = parent ? parent.clientWidth / 2 : 12;
            const halfH = parent ? parent.clientHeight / 2 : 12;
            el.style.left = `${best.x - (cx - halfW)}px`;
            el.style.top = `${best.y - (cy - halfH)}px`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            el.style.transform = 'none';
            el.style.textAlign = 'center';
        }
    }

    // Create UI elements for the plugin (must be implemented by subclasses).
    createUI() {
        // Default implementation returns an empty container
        return document.createElement('div');
    }

    // Cleanup resources (should be overridden by subclasses).
    cleanup() {
        this._disposeResponsiveGraphs();

        if (this._messageHandlerObserver) {
            this._messageHandlerObserver.disconnect();
            this._messageHandlerObserver = null;
        }

        if (this._messageHandlerWorkletNode?.port && this._hasMessageHandler) {
            try {
                this._messageHandlerWorkletNode.port.removeEventListener('message', this._boundHandleMessage);
            } catch (error) {
                // Ignore stale port cleanup failures.
            }
        }
        this._messageHandlerWorkletNode = null;
        this._hasMessageHandler = false;

        if (this._pendingTimeoutId !== null) {
            clearTimeout(this._pendingTimeoutId);
            this._pendingTimeoutId = null;
        }
        this.pendingUpdate = null;
    }

    // Enable or disable the plugin.
    //
    // When a plugin exposes startAnimation()/stopAnimation() (used by
    // analyzer-style plugins to drive a per-frame canvas redraw), pause that
    // loop while the plugin is effectively disabled (either by its own ON
    // button or by its enclosing Section being OFF). Previously the redraw
    // loop kept running at the display refresh rate even when disabled,
    // which wasted main-thread CPU on low-power hardware.
    setEnabled(enabled) {
        if (this.enabled !== enabled) {
            this.enabled = enabled;
            this.updateParameters();
            this._refreshAnimationState();
        }
    }

    // Called from the pipeline UI when the enclosing Section is toggled.
    // Stops the redraw loop while the section is OFF and starts it again
    // when the section comes back ON (provided the plugin itself is also
    // enabled).
    _setSectionEnabled(sectionEnabled) {
        sectionEnabled = sectionEnabled !== false;
        if (this._sectionEnabled !== sectionEnabled) {
            this._sectionEnabled = sectionEnabled;
            this._refreshAnimationState();
        }
    }

    // Start or stop the redraw loop to match the current effective-enabled
    // state. Plugins that do not expose startAnimation/stopAnimation are
    // unaffected.
    _refreshAnimationState() {
        if (typeof this.startAnimation !== 'function' ||
            typeof this.stopAnimation !== 'function') {
            return;
        }
        if (this.enabled && this._sectionEnabled) {
            this.startAnimation();
        } else {
            this.stopAnimation();
        }
    }

    // Create channel select control for plugin UI
    createChannelSelectControl() {
        const row = document.createElement('div');
        row.className = 'parameter-row channel-select-row';
        
        const label = document.createElement('label');
        label.textContent = 'Channel:';
        
        const select = document.createElement('select');
        select.id = `${this.id}-channel-select`;
        
        // Get output channel count from audio context
        let outputChannelCount = 2;
        if (window.audioContext && window.audioContext.destination) {
            outputChannelCount = window.audioContext.destination.channelCount || 2;
        }
        
        // Add channel options
        const options = [
            { value: '', text: 'Stereo' }, // Default now renamed to 'Stereo' - processes first 2 channels only
            { value: 'A', text: 'All' },   // New option - process all available channels
            { value: 'L', text: 'Left' },  // Process left channel only
            { value: 'R', text: 'Right' }  // Process right channel only
        ];
        
        // Add channel pair options if output channel count is high enough
        if (outputChannelCount >= 4) {
            options.push({ value: '34', text: '3+4' });
        }
        if (outputChannelCount >= 6) {
            options.push({ value: '56', text: '5+6' });
        }
        if (outputChannelCount >= 8) {
            options.push({ value: '78', text: '7+8' });
        }
        
        // Add individual channel options based on output channel count
        for (let i = 3; i <= Math.min(outputChannelCount, 8); i++) {
            options.push({ value: String(i), text: `Ch ${i}` });
        }
        
        // Create option elements
        options.forEach(option => {
            const optionEl = document.createElement('option');
            optionEl.value = option.value;
            optionEl.textContent = option.text;
            if (this.channel === option.value) {
                optionEl.selected = true;
            }
            select.appendChild(optionEl);
        });
        
        // Add event listener
        select.addEventListener('change', (e) => {
            this.channel = e.target.value === '' ? null : e.target.value;
            this.updateParameters();
        });
        
        row.appendChild(label);
        row.appendChild(select);
        
        return row;
    }
}
