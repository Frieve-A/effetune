/**
 * Utility functions for serializing and deserializing plugin state
 * This centralized module handles all plugin state serialization/deserialization
 * for URL encoding, clipboard operations, presets, and app state persistence.
 */

/**
 * Get serializable state for a plugin with short names (nm/en/ib/ob)
 * Used for URL encoding, clipboard, and old format presets
 * @param {Object} plugin - The plugin to get state for
 * @returns {Object} Serializable plugin state with short names
 */
export function getSerializablePluginStateShort(plugin) {
    // Get serializable parameters
    let params = plugin.getSerializableParameters ?
        plugin.getSerializableParameters() : {};
    
    // If getSerializableParameters is not available, try getParameters
    if (!params && plugin.getParameters) {
        params = JSON.parse(JSON.stringify(plugin.getParameters()));
    }
    
    // If neither method is available, use plugin.parameters directly
    if (!params && plugin.parameters) {
        params = JSON.parse(JSON.stringify(plugin.parameters));
    }
    
    // Ensure we have at least an empty object
    params = params || {};
    
    // Remove id, type, and enabled from params if they exist
    const { id, type, enabled, ...cleanParams } = params;
    
    // Create the final state object with short names
    const result = {
        ...cleanParams,
        nm: plugin.name,
        en: plugin.enabled
    };
    
    // Add input and output bus with short names if they exist
    if (plugin.inputBus !== null && plugin.inputBus !== undefined) {
        result.ib = plugin.inputBus;
    }
    if (plugin.outputBus !== null && plugin.outputBus !== undefined) {
        result.ob = plugin.outputBus;
    }
    if (plugin.channel !== null && plugin.channel !== undefined) {
        result.ch = plugin.channel;
    }
    
    return result;
}

/**
 * Get serializable state for a plugin with long names (name/enabled/parameters)
 * Used for new format presets and app state persistence
 * @param {Object} plugin - The plugin to get state for
 * @param {boolean} useDeepCopy - Whether to create a deep copy of parameters
 * @returns {Object} Serializable plugin state with long names
 */
export function getSerializablePluginStateLong(plugin, useDeepCopy = false) {
    // Get serializable parameters
    let params = plugin.getSerializableParameters ?
        plugin.getSerializableParameters() : {};
    
    // If getSerializableParameters is not available, try getParameters
    if (!params && plugin.getParameters) {
        params = JSON.parse(JSON.stringify(plugin.getParameters()));
    }
    
    // If neither method is available, use plugin.parameters directly
    if (!params && plugin.parameters) {
        params = JSON.parse(JSON.stringify(plugin.parameters));
    }
    
    // Ensure we have at least an empty object
    params = params || {};
    
    // Create a deep copy if requested
    if (useDeepCopy) {
        params = JSON.parse(JSON.stringify(params));
    }
    
    // Remove id and enabled from params if they exist
    const { id, enabled, ...cleanParams } = params;
    
    // Create the final state object with long names
    const result = {
        name: plugin.name,
        enabled: plugin.enabled,
        parameters: cleanParams
    };
    
    // Add input and output bus at the top level if they exist
    if (plugin.inputBus !== null && plugin.inputBus !== undefined) {
        result.inputBus = plugin.inputBus;
    }
    if (plugin.outputBus !== null && plugin.outputBus !== undefined) {
        result.outputBus = plugin.outputBus;
    }
    if (plugin.channel !== null && plugin.channel !== undefined) {
        result.channel = plugin.channel;
    }
    return result;
}

/**
 * Apply serialized state to a plugin
 * @param {Object} plugin - The plugin to apply state to
 * @param {Object} state - The serialized state to apply (short or long format)
 */
export function applySerializedState(plugin, state) {
    if (!plugin || !state) return;
    
    // Helper function to normalize channel value
    const normalizeChannel = (chValue) => {
        if (chValue === 'Left') return 'L';
        if (chValue === 'Right') return 'R';
        if (chValue === 'All') return 'A';
        if (chValue === '') return null;
        
        // Handle individual channels (3-8) and stereo channel pairs
        if (typeof chValue === 'string' &&
            (/^[3-8]$/.test(chValue) || ['34', '56', '78'].includes(chValue))) {
            return chValue;
        }
        
        // Check for legacy 'All' value (was equivalent to null before multi-channel support)
        if (chValue === null) return null;
        
        // Keep normalized aliases as is. Numeric channels are handled above.
        if (chValue === 'L' || chValue === 'R' || chValue === 'A') {
            return chValue;
        }
        
        // Default to null (Stereo) for any other values
        return null;
    };
    
    const format = state.nm !== undefined
        ? 'short'
        : (state.name !== undefined ? 'long' : null);
    const applyState = () => {
        // Handle both short and long format
        if (format === 'short') {
            // Short format (nm/en/ib/ob/ch)
            plugin.name = state.nm;

            if (state.en !== undefined) {
                plugin.setEnabled(state.en);
            }

            if (state.ib !== undefined) {
                plugin.inputBus = state.ib;
            }
            if (state.ob !== undefined) {
                plugin.outputBus = state.ob;
            }

            // Apply channel, normalizing for compatibility
            plugin.channel = normalizeChannel(state.ch);

            // Extract parameters from state
            const { nm, en, ib, ob, ch, ...params } = state;

            // Apply parameters
            if (plugin.setSerializedParameters) {
                plugin.setSerializedParameters(state);
            } else if (plugin.setParameters) {
                plugin.setParameters(params);
            } else if (plugin.parameters) {
                Object.assign(plugin.parameters, params);
            }
        } else if (format === 'long') {
            // Long format (name/enabled/parameters/inputBus/outputBus/channel)
            plugin.name = state.name;

            if (state.enabled !== undefined) {
                plugin.setEnabled(state.enabled);
            }

            if (state.inputBus !== undefined) {
                plugin.inputBus = state.inputBus;
            }
            if (state.outputBus !== undefined) {
                plugin.outputBus = state.outputBus;
            }

            // Apply channel, normalizing for compatibility
            // Assuming channel is stored at the top level in long format as well
            plugin.channel = normalizeChannel(state.channel);

            // Apply parameters
            if (state.parameters) {
                if (plugin.setSerializedParameters) {
                    plugin.setSerializedParameters(state.parameters);
                } else if (plugin.setParameters) {
                    plugin.setParameters(state.parameters);
                } else if (plugin.parameters) {
                    Object.assign(plugin.parameters, state.parameters);
                }
            }
        }

        // Update parameters if method exists
        if (plugin.updateParameters) {
            plugin.updateParameters();
        }

        // Push the restored model back into a live plugin's UI. Writing .value/.checked
        // from script dispatches no input/change event, so this cannot feed back into
        // the model (see plugins/plugin-base.js syncUIControls()).
        plugin.syncUIControls?.();
    };

    const historyManager = plugin.audioManager?.pipelineManager?.historyManager;
    return historyManager
        ? historyManager.withHistorySuppressed(applyState)
        : applyState();
}

/**
 * Convert a plugin state from long format to short format
 * @param {Object} longState - Plugin state in long format (name/enabled/parameters)
 * @returns {Object} Plugin state in short format (nm/en/ib/ob)
 */
export function convertLongToShortFormat(longState) {
    if (!longState) return null;
    
    const result = {
        nm: longState.name,
        en: longState.enabled,
        ...longState.parameters
    };
    
    if (longState.inputBus !== undefined) {
        result.ib = longState.inputBus;
    }
    if (longState.outputBus !== undefined) {
        result.ob = longState.outputBus;
    }
    // Add channel short name if channel exists in long format
    if (longState.channel !== undefined && longState.channel !== null) {
        result.ch = longState.channel;
    }
    
    return result;
}

/**
 * Convert a plugin state from short format to long format
 * @param {Object} shortState - Plugin state in short format (nm/en/ib/ob)
 * @returns {Object} Plugin state in long format (name/enabled/parameters)
 */
export function convertShortToLongFormat(shortState) {
    if (!shortState) return null;
    
    const { nm, en, ib, ob, ch, ...params } = shortState; // Extract ch here
    
    const result = {
        name: nm,
        enabled: en,
        parameters: params
    };
    
    if (ib !== undefined) {
        result.inputBus = ib;
    }
    if (ob !== undefined) {
        result.outputBus = ob;
    }
    // Add channel long name if ch exists in short format
    if (ch !== undefined && ch !== null) {
        result.channel = ch;
    }
    
    return result;
}

/**
 * Convert a preset from long format to short format
 * @param {Object} preset - Preset in long format (pipeline array)
 * @returns {Object} Preset in short format (plugins array)
 */
export function convertPresetToShortFormat(preset) {
    if (!preset || !preset.pipeline || !Array.isArray(preset.pipeline)) {
        return preset; // Return as is if not in expected format
    }
    
    return {
        name: preset.name || 'Converted Preset',
        plugins: preset.pipeline.map(pluginState => convertLongToShortFormat(pluginState))
    };
}

/**
 * Convert a preset from short format to long format
 * @param {Object} preset - Preset in short format (plugins array)
 * @returns {Object} Preset in long format (pipeline array)
 */
export function convertPresetToLongFormat(preset) {
    if (!preset || !preset.plugins || !Array.isArray(preset.plugins)) {
        return preset; // Return as is if not in expected format
    }
    
    return {
        name: preset.name || 'Converted Preset',
        pipeline: preset.plugins.map(pluginState => convertShortToLongFormat(pluginState)),
        timestamp: preset.timestamp || Date.now()
    };
}
