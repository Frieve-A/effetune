import { PluginListManager } from './ui/plugin-list-manager.js';
import { PipelineManager } from './ui/pipeline-manager.js';
import { StateManager } from './ui/state-manager.js';

export class UIManager {
    constructor(pluginManager, audioManager) {
        this.pluginManager = pluginManager;
        this.audioManager = audioManager;
        
        // Set directly in UIManager to maintain original behavior
        this.expandedPlugins = new Set();
        
        // UI elements
        this.errorDisplay = document.getElementById('errorDisplay');
        this.resetButton = document.getElementById('resetButton');
        this.shareButton = document.getElementById('shareButton');
        this.pluginList = document.getElementById('pluginList');
        this.pipelineList = document.getElementById('pipelineList');
        this.pipelineEmpty = document.getElementById('pipelineEmpty');
        this.sampleRate = document.getElementById('sampleRate');

        // Initialize managers
        this.pluginListManager = new PluginListManager(pluginManager);
        this.pipelineManager = new PipelineManager(audioManager, pluginManager, this.expandedPlugins, this.pluginListManager);
        this.stateManager = new StateManager(audioManager);

        // Make UIManager instance globally available for URL updates
        window.uiManager = this;

        // Initialize share button
        this.shareButton.addEventListener('click', () => {
            const state = this.getPipelineState();
            const newURL = new URL(window.location.href);
            newURL.searchParams.set('p', state);
            navigator.clipboard.writeText(newURL.toString())
                .then(() => {
                    this.setError('URL copied to clipboard!');
                    setTimeout(() => this.clearError(), 2000);
                })
                .catch(err => {
                    console.error('Failed to copy URL:', err);
                    this.setError('Failed to copy URL to clipboard');
                });
        });
    }

    // Delegate to PluginListManager
    showLoadingSpinner() {
        this.pluginListManager.showLoadingSpinner();
    }

    hideLoadingSpinner() {
        this.pluginListManager.hideLoadingSpinner();
    }

    initPluginList() {
        this.pluginListManager.initPluginList();
    }

    // Delegate to PipelineManager
    initDragAndDrop() {
        this.pipelineManager.initDragAndDrop();
    }

    updatePipelineUI() {
        this.pipelineManager.updatePipelineUI();
    }

    // Delegate to StateManager
    setError(message) {
        this.stateManager.setError(message);
    }

    clearError() {
        this.stateManager.clearError();
    }

    // URL state management
    parsePipelineState() {
        const params = new URLSearchParams(window.location.search);
        const pipelineParam = params.get('p');
        if (!pipelineParam) return null;
        
        try {
            // Convert base64 back to JSON
            const jsonStr = atob(pipelineParam);
            const state = JSON.parse(jsonStr);
            
            // Convert serialized state back to plugin format
            const result = state.map(serializedParams => {
                // Extract plugin name and enabled state
                const { nm: name, en: enabled, ...allParams } = serializedParams;
                
                // Create a deep copy of all parameters
                const paramsCopy = JSON.parse(JSON.stringify(allParams));
                
                // Return the complete plugin state
                return {
                    name,
                    enabled,
                    parameters: paramsCopy
                };
            });
            return result;
        } catch (error) {
            console.error('Failed to parse pipeline state:', error);
            return null;
        }
    }

    getPipelineState() {
        const state = this.audioManager.pipeline.map(plugin => {
            // Get serializable parameters first
            let params = plugin.getSerializableParameters();
            
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
            
            // Remove id from params if it exists
            const { id, type, enabled, ...cleanParams } = params;
            
            // Create the final state object
            return {
                nm: plugin.name,
                en: plugin.enabled,
                ...cleanParams
            };
        });
        
        return btoa(JSON.stringify(state));
    }

    updateURL() {
        const state = this.getPipelineState();
        const newURL = new URL(window.location.href);
        newURL.searchParams.set('p', state);
        window.history.replaceState({}, '', newURL);
    }

    // Call this method after audio context is initialized
    initAudio() {
        if (this.audioManager.audioContext) {
            this.sampleRate.textContent = `${this.audioManager.audioContext.sampleRate} Hz`;
        }
    }
}
