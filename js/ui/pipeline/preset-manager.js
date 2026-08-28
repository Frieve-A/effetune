/**
 * PresetManager - Handles preset loading, saving, and deletion
 * Manages preset UI and storage (localStorage for web, file system for Electron)
 */
import { getSerializablePluginStateShort, applySerializedState } from '../../utils/serialization-utils.js';

function setOwn(target, key, value) {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
    });
}

export class PresetManager {
    /**
     * Create a new PresetManager instance
     * @param {Object} pipelineManager - The pipeline manager instance
     * @param {Object} audioManager - The audio manager instance
     */
    constructor(pipelineManager) {
        this.pipelineManager = pipelineManager;
        this.audioManager = pipelineManager.audioManager;
        
        this.pipelinePresetButton = document.getElementById('pipelinePresetButton');
        this.currentPresetName = '';
        this.presetMutationAttemptRevision = 0;
        this.presetMutationQueue = Promise.resolve();
        
        this.pipelinePresetButton?.addEventListener('click', () => this.openPresetDialog());
    }

    openPresetDialog({ focusSaveName = false } = {}) {
        const provider = {
            getTitleKey: () => 'ui.title.pipelinePresets',
            getSystemPresetGroups: () => null,
            getActiveSystemPresetId: () => '',
            getActiveUserPresetName: () => this.currentPresetName,
            getPresetContext: () => this,
            getDefaultSaveName: () => this.currentPresetName,
            listUserPresetNames: async () => Object.keys(await this.getPresets()),
            applyUserPreset: name => this.loadPreset(name),
            saveUserPreset: name => this.savePreset(name),
            renameUserPreset: (oldName, newName) => this.renamePreset(oldName, newName),
            deleteUserPresets: names => this.deletePresets(names),
            errorKeys: {
                save: 'error.failedToSavePreset',
                delete: 'error.failedToDeletePreset'
            },
            handlesErrors: true
        };
        return this.pipelineManager.core.pluginPresetDialog.show(
            provider,
            this.pipelinePresetButton,
            { focusSaveName }
        );
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
    async savePreset(name, { showSuccessMessage = true } = {}) {
        if (typeof name !== 'string' || !name.trim()) return false;
        name = name.trim();
        const attemptRevision = ++this.presetMutationAttemptRevision;
        const pipeline = [...this.audioManager.pipeline];
        // Create preset data with original format (plugins array)
        const pluginsData = pipeline.map(plugin =>
            getSerializablePluginStateShort(plugin)
        );

        try {
            await this.enqueuePresetMutation(async () => {
                const presets = await this.getPresets();
                setOwn(presets, name, { plugins: pluginsData });
                await this.persistPresets(presets);
            });

            this.currentPresetName = name;
            if (attemptRevision !== this.presetMutationAttemptRevision) return true;
            
            // Update plugin list presets tab if it's visible
            if (window.uiManager && window.uiManager.pluginListManager) {
                await window.uiManager.pluginListManager.refreshPresetsIfVisible();
                if (attemptRevision !== this.presetMutationAttemptRevision) return true;
            }
            
            // Update tray menu with new preset list
            if (window.electronIntegration && window.electronIntegration.isElectron) {
                const { updateTrayMenu } = await import('../../electron/menuIntegration.js');
                if (attemptRevision !== this.presetMutationAttemptRevision) return true;
                await updateTrayMenu(true);
                if (attemptRevision !== this.presetMutationAttemptRevision) return true;
            }
            
            if (showSuccessMessage && window.uiManager) {
                window.uiManager.showTransientMessage(
                    window.uiManager.t('success.presetSaved', { name }),
                    false, {}, 3000
                );
            }
            return true;
        } catch (error) {
            console.error('Failed to save preset:', error);
            if (attemptRevision === this.presetMutationAttemptRevision && window.uiManager) {
                window.uiManager.showTransientMessage('error.failedToSavePreset', true, {}, 3000);
            }
            return false;
        }
    }
    
    /**
     * Load a preset into the pipeline
     * @param {string|Object} nameOrPreset - The name of the preset to load from file/localStorage, or a preset object
     */
    async loadPreset(nameOrPreset) {
        let preset;
        let name;
        let historyManager = null;
        
        
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
                return false;
            }
        } else if (typeof nameOrPreset === 'object' && nameOrPreset !== null) {
            // It's a preset object, use directly
            preset = nameOrPreset;
            name = preset.name || 'Imported Preset';
            if (!this.isPresetLoadable(preset)) {
                if (window.uiManager) {
                    window.uiManager.setError('error.invalidPresetData');
                }
                return false;
            }
        } else {
            if (window.uiManager) {
                window.uiManager.setError('error.invalidPresetData');
            }
            return false;
        }
        
        try {
            historyManager = this.pipelineManager.historyManager;
            historyManager.withHistorySuppressed(() => {
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
            
            // Ensure master bypass is OFF after loading preset
            this.pipelineManager.core.enabled = true;
            this.audioManager.setMasterBypass(false);
            const masterToggle = document.querySelector('.toggle-button.master-toggle');
            if (masterToggle) {
                masterToggle.classList.remove('off');
            }
            });

            historyManager.saveState();
            
            // Display message only when loading from preset combo box (string name)
            if (window.uiManager && typeof nameOrPreset === 'string') {
                window.uiManager.showTransientMessage('success.presetLoaded', false, { name }, 3000);
            }
            this.currentPresetName = typeof nameOrPreset === 'string' ? nameOrPreset : '';
            return true;
        } catch (error) {
            // Failed to load preset
            if (window.uiManager) {
                window.uiManager.setError('error.failedToLoadPreset');
            }
            return false;
        }
    }
    
    async refreshPresetConsumers(attemptRevision) {
        if (window.uiManager?.pluginListManager) {
            await window.uiManager.pluginListManager.refreshPresetsIfVisible();
            if (attemptRevision !== this.presetMutationAttemptRevision) return false;
        }
        if (window.electronIntegration?.isElectron) {
            const { updateTrayMenu } = await import('../../electron/menuIntegration.js');
            if (attemptRevision !== this.presetMutationAttemptRevision) return false;
            await updateTrayMenu(true);
        }
        return attemptRevision === this.presetMutationAttemptRevision;
    }

    async renamePreset(oldName, newName) {
        const attemptRevision = ++this.presetMutationAttemptRevision;
        try {
            const renamed = await this.enqueuePresetMutation(async () => {
                const presets = await this.getPresets();
                if (!Object.hasOwn(presets, oldName)) return false;
                setOwn(presets, newName, presets[oldName]);
                if (oldName !== newName) delete presets[oldName];
                await this.persistPresets(presets);
                return true;
            });
            if (!renamed) throw new Error('Preset to rename was not found');
            if (this.currentPresetName === oldName) this.currentPresetName = newName;
            if (attemptRevision !== this.presetMutationAttemptRevision) return true;
            return await this.refreshPresetConsumers(attemptRevision);
        } catch (error) {
            console.error('Failed to rename preset:', error);
            if (attemptRevision === this.presetMutationAttemptRevision && window.uiManager) {
                window.uiManager.showTransientMessage('error.failedToSavePreset', true, {}, 3000);
            }
            return false;
        }
    }

    async deletePresets(names) {
        const uniqueNames = [...new Set(Array.isArray(names) ? names.filter(name => typeof name === 'string') : [])];
        const attemptRevision = ++this.presetMutationAttemptRevision;
        try {
            const deleted = await this.enqueuePresetMutation(async () => {
                const presets = await this.getPresets();
                let changed = false;
                for (const name of uniqueNames) {
                    if (Object.hasOwn(presets, name)) {
                        delete presets[name];
                        changed = true;
                    }
                }
                if (!changed) return false;
                await this.persistPresets(presets);
                return true;
            });

            if (!deleted) {
                if (attemptRevision === this.presetMutationAttemptRevision && window.uiManager) {
                    window.uiManager.setError('error.noPresetSelected');
                }
                return false;
            }
            if (uniqueNames.includes(this.currentPresetName)) this.currentPresetName = '';
            if (attemptRevision !== this.presetMutationAttemptRevision) return true;
            if (!await this.refreshPresetConsumers(attemptRevision)) return true;
            
            if (window.uiManager) {
                window.uiManager.showTransientMessage(
                    'success.presetDeleted',
                    false,
                    { name: uniqueNames.join(', ') },
                    3000
                );
            }
            return true;
        } catch (error) {
            console.error('Failed to delete preset:', error);
            if (attemptRevision === this.presetMutationAttemptRevision && window.uiManager) {
                window.uiManager.showTransientMessage('error.failedToDeletePreset', true, {}, 3000);
            }
            return false;
        }
    }

    deletePreset(name) {
        return this.deletePresets([name]);
    }
    
    /**
     * Get current preset data for export
     * @returns {Object} Current preset data
     */
    getCurrentPresetData() {
        const presetName = this.currentPresetName || 'My Preset';
        
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
