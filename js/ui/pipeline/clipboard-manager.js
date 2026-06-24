/**
 * ClipboardManager - Handles copy/cut/paste operations and URL parsing
 */
import { getSerializablePluginStateShort, applySerializedState } from '../../utils/serialization-utils.js';
import { decodePipelineState } from '../../utils/pipeline-state-codec.js';
export class ClipboardManager {
    /**
     * Create a new ClipboardManager instance
     * @param {Object} pipelineManager - The pipeline manager instance
     */
    constructor(pipelineManager) {
        this.pipelineManager = pipelineManager;
        this.core = pipelineManager.core;
        this.audioManager = pipelineManager.audioManager;
        this.pluginManager = pipelineManager.pluginManager;
    }
    
    /**
     * Copy selected plugins to clipboard
     * @returns {Promise<boolean>} Whether the copy was successful
     */
    async copySelectedPluginsToClipboard() {
        if (this.core.selectedPlugins.size === 0) {
            return false;
        }

        try {
            const selectedPluginsArray = Array.from(this.core.selectedPlugins);
            const states = selectedPluginsArray.map(plugin =>
                getSerializablePluginStateShort(plugin)
            );
            await navigator.clipboard.writeText(JSON.stringify(states, null, 2));
            
            if (window.uiManager) {
                window.uiManager.setError('success.settingsCopied', false);
                setTimeout(() => window.uiManager.clearError(), 3000);
            }
            return true;
        } catch (err) {
            // Failed to copy settings
            if (window.uiManager) {
                window.uiManager.setError('error.failedToCopySettings', true);
            }
            return false;
        }
    }
    
    /**
     * Cut selected plugins (copy then delete)
     * @returns {Promise<boolean>} Whether the cut was successful
     */
    async cutSelectedPlugins() {
        if (this.core.selectedPlugins.size === 0) {
            return false;
        }

        try {
            // First copy the plugins
            const copySuccess = await this.copySelectedPluginsToClipboard();
            if (!copySuccess) {
                return false;
            }

            // Then delete after successful copy
            this.core.deleteSelectedPlugins();
            
            if (window.uiManager) {
                window.uiManager.setError('success.settingsCut', false);
                setTimeout(() => window.uiManager.clearError(), 3000);
            }
            return true;
        } catch (err) {
            // Failed to cut settings
            if (window.uiManager) {
                window.uiManager.setError('error.failedToCutSettings', true);
            }
            return false;
        }
    }
    
    /**
     * Handle pasting plugin settings from clipboard text
     * @param {string} text - The clipboard text
     */
    async handlePaste(text) {
        try {
            // Check if the text is a URL with BASE64 encoded pipeline data
            if (text.startsWith('http://') || text.startsWith('https://')) {
                try {
                    // Try to extract the 'p' parameter from the URL
                    const url = new URL(text);
                    const pParam = url.searchParams.get('p');
                    
                    if (pParam) {
                        // Try to decode the p parameter as BASE64
                        try {
                            // Validate base64 format using regex
                            if (!/^[A-Za-z0-9+/=]+$/.test(pParam)) {
                                throw new Error('Invalid base64 characters in p parameter');
                            }
                            
                            const pipelineState = decodePipelineState(pParam);
                            
                            // Validate that state is an array
                            if (!Array.isArray(pipelineState)) {
                                throw new Error('Pipeline state must be an array');
                            }
                            
                            // Use the pipeline state directly
                            // This is already in the format expected by the paste handler
                            const pluginStates = pipelineState;
                            
                            // Create plugins from states
                            const newPlugins = pluginStates.map(state => {
                                const plugin = this.pluginManager.createPlugin(state.nm);
                                if (!plugin) {
                                    throw new Error(`Failed to create plugin: ${state.nm}`);
                                }
                                
                                // Apply serialized state
                                applySerializedState(plugin, state);
                                
                                return plugin;
                            });
                            
                            // Determine insertion index
                            let insertIndex;
                            if (this.core.selectedPlugins.size > 0) {
                                // Get index of first selected plugin
                                insertIndex = Math.min(...Array.from(this.core.selectedPlugins)
                                    .map(plugin => this.audioManager.pipeline.indexOf(plugin)));
                            } else {
                                // Insert at end if no selection
                                insertIndex = this.audioManager.pipeline.length;
                            }
                            
                            // Insert plugins
                            this.audioManager.pipeline.splice(insertIndex, 0, ...newPlugins);
                            
                            // Clear selection and select new plugins
                            this.core.selectedPlugins.clear();
                            newPlugins.forEach(plugin => {
                                this.core.selectedPlugins.add(plugin);
                                this.pipelineManager.expandedPlugins.add(plugin);
                            });
                            
                            this.core.updatePipelineUI();
                            
                            // Update worklet directly without rebuilding pipeline
                            this.core.updateWorkletPlugins();
                            
                            // Save state for undo/redo
                            this.pipelineManager.historyManager.saveState();
                            
                            // If plugins were inserted at the end, scroll to bottom
                            if (insertIndex === this.audioManager.pipeline.length - newPlugins.length) {
                                requestAnimationFrame(() => {
                                    window.scrollTo({
                                        top: document.body.scrollHeight,
                                        behavior: 'smooth'
                                    });
                                });
                            }
                            
                            if (window.uiManager) {
                                window.uiManager.setError('success.settingsPasted', false);
                                setTimeout(() => window.uiManager.clearError(), 3000);
                            }
                            
                            // Return early since we've handled the URL
                            return;
                        } catch (decodeErr) {
                            console.error('Failed to decode/parse BASE64 data from URL:', decodeErr);
                            // Continue to try parsing as JSON
                        }
                    }
                } catch (urlErr) {
                    console.error('Failed to parse URL:', urlErr);
                    // Continue to try parsing as JSON
                }
            }
            
            // If we get here, either the text wasn't a URL or we couldn't extract pipeline data from it
            // Try parsing the text as JSON directly
            const pluginStates = JSON.parse(text);
            
            if (!Array.isArray(pluginStates)) {
                throw new Error('Invalid plugin data format: not an array');
            }
            
            // Create plugins from states
            const newPlugins = pluginStates.map(state => {
                const plugin = this.pluginManager.createPlugin(state.nm);
                if (!plugin) {
                    throw new Error(`Failed to create plugin: ${state.nm}`);
                }
                
                // Apply serialized state
                applySerializedState(plugin, state);
                
                return plugin;
            });

            // Determine insertion index
            let insertIndex;
            if (this.core.selectedPlugins.size > 0) {
                // Get index of first selected plugin
                insertIndex = Math.min(...Array.from(this.core.selectedPlugins)
                    .map(plugin => this.audioManager.pipeline.indexOf(plugin)));
            } else {
                // Insert at end if no selection
                insertIndex = this.audioManager.pipeline.length;
            }

            // Insert plugins
            this.audioManager.pipeline.splice(insertIndex, 0, ...newPlugins);
            
            // Clear selection and select new plugins
            this.core.selectedPlugins.clear();
            newPlugins.forEach(plugin => {
                this.core.selectedPlugins.add(plugin);
                this.pipelineManager.expandedPlugins.add(plugin);
            });
            
            this.core.updatePipelineUI();
            
            // Update worklet directly without rebuilding pipeline
            this.core.updateWorkletPlugins();
            
            // Save state for undo/redo
            this.pipelineManager.historyManager.saveState();

            // If plugins were inserted at the end, scroll to bottom
            if (insertIndex === this.audioManager.pipeline.length - newPlugins.length) {
                requestAnimationFrame(() => {
                    window.scrollTo({
                        top: document.body.scrollHeight,
                        behavior: 'smooth'
                    });
                });
            }

            if (window.uiManager) {
                window.uiManager.setError('success.settingsPasted', false);
                setTimeout(() => window.uiManager.clearError(), 3000);
            }
        } catch (err) {
            // Failed to paste plugin settings
            if (window.uiManager) {
                window.uiManager.setError('error.failedToPasteSettings', true);
            }
        }
    }
}
