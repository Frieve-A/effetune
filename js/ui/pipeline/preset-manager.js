/**
 * PresetManager - Handles preset loading, saving, and deletion
 * Manages preset UI and storage (localStorage for web, file system for Electron)
 */
import { getSerializablePluginStateShort, applySerializedState } from '../../utils/serialization-utils.js';
import {
    appendExternalAssetWarningSnapshot,
    captureExternalAssetWarning
} from './external-asset-info.js';
export class PresetManager {
    /**
     * Create a new PresetManager instance
     * @param {Object} pipelineManager - The pipeline manager instance
     * @param {Object} audioManager - The audio manager instance
     */
    constructor(pipelineManager) {
        this.pipelineManager = pipelineManager;
        this.audioManager = pipelineManager.audioManager;
        
        // Preset UI elements
        this.presetSelect = document.getElementById('presetSelect');
        this.presetClearButton = document.getElementById('presetClearButton');
        this.savePresetButton = document.getElementById('savePresetButton');
        this.deletePresetButton = document.getElementById('deletePresetButton');
        this.presetMutationAttemptRevision = 0;
        this.presetMutationQueue = Promise.resolve();
        
        // Initialize preset management (async)
        this.initPresetManagement().catch(error => {
            console.error('Failed to initialize preset management:', error);
        });
    }
    
    /**
     * Initialize preset management
     */
    async initPresetManagement() {
        // Load presets from local storage or file
        await this.loadPresetList();
        
        // Save preset button
        this.savePresetButton.addEventListener('click', async () => {
            const name = this.presetSelect.value.trim();
            if (name) {
                await this.savePreset(name);
            }
        });
        
        // Delete preset button
        this.deletePresetButton.addEventListener('click', async () => {
            const name = this.presetSelect.value.trim();
            const presets = await this.getPresets();
            if (name && presets[name] && confirm('Delete this preset?')) {
                await this.deletePreset(name);
            }
        });
        
        // Preset selection change
        this.presetSelect.addEventListener('change', async (e) => {
            this.updatePresetClearButton();
            const name = e.target.value.trim();
            const presets = await this.getLoadablePresets();
            if (presets[name]) {
                await this.loadPreset(name);
                // loadPresetList is already called inside loadPreset method
            }
        });

        this.presetSelect.addEventListener('input', () => {
            this.updatePresetClearButton();
        });

        if (this.presetClearButton) {
            this.presetClearButton.addEventListener('click', () => {
                this.presetSelect.value = '';
                this.updatePresetClearButton();
                this.presetSelect.focus();
            });
        }
    }

    updatePresetClearButton() {
        if (!this.presetClearButton) return;
        this.presetClearButton.classList.toggle('visible', this.presetSelect.value.length > 0);
    }
    
    /**
     * Load the preset list from storage
     * @param {string} preserveValue - Optional value to preserve in the select
     */
    async loadPresetList(preserveValue = null) {
        // Get datalist element
        const datalist = document.getElementById('presetList');
        if (!datalist) return;
        
        // Get current value or use preserveValue if provided
        const currentValue = preserveValue !== null ? preserveValue : this.presetSelect.value;
        
        // Clear existing options
        datalist.innerHTML = '';
        
        // Get presets from local storage or file
        const presets = await this.getLoadablePresets();
        
        // Add preset options (sorted alphabetically)
        Object.keys(presets).sort().forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            datalist.appendChild(option);
        });
        
        // Restore current value
        this.presetSelect.value = currentValue;
        this.updatePresetClearButton();
    }
    
    /**
     * Get presets from storage
     * @returns {Object} The presets object
     */
    async getPresets() {
        try {
            // Check if running in Electron environment
            if (window.electronAPI && window.electronIntegration && window.electronIntegration.isElectron) {
                // Get app path from Electron
                const appPath = await window.electronAPI.getPath('userData');
                
                // Use path.join for cross-platform compatibility
                const filePath = await window.electronAPI.joinPaths(appPath, 'effetune_presets.json');
                
                // Check if file exists
                const fileExists = await window.electronAPI.fileExists(filePath);
                
                if (!fileExists) {
                    return {};
                }
                
                // Read presets from file
                const result = await window.electronAPI.readFile(filePath);
                
                if (!result.success) {
                    throw new Error(result.error);
                }
                
                // Parse presets
                return JSON.parse(result.content);
            } else {
                // Fallback to localStorage for web version
                const presetsJson = localStorage.getItem('effetune_presets');
                return presetsJson ? JSON.parse(presetsJson) : {};
            }
        } catch (error) {
            console.error('Failed to load presets:', error);
            // Failed to load presets, return empty object
            return {};
        }
    }

    getPresetPluginStates(preset) {
        if (!preset || typeof preset !== 'object') {
            return null;
        }

        if (Array.isArray(preset.pipeline)) {
            return preset.pipeline.map(pluginState => ({
                name: pluginState && typeof pluginState.name === 'string' ? pluginState.name : ''
            }));
        }

        if (Array.isArray(preset.plugins)) {
            return preset.plugins.map(pluginState => ({
                name: pluginState && typeof pluginState.nm === 'string' ? pluginState.nm : ''
            }));
        }

        return null;
    }

    isPresetLoadable(preset) {
        const pluginStates = this.getPresetPluginStates(preset);
        if (!pluginStates) {
            return false;
        }

        const pluginManager = this.pipelineManager && this.pipelineManager.pluginManager;
        return pluginStates.every(({ name }) => {
            if (!name.trim()) {
                return false;
            }

            if (typeof pluginManager?.isPluginAvailable !== 'function') {
                return true;
            }

            try {
                return pluginManager.isPluginAvailable(name);
            } catch (error) {
                return false;
            }
        });
    }

    filterLoadablePresets(presets) {
        return Object.fromEntries(
            Object.entries(presets || {}).filter(([, preset]) => this.isPresetLoadable(preset))
        );
    }

    async getLoadablePresets() {
        return this.filterLoadablePresets(await this.getPresets());
    }

    enqueuePresetMutation(mutation) {
        const result = this.presetMutationQueue.then(mutation);
        this.presetMutationQueue = result.catch(() => {});
        return result;
    }

    async persistPresets(presets) {
        if (window.electronAPI && window.electronIntegration && window.electronIntegration.isElectron) {
            const appPath = await window.electronAPI.getPath('userData');
            const filePath = await window.electronAPI.joinPaths(appPath, 'effetune_presets.json');
            const result = await window.electronAPI.saveFile(
                filePath,
                JSON.stringify(presets, null, 2)
            );
            if (!result?.success) {
                throw new Error(result?.error || 'Preset file write failed');
            }
            return;
        }

        localStorage.setItem('effetune_presets', JSON.stringify(presets));
    }
    
    /**
     * Save a preset
     * @param {string} name - The name of the preset
     */
    async savePreset(name) {
        const attemptRevision = ++this.presetMutationAttemptRevision;
        const pipeline = [...this.audioManager.pipeline];
        // Create preset data with original format (plugins array)
        const pluginsData = pipeline.map(plugin =>
            getSerializablePluginStateShort(plugin)
        );
        const externalAssetWarning = captureExternalAssetWarning(pipeline);
        
        try {
            await this.enqueuePresetMutation(async () => {
                const presets = await this.getPresets();
                presets[name] = { plugins: pluginsData };
                await this.persistPresets(presets);
            });

            if (attemptRevision !== this.presetMutationAttemptRevision) return;
            
            // Update UI
            await this.loadPresetList(name);
            if (attemptRevision !== this.presetMutationAttemptRevision) return;
            
            // Update plugin list presets tab if it's visible
            if (window.uiManager && window.uiManager.pluginListManager) {
                await window.uiManager.pluginListManager.refreshPresetsIfVisible();
                if (attemptRevision !== this.presetMutationAttemptRevision) return;
            }
            
            // Update tray menu with new preset list
            if (window.electronIntegration && window.electronIntegration.isElectron) {
                const { updateTrayMenu } = await import('../../electron/menuIntegration.js');
                if (attemptRevision !== this.presetMutationAttemptRevision) return;
                await updateTrayMenu(true);
                if (attemptRevision !== this.presetMutationAttemptRevision) return;
            }
            
            if (window.uiManager) {
                window.uiManager.showTransientMessage(appendExternalAssetWarningSnapshot(
                    window.uiManager.t('success.presetSaved', { name }),
                    externalAssetWarning
                ), false, {}, 3000);
            }
        } catch (error) {
            console.error('Failed to save preset:', error);
            if (attemptRevision === this.presetMutationAttemptRevision && window.uiManager) {
                window.uiManager.showTransientMessage('error.failedToSavePreset', true, {}, 3000);
            }
        }
    }
    
    /**
     * Load a preset into the pipeline
     * @param {string|Object} nameOrPreset - The name of the preset to load from file/localStorage, or a preset object
     */
    async loadPreset(nameOrPreset) {
        let preset;
        let name;
        
        
        // Check if nameOrPreset is a string (preset name) or an object (preset data)
        if (typeof nameOrPreset === 'string') {
            // It's a preset name, load from file/localStorage
            name = nameOrPreset;
            const presets = await this.getPresets();
            preset = presets[name];
            
            if (!preset || !this.isPresetLoadable(preset)) {
                if (window.uiManager) {
                    window.uiManager.setError('error.invalidPresetData');
                }
                return;
            }
        } else if (typeof nameOrPreset === 'object' && nameOrPreset !== null) {
            // It's a preset object, use directly
            preset = nameOrPreset;
            name = preset.name || 'Imported Preset';
            if (!this.isPresetLoadable(preset)) {
                if (window.uiManager) {
                    window.uiManager.setError('error.invalidPresetData');
                }
                return;
            }
        } else {
            if (window.uiManager) {
                window.uiManager.setError('error.invalidPresetData');
            }
            return;
        }
        
        try {
            // Store expanded state for non-current pipeline before clearing
            const currentPipeline = this.audioManager.currentPipeline;
            const nonCurrentPipeline = currentPipeline === 'A' ? this.audioManager.pipelineB : this.audioManager.pipelineA;
            const nonCurrentExpandedPlugins = new Set();
            
            if (nonCurrentPipeline) {
                nonCurrentPipeline.forEach(plugin => {
                    if (this.pipelineManager.expandedPlugins.has(plugin)) {
                        nonCurrentExpandedPlugins.add(plugin);
                    }
                });
            }
            
            // Clean up existing plugins before removing them
            this.audioManager.pipeline.forEach(plugin => {
                if (typeof plugin.cleanup === 'function') {
                    plugin.cleanup();
                }
            });
            
            // Clear current pipeline and expanded plugins
            this.audioManager.pipeline.length = 0;
            this.pipelineManager.expandedPlugins.clear();
            
            let plugins = [];
            
            // Handle both old format (plugins array) and new format (pipeline array)
            if (preset.pipeline && Array.isArray(preset.pipeline)) {
                // New format
                plugins = preset.pipeline.map(pluginState => {
                    const plugin = this.pipelineManager.pluginManager.createPlugin(pluginState.name);
                    if (!plugin) return null;
                    
                    // Create a state object in the format expected by applySerializedState
                    const state = {
                        nm: pluginState.name,
                        en: pluginState.enabled,
                        ...(pluginState.inputBus !== undefined && { ib: pluginState.inputBus }),
                        ...(pluginState.outputBus !== undefined && { ob: pluginState.outputBus }),
                        ...(pluginState.channel !== undefined && { ch: pluginState.channel }),
                        ...pluginState.parameters
                    };
                    
                    // Apply serialized state
                    applySerializedState(plugin, state);
                    
                    this.pipelineManager.expandedPlugins.add(plugin);
                    return plugin;
                }).filter(plugin => plugin !== null);
            } else if (preset.plugins && Array.isArray(preset.plugins)) {
                // Old format
                plugins = preset.plugins.map(state => {
                    const plugin = this.pipelineManager.pluginManager.createPlugin(state.nm);
                    if (!plugin) return null;
                    
                    // Apply serialized state
                    applySerializedState(plugin, state);
                    
                    this.pipelineManager.expandedPlugins.add(plugin);
                    return plugin;
                }).filter(plugin => plugin !== null);
            } else {
                throw new Error('Unrecognized preset format');
            }
            
            // Update current pipeline (A or B) with new plugins
            this.audioManager.updateCurrentPipeline(plugins);
            
            // Restore expanded state for non-current pipeline
            if (nonCurrentPipeline) {
                nonCurrentPipeline.forEach(plugin => {
                    if (nonCurrentExpandedPlugins.has(plugin)) {
                        this.pipelineManager.expandedPlugins.add(plugin);
                    }
                });
            }
            
            // Update UI with force rebuild flag
            this.pipelineManager.core.updatePipelineUI(true);
            
            // Update worklet directly without rebuilding pipeline
            this.pipelineManager.core.updateWorkletPlugins();
            
            // Update preset list to ensure all presets are available
            // Pass the preset name to preserve it in the select
            const presetNameToPreserve = typeof nameOrPreset === 'string' ? nameOrPreset : null;
            await this.loadPresetList(presetNameToPreserve);
            
            // Ensure master bypass is OFF after loading preset
            this.pipelineManager.core.enabled = true;
            this.audioManager.setMasterBypass(false);
            const masterToggle = document.querySelector('.toggle-button.master-toggle');
            if (masterToggle) {
                masterToggle.classList.remove('off');
            }
            
            // Save state for undo/redo after loading preset
            // Set isUndoRedoOperation flag to prevent multiple save states from plugin automatic updates
            const historyManager = this.pipelineManager.historyManager;
            
            // Clear any existing timeout
            if (historyManager.undoRedoTimeoutId) {
                clearTimeout(historyManager.undoRedoTimeoutId);
            }
            
            // Set the flag to true to prevent automatic updates from triggering saveState
            historyManager.isUndoRedoOperation = true;
            
            // Set special override to allow one save despite the isUndoRedoOperation flag
            historyManager.specialSaveOverride = true;
            
            // Save the current state
            historyManager.saveState();
            
            // Keep the flag true for a short period to prevent multiple saves
            historyManager.undoRedoTimeoutId = setTimeout(() => {
                historyManager.isUndoRedoOperation = false;
                historyManager.undoRedoTimeoutId = null;
            }, 1000);
            
            // Display message only when loading from preset combo box (string name)
            if (window.uiManager && typeof nameOrPreset === 'string') {
                window.uiManager.showTransientMessage('success.presetLoaded', false, { name }, 3000);
            }
        } catch (error) {
            // Failed to load preset
            if (window.uiManager) {
                window.uiManager.setError('error.failedToLoadPreset');
            }
        }
    }
    
    /**
     * Delete a preset
     * @param {string} name - The name of the preset to delete
     */
    async deletePreset(name) {
        const attemptRevision = ++this.presetMutationAttemptRevision;
        
        try {
            const deleted = await this.enqueuePresetMutation(async () => {
                const presets = await this.getPresets();
                if (!presets[name]) return false;

                delete presets[name];
                await this.persistPresets(presets);
                return true;
            });

            if (!deleted) {
                if (attemptRevision === this.presetMutationAttemptRevision && window.uiManager) {
                    window.uiManager.setError('error.noPresetSelected');
                }
                return;
            }

            if (attemptRevision !== this.presetMutationAttemptRevision) return;
            
            // Update UI
            await this.loadPresetList('');
            if (attemptRevision !== this.presetMutationAttemptRevision) return;
            
            // Update plugin list presets tab if it's visible
            if (window.uiManager && window.uiManager.pluginListManager) {
                await window.uiManager.pluginListManager.refreshPresetsIfVisible();
                if (attemptRevision !== this.presetMutationAttemptRevision) return;
            }
            
            // Update tray menu with new preset list
            if (window.electronIntegration && window.electronIntegration.isElectron) {
                const { updateTrayMenu } = await import('../../electron/menuIntegration.js');
                if (attemptRevision !== this.presetMutationAttemptRevision) return;
                await updateTrayMenu(true);
                if (attemptRevision !== this.presetMutationAttemptRevision) return;
            }
            
            if (window.uiManager) {
                window.uiManager.showTransientMessage('success.presetDeleted', false, { name }, 3000);
            }
        } catch (error) {
            console.error('Failed to delete preset:', error);
            if (attemptRevision === this.presetMutationAttemptRevision && window.uiManager) {
                window.uiManager.showTransientMessage('error.failedToDeletePreset', true, {}, 3000);
            }
        }
    }
    
    /**
     * Get current preset data for export
     * @returns {Object} Current preset data
     */
    getCurrentPresetData() {
        const presetName = this.presetSelect.value.trim() || 'My Preset';
        
        // Get current pipeline state in the original export format (pipeline array)
        const pipelineState = this.audioManager.pipeline.map(plugin =>
            this.pipelineManager.core.getSerializablePluginState(plugin, false, true, true)
        );
        
        return {
            name: presetName,
            pipeline: pipelineState,
            timestamp: Date.now()
        };
    }
}
