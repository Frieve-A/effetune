import { PluginManager } from './plugin-manager.js';
import { AudioManager } from './audio-manager.js';
import { UIManager } from './ui-manager.js';
import { electronIntegration } from './electron-integration.js';
import { applySerializedState } from './utils/serialization-utils.js';

// Make electronIntegration globally accessible first
window.electronIntegration = electronIntegration;

// Function to write the current pipeline state to file on app exit
async function writePipelineStateToFile() {
    if (!window.electronAPI || !window.electronIntegration || !window.electronIntegration.isElectron) {
        return;
    }
    
    // Get the latest state from audioManager to ensure we save the current state
    if (!window.audioManager || !window.pipelineManager) {
        return;
    }
    
    const currentPipeline = window.audioManager.getCurrentPipeline();
    if (!currentPipeline || currentPipeline.length === 0) {
        return;
    }
    
    const pipelineState = currentPipeline.map(plugin =>
        window.pipelineManager.core.getSerializablePluginState(plugin, false, false, false)
    );
    
    try {
        // Use the IPC method to save pipeline state to file
        const result = await window.electronAPI.savePipelineStateToFile(pipelineState);
        
        if (!result.success) {
            console.error('Failed to save pipeline state to file:', result.error);
        }
    } catch (error) {
        console.error('Failed to save pipeline state to file:', error);
    }
}

// Function to load pipeline state from file when in Electron environment
async function loadPipelineState() {
    if (!window.electronAPI || !window.electronIntegration || !window.electronIntegration.isElectron) {
        return null;
    }
    
    // Double-check that we should load the pipeline state
    if (window.__FORCE_SKIP_PIPELINE_STATE_LOAD === true) {
        return null;
    }
    
    // Check the pipelineStateLoaded flag again
    if (window.pipelineStateLoaded !== true) {
        return null;
    }
    
    try {
        // Get app path from Electron - this should respect portable mode settings
        const appPath = await window.electronAPI.getPath('userData');
        
        // Use path.join for cross-platform compatibility
        const filePath = await window.electronAPI.joinPaths(appPath, 'pipeline-state.json');
        
        // Check if file exists
        const fileExists = await window.electronAPI.fileExists(filePath);
        
        if (!fileExists) {
            console.log('Pipeline state file does not exist at path:', filePath);
            return null;
        }
        
        // Read pipeline state from file
        const result = await window.electronAPI.readFile(filePath);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        // Parse pipeline state
        const pipelineState = JSON.parse(result.content);
        
        // Handle dual pipeline format
        if (pipelineState.pipelineA && pipelineState.pipelineB !== undefined) {
            return pipelineState;
        }
        
        // Handle old single pipeline format (backward compatibility)
        return pipelineState;
    } catch (error) {
        console.error('Error loading pipeline state:', error);
        return null;
    }
}

// Set up event listener for preset file opening from command line arguments
// This is now handled in electron-integration.js to avoid duplicate event handlers
// The path will be stored in window.pendingPresetFilePath for later use

// Add a style to hide the UI immediately during first launch
// This will be removed after the splash screen is closed
const tempStyle = document.createElement('style');
tempStyle.id = 'temp-hide-style';
tempStyle.textContent = `
    body > * {
        opacity: 0 !important;
        visibility: hidden !important;
    }
    body {
        background-color: #000 !important;
    }
`;
document.head.appendChild(tempStyle);

// Check if this is the first launch (for audio workaround) - async

// Initialize with a promise that will resolve with the first launch status
let isFirstLaunchPromise;

if (window.electronAPI && window.electronAPI.isFirstLaunch) {
    try {
        // Wrap in Promise.resolve to ensure we get a Promise
        isFirstLaunchPromise = Promise.resolve(window.electronAPI.isFirstLaunch())
            .catch(error => {
                return false;
            });
    } catch (error) {
        isFirstLaunchPromise = Promise.resolve(false);
    }
} else {
    // For web version, always resolve to false immediately
    isFirstLaunchPromise = Promise.resolve(false);
}

// Handle the first launch status when it resolves
isFirstLaunchPromise.then(isFirstLaunch => {
    if (!isFirstLaunch) {
        // If not first launch, remove the temporary hide style
        if (tempStyle.parentNode) {
            tempStyle.parentNode.removeChild(tempStyle);
        }
    } else {
        // If first launch, keep the UI hidden
        // Replace temporary style with permanent one
        tempStyle.id = 'first-launch-style';
    }
    
    // Store the first launch status for other components
    window.isFirstLaunchConfirmed = isFirstLaunch;
    window.isFirstLaunch = isFirstLaunch;
}).catch(error => {
    console.error('Error checking launch status:', error);
    // In case of error, show the UI
    if (tempStyle.parentNode) {
        tempStyle.parentNode.removeChild(tempStyle);
    }
    window.isFirstLaunchConfirmed = false;
    window.isFirstLaunch = false;
});

// Configuration for initialization wait times (in milliseconds)
const INITIALIZATION_CONFIG = {
    // Wait time between AudioWorklet initialization and pipeline initialization/building
    // Set to 0 to disable wait
    AUDIOWORKLET_TO_PIPELINE_WAIT: 500
};

class App {
    constructor() {
        // Initialize core components
        this.pluginManager = new PluginManager();
        this.audioManager = new AudioManager();
        
        // Initialize UI components
        this.uiManager = new UIManager(this.pluginManager, this.audioManager);
        
        // Set pipeline manager reference in audio manager
        this.audioManager.pipelineManager = this.uiManager.pipelineManager;
        
        // Pass first launch flag to audio manager for audio workaround
        // Use a default value of false if window.isFirstLaunchConfirmed is not set
        this.audioManager.isFirstLaunch = false;

        // Make managers globally accessible for preset functionality
        window.pluginManager = this.pluginManager;
        window.pipelineManager = this.uiManager.pipelineManager;
    }

    async initialize() {
        try {
            // Show loading spinner
            this.uiManager.showLoadingSpinner();
            
            // Display app version first
            await displayAppVersion();

            // Load plugins (definitions only, not instances)
            await this.pluginManager.loadPlugins();

            // Initialize UI components (non-blocking)
            this.uiManager.initPluginList();
            this.uiManager.initDragAndDrop();
            
            // Initialize audio context and input/output (without AudioWorklet)
            // This allows the audio context to be created early, but defers
            // the heavy AudioWorklet initialization until after GUI is rendered
            const audioInitResult = await this.audioManager.initAudio();
            
            // Store the audio initialization result for later
            this.audioInitResult = audioInitResult;

            // If there's an error, store it for display at the end of initialization
            if (audioInitResult && typeof audioInitResult === 'string' && audioInitResult.startsWith('Audio Error:')) {
                this.hasAudioError = true;
                console.warn('Audio initialization error detected:', audioInitResult); // Just log the error, don't display it yet
            }
            
            // Initialize audio UI components that don't depend on AudioWorklet
            this.uiManager.initAudio();
            
            // Initialize basic UI without pipeline
            this.uiManager.updatePipelineUI(true);
            
            // Hide loading spinner to show the UI is ready
            this.uiManager.hideLoadingSpinner();
            
            // Wait for next frame to ensure UI is rendered
            // Use different strategies based on window visibility and startup settings
            let useTimeoutInsteadOfRAF = document.hidden; // Default: use timeout if window is hidden
            
            // For Electron: also use timeout if started minimized (minimized startup doesn't set document.hidden)
            if (window.electronIntegration && window.electronIntegration.isElectron && window.electronAPI?.loadConfig) {
                try {
                    const configResult = await window.electronAPI.loadConfig();
                    if (configResult.success && configResult.config?.startMinimized) {
                        useTimeoutInsteadOfRAF = true;
                    }
                } catch (error) {
                    // Ignore config load errors, fallback to document.hidden check
                }
            }
            
            if (useTimeoutInsteadOfRAF) {
                // If window is hidden or started minimized, use setTimeout instead of requestAnimationFrame
                // requestAnimationFrame doesn't execute properly when the page is hidden or minimized
                await new Promise(resolve => setTimeout(resolve, 50));
            } else {
                // Normal path: wait for animation frames when window is visible
                await new Promise(resolve => requestAnimationFrame(() => {
                    // Use a second requestAnimationFrame to ensure UI is fully rendered
                    requestAnimationFrame(resolve);
                }));
            }
            
            // First initialize AudioWorklet (before creating plugins)
            await this.initializeAudioWorklet();
            
            // Optional wait after AudioWorklet initialization
            if (INITIALIZATION_CONFIG.AUDIOWORKLET_TO_PIPELINE_WAIT > 0) {
                await new Promise(resolve => setTimeout(resolve, INITIALIZATION_CONFIG.AUDIOWORKLET_TO_PIPELINE_WAIT));
            }
            
            // Initialize pipeline state and build audio pipeline as a single operation
            // This ensures plugins are created with AudioWorklet already initialized
            await this.initializeAndBuildPipeline();
            
            // Set up event listeners and finalize initialization
            this.setupEventListeners();
            
            // Display any errors
            this.handleErrors();
            // Signal to the main process that we're ready to receive music files
            if (window.electronAPI && window.electronAPI.signalReadyForMusicFiles) {
                // Debug logs removed for release
                window.electronAPI.signalReadyForMusicFiles();
            }
            
            // Signal to the main process that we're ready to receive update notifications
            if (window.electronAPI && window.electronAPI.signalReadyForUpdates) {
                window.electronAPI.signalReadyForUpdates().catch(error => {
                    console.error('Error signaling ready for updates:', error);
                });
            }
            
            // Process command line arguments after all initialization is complete
            this.processCommandLineArguments();
            
            // Set initialized flag to true
            this.initialized = true;
            
        } catch (error) {
            console.error('Initialization error:', error);
            this.uiManager.setError(error.message, true);
            
            // Set initialized flag to true even on error to allow UI to function
            this.initialized = true;
        }
    }

    /**
     * Initialize AudioWorklet only (without pipeline)
     * @returns {Promise<void>}
     */
    async initializeAudioWorklet() {
        // Skip if this is the first launch (during splash screen)
        const isElectron = window.electronIntegration && window.electronIntegration.isElectron;
        const isFirstLaunch = window.isFirstLaunch === true;
        if (isFirstLaunch && isElectron) {
            return;
        }
        
        // Skip if force skip flag is set
        if (window.__FORCE_SKIP_PIPELINE_STATE_LOAD === true) {
            return;
        }
        
        // Initialize AudioWorklet only (no pipeline building)
        const workletResult = await this.audioManager.initializeAudioWorklet();
        
        // Check for errors
        if (workletResult && typeof workletResult === 'string' && workletResult.startsWith('Audio Error:')) {
            this.hasAudioError = true;
            console.warn('AudioWorklet initialization error:', workletResult);
        }
    }

    /**
     * Initialize and build pipeline as a single operation
     * This ensures plugins are created with AudioWorklet already initialized
     * @returns {Promise<void>}
     */
    async initializeAndBuildPipeline() {
        // Check if running in Electron environment
        const isElectron = window.electronIntegration && window.electronIntegration.isElectron;
        
        // Check if this is first launch (during splash screen)
        const isFirstLaunch = window.isFirstLaunch === true;
        
        // If this is the first launch (during splash screen), don't initialize pipeline
        // This prevents overwriting existing settings during splash screen
        if (isFirstLaunch && isElectron) {
            return;
        }
        
        // Try to load pipeline state from file if in Electron environment and no preset file was specified via command line
        // Check for the force skip flag first
        if (window.__FORCE_SKIP_PIPELINE_STATE_LOAD === true) {
            // Clear the flag after using it
            window.__FORCE_SKIP_PIPELINE_STATE_LOAD = false;
            return;
        }
        
        // Check if a command line preset file was specified
        // This is the proper time to load the preset file - after AudioWorklet is initialized
        // We only load the preset file here, not in the event handler, to ensure it's loaded at the right time
        // First check the pendingPresetFilePath (set by onOpenPresetFile event)
        let commandLinePresetFile = window.pendingPresetFilePath || null;
        
        // If not found, try to get it directly from the API
        if (!commandLinePresetFile && window.electronAPI && window.electronAPI.getCommandLinePresetFile) {
            try {
                commandLinePresetFile = await window.electronAPI.getCommandLinePresetFile();
            } catch (error) {
                console.error('Error getting command line preset file:', error);
            }
        }
        
        // If a command line preset file was specified, load it instead of the previous state
        if (commandLinePresetFile) {
            // Debug logs removed for release
            
            // Set pipeline state flags to false to prevent loading previous state
            window.pipelineStateLoaded = false;
            if (typeof window.ORIGINAL_PIPELINE_STATE_LOADED !== 'undefined') {
                window.ORIGINAL_PIPELINE_STATE_LOADED = false;
            }
            window.__FORCE_SKIP_PIPELINE_STATE_LOAD = true;
            
            // Check if there's an audio player active
            const hasAudioPlayer = this.uiManager && this.uiManager.audioPlayer;
            // Debug logs removed for release
            
            if (window.electronIntegration) {
                try {
                    // Read the preset file directly
                    const readResult = await window.electronAPI.readFile(commandLinePresetFile);
                    
                    if (!readResult.success) {
                        throw new Error(readResult.error);
                    }
                    
                    // Parse the file content
                    let fileData;
                    try {
                        fileData = JSON.parse(readResult.content);
                    } catch (parseError) {
                        console.error('Failed to parse preset file JSON:', parseError);
                        throw new Error('Invalid preset file format');
                    }
                    
                    // Process the preset data
                    const path = window.require ? window.require('path') : { basename: (p, ext) => p.split('/').pop().replace(ext, '') };
                    const fileName = path.basename(commandLinePresetFile, '.effetune_preset');
                    
                    // Create preset data object
                    let presetData;
                    if (Array.isArray(fileData)) {
                        presetData = {
                            name: fileName,
                            timestamp: Date.now(),
                            pipeline: fileData
                        };
                    } else if (fileData.pipeline) {
                        presetData = fileData;
                        presetData.timestamp = Date.now();
                        presetData.name = fileName;
                    } else {
                        throw new Error('Unknown preset format');
                    }
                    
                    // Load the preset directly into UI
                    this.uiManager.loadPreset(presetData);
                    
                    // Rebuild the pipeline to ensure audio processing works correctly
                    // Debug logs removed for release
                    
                    // Force disconnect all existing connections first
                    if (this.audioManager.workletNode) {
                        try {
                            this.audioManager.workletNode.disconnect();
                        } catch (e) {
                            // Ignore errors if already disconnected
                            // Debug logs removed for release
                        }
                    }
                    
                    // Rebuild pipeline with force flag to ensure complete rebuild
                    await this.audioManager.rebuildPipeline(true);
                    // Debug logs removed for release
                    
                    // If there was an audio player, make sure it's properly connected to the new pipeline
                    if (hasAudioPlayer && this.uiManager.audioPlayer) {
                        // Debug logs removed for release
                        // Force reconnection of the audio player to the new pipeline
                        if (this.uiManager.audioPlayer.contextManager) {
                            try {
                                this.uiManager.audioPlayer.contextManager.connectToAudioContext();
                                // Debug logs removed for release
                            } catch (reconnectError) {
                                console.error('Error reconnecting audio player:', reconnectError);
                            }
                        }
                    }
                    
                    // Clear the pending preset file path
                    window.pendingPresetFilePath = null;
                    
                    return;
                } catch (error) {
                    console.error('Error loading preset file:', error);
                }
            }
        }
        
        // Check config settings for startup preset if in Electron environment
        if (isElectron && window.electronIntegration) {
            try {
                const { loadConfig } = await import('./electron/configIntegration.js');
                const config = await loadConfig(true);
                
                // If config specifies a preset for startup, load it instead of previous state
                if (config.pipelineStartup === 'preset' && config.startupPreset) {
                    const presetManager = this.uiManager.pipelineManager.presetManager;
                    const presets = await presetManager.getPresets();
                    
                    if (presets[config.startupPreset]) {
                        try {
                            // Set flags to prevent loading previous state
                            window.pipelineStateLoaded = false;
                            if (typeof window.ORIGINAL_PIPELINE_STATE_LOADED !== 'undefined') {
                                window.ORIGINAL_PIPELINE_STATE_LOADED = false;
                            }
                            window.__FORCE_SKIP_PIPELINE_STATE_LOAD = true;
                            
                            // Load the specified preset
                            await presetManager.loadPreset(config.startupPreset);
                            
                            // Force disconnect all existing connections first
                            if (this.audioManager.workletNode) {
                                try {
                                    this.audioManager.workletNode.disconnect();
                                } catch (e) {
                                    // Ignore errors if already disconnected
                                }
                            }
                            
                            // Rebuild pipeline with force flag to ensure complete rebuild
                            await this.audioManager.rebuildPipeline(true);
                            
                            return;
                        } catch (error) {
                            console.error('Error loading startup preset:', error);
                        }
                    } else {
                        console.warn(`Startup preset '${config.startupPreset}' not found`);
                    }
                }
                
                // If config specifies default settings, skip loading previous state
                if (config.pipelineStartup === 'default') {
                    window.pipelineStateLoaded = false;
                    if (typeof window.ORIGINAL_PIPELINE_STATE_LOADED !== 'undefined') {
                        window.ORIGINAL_PIPELINE_STATE_LOADED = false;
                    }
                    window.__FORCE_SKIP_PIPELINE_STATE_LOAD = true;
                }
            } catch (error) {
                console.error('Error loading config for startup preset:', error);
            }
        }
        
        // Load pipeline state
        let savedState = null;
        const plugins = [];
        
        // Use the ORIGINAL_PIPELINE_STATE_LOADED value if available, as it can't be changed
        const shouldLoadPipeline = window.ORIGINAL_PIPELINE_STATE_LOADED !== undefined
            ? window.ORIGINAL_PIPELINE_STATE_LOADED === true
            : window.pipelineStateLoaded === true;
            
        if (isElectron && shouldLoadPipeline) {
            try {
                savedState = await loadPipelineState();
            } catch (error) {
                // Error loading pipeline state, will use default
                console.error('Error loading pipeline state:', error);
            }
        }
        
        // If no saved state from file, try URL state (for web version)
        if (!savedState) {
            savedState = this.uiManager.parsePipelineState();
        }
        
        // Handle dual pipeline format
        if (savedState && savedState.pipelineA && savedState.pipelineB !== undefined) {
            // Load pipeline A
            const pluginsA = savedState.pipelineA.flatMap(pluginState => {
                try {
                    const plugin = this.pluginManager.createPlugin(pluginState.name);
                    
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
                    plugin.updateParameters();
                    this.uiManager.expandedPlugins.add(plugin);
                    return plugin;
                } catch (error) {
                    console.warn(`Failed to create plugin '${pluginState.name}': ${error.message}`);
                    return []; // Return empty array for flatMap to filter out this plugin
                }
            });
            
            // Load pipeline B if it exists
            let pluginsB = null;
            if (savedState.pipelineB) {
                pluginsB = savedState.pipelineB.flatMap(pluginState => {
                    try {
                        const plugin = this.pluginManager.createPlugin(pluginState.name);
                        
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
                        plugin.updateParameters();
                        return plugin;
                    } catch (error) {
                        console.warn(`Failed to create plugin '${pluginState.name}': ${error.message}`);
                        return []; // Return empty array for flatMap to filter out this plugin
                    }
                });
            }
            
            // Set dual pipeline state
            this.audioManager.pipelineA = pluginsA;
            this.audioManager.pipelineB = pluginsB;
            this.audioManager.setCurrentPipeline(savedState.currentPipeline || 'A');
            plugins.push(...pluginsA); // Use pipeline A for current pipeline
            
        } else if (savedState && Array.isArray(savedState) && savedState.length > 0) {
            // Handle old single pipeline format (backward compatibility)
            plugins.push(...savedState.flatMap(pluginState => {
                try {
                    const plugin = this.pluginManager.createPlugin(pluginState.name);
                    
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
                    plugin.updateParameters();
                    this.uiManager.expandedPlugins.add(plugin);
                    return plugin;
                } catch (error) {
                    console.warn(`Failed to create plugin '${pluginState.name}': ${error.message}`);
                    return []; // Return empty array for flatMap to filter out this plugin
                }
            }));
        } else {
            // Initialize default plugins
            const defaultPlugins = [
                { name: 'Volume', config: { volume: -6 } },
                { name: 'Level Meter' }
            ];
            
            plugins.push(...defaultPlugins.flatMap(config => {
                try {
                    const plugin = this.pluginManager.createPlugin(config.name);
                    if (config.config?.volume !== undefined) {
                        plugin.setVl(config.config.volume);
                    }
                    this.uiManager.expandedPlugins.add(plugin);
                    return plugin;
                } catch (error) {
                    console.warn(`Failed to create default plugin '${config.name}': ${error.message}`);
                    return []; // Return empty array for flatMap to filter out this plugin
                }
            }));
        }
        
        // Set the pipeline in audioManager
        this.audioManager.pipelineA = plugins;
        this.audioManager.setCurrentPipeline('A');
        
        // Update UI
        this.uiManager.updatePipelineUI(true);
        this.uiManager.updateURL();
        this.uiManager.updatePipelineToggleButton();
        
        // Important: Build the audio pipeline immediately after creating plugins
        // This ensures audio processing is connected properly
        try {
            // Force disconnect all existing connections first
            if (this.audioManager.workletNode) {
                try {
                    this.audioManager.workletNode.disconnect();
                } catch (e) {
                    // Ignore errors if already disconnected
                    console.log('Worklet node was already disconnected');
                }
            }
            
            // Rebuild pipeline to ensure audio processing is connected
            await this.audioManager.rebuildPipeline(true);
            
        } catch (error) {
            console.error('Error building audio pipeline:', error);
            // Try one more time after a short delay
            await new Promise(resolve => setTimeout(resolve, 100));
            await this.audioManager.rebuildPipeline(true);
            console.log('Audio pipeline rebuilt after error');
        }

        if (window.pendingPresetName && window.pipelineManager && window.pipelineManager.presetManager) {
            await window.pipelineManager.presetManager.loadPreset(window.pendingPresetName);
            window.pendingPresetName = null;
        }

        // Load pending tray preset if available
        if (window.pendingTrayPresetName && window.pipelineManager && window.pipelineManager.presetManager) {
            await window.pipelineManager.presetManager.loadPreset(window.pendingTrayPresetName);
            window.pendingTrayPresetName = null;
        }
    }

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Add F1 key event listener for help documentation
        document.addEventListener('keydown', (event) => {
            if (event.key === 'F1') {
                event.preventDefault(); // Prevent default browser behavior
                const whatsThisLink = document.querySelector('.whats-this');
                if (whatsThisLink) {
                    whatsThisLink.click();
                }
            }
        });

        // Listen for update notifications from Electron
        if (window.electronAPI) {
            window.electronAPI.onIPC('update-available', (updateInfo) => {
                this.showUpdateNotification(updateInfo);
            });
        }

        // Auto-resume audio context when page gains focus
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.audioManager.audioContext &&
                this.audioManager.audioContext.state === 'suspended') {
                this.audioManager.audioContext.resume();
            }
        });

        // Handle audio device changes (e.g., USB device reconnected)
        if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
            navigator.mediaDevices.addEventListener('devicechange', () => {
                this.handleOutputDeviceChange();
            });
        }
    }

    /**
     * Show update notification
     */
    showUpdateNotification(updateInfo) {
        const whatsThisLink = document.querySelector('.whats-this');
        
        if (whatsThisLink) {
            // Check if update notification already exists
            const existingNotification = document.querySelector('.update-notification');
            if (existingNotification) {
                return; // Already showing update notification
            }
            
            // Create update notification element
            const updateElement = document.createElement('span');
            updateElement.className = 'update-notification';
            updateElement.textContent = window.uiManager && window.uiManager.t ? 
                window.uiManager.t('ui.newVersionAvailable', { version: updateInfo.version }) : 
                `New ${updateInfo.version} available.`;
            
            // Add click handler to open releases page
            updateElement.addEventListener('click', () => {
                if (window.electronAPI && window.electronAPI.openExternal) {
                    window.electronAPI.openExternal(updateInfo.url);
                } else {
                    window.open(updateInfo.url, '_blank');
                }
            });
            
            // Insert after the whats-this link
            whatsThisLink.parentNode.insertBefore(updateElement, whatsThisLink.nextSibling);
        }
    }

    /**
     * Handle and display any errors
     */
    handleErrors() {
        // Check sample rate after initialization
        if (this.audioManager.audioContext && this.audioManager.audioContext.sampleRate < 88200) {
            this.uiManager.setError('error.lowSampleRate', true, { sampleRate: this.audioManager.audioContext.sampleRate });
        }

        // Clear any existing error messages
        this.uiManager.clearError();

        // Display microphone error message if there was one
        if (this.hasAudioError) {
            // Show a non-blocking warning message to the user
            this.uiManager.setError(this.uiManager.t('error.microphoneAccessDenied'), false);
            setTimeout(() => window.uiManager.clearError(), 3000);
        }
    }

    /**
     * Handle output device change events
     */
    async handleOutputDeviceChange() {
        if (!window.electronIntegration ||
            !window.electronIntegration.isElectronEnvironment ||
            !window.electronIntegration.isElectronEnvironment()) {
            return;
        }

        const prefs = await window.electronIntegration.loadAudioPreferences();
        if (!prefs || !prefs.outputDeviceId) return;

        let devices;
        try {
            devices = await navigator.mediaDevices.enumerateDevices();
        } catch (err) {
            console.warn('Failed to enumerate devices on devicechange:', err);
            return;
        }

        const found = devices.some(d => d.kind === 'audiooutput' && d.deviceId === prefs.outputDeviceId);
        const currentSink = this.audioManager.ioManager.audioElement?.sinkId;

        if (typeof currentSink === 'undefined') {
            if (found) {
                await this.audioManager.reset(prefs);
            }
        } else {
            if (found) {
                if (currentSink !== prefs.outputDeviceId) {
                    const success = await this.audioManager.ioManager.reapplyOutputDevice(prefs.outputDeviceId);
                    if (!success) {
                        await this.audioManager.reset(prefs);
                    }
                }
            } else if (currentSink === prefs.outputDeviceId) {
                await this.audioManager.reset(prefs);
            }
        }
    }

    /**
     * Process command line arguments after all initialization is complete
     * This method handles both preset files and music files passed via command line
     */
    processCommandLineArguments() {
        // Check if running in Electron environment
        const isElectron = window.electronIntegration && window.electronIntegration.isElectron;
        if (!isElectron) return;

        // Debug logs removed for release

        // We no longer need to process preset files here as they are handled in initializeAndBuildPipeline
        // This prevents double-loading of preset files

        // Process command line music files if specified
        if (window.pendingMusicFiles && window.pendingMusicFiles.length > 0) {
            // Debug logs removed for release
            
            // Set useInputWithPlayer to false for command line music files
            if (window.electronIntegration && window.electronIntegration.audioPreferences) {
                window.electronIntegration.audioPreferences.useInputWithPlayer = false;
                
                // Make sure the audio manager is updated with this preference
                if (this.audioManager) {
                    this.audioManager.useInputWithPlayer = false;
                }
            }
            
            // Use the UIManager to create an audio player and load the files
            if (this.uiManager) {
                // Debug logs removed for release
                
                // Convert file paths to File objects to match drag and drop behavior
                // This is the key fix for the music file command line argument issue
                const convertPathsToFileObjects = async (filePaths) => {
                    try {
                        return await Promise.all(filePaths.map(async (filePath) => {
                            // Read file content as binary
                            const fileResult = await window.electronAPI.readFile(filePath, true); // true for binary
                            if (!fileResult.success) {
                                console.error(`Failed to read file: ${fileResult.error}`);
                                return null;
                            }
                            
                            // Get file name from path
                            const fileName = filePath.split(/[\\/]/).pop();
                            
                            // Convert base64 to ArrayBuffer
                            const binaryString = atob(fileResult.content);
                            const bytes = new Uint8Array(binaryString.length);
                            for (let i = 0; i < binaryString.length; i++) {
                                bytes[i] = binaryString.charCodeAt(i);
                            }
                            
                            // Create a File object with the appropriate MIME type
                            const extension = fileName.split('.').pop().toLowerCase();
                            const mimeTypes = {
                                'mp3': 'audio/mpeg',
                                'wav': 'audio/wav',
                                'ogg': 'audio/ogg',
                                'flac': 'audio/flac',
                                'm4a': 'audio/mp4',
                                'aac': 'audio/aac'
                            };
                            const mimeType = mimeTypes[extension] || 'audio/mpeg';
                            
                            // Create a File object
                            const blob = new Blob([bytes.buffer], { type: mimeType });
                            return new File([blob], fileName, { type: mimeType });
                        }));
                    } catch (error) {
                        console.error('Error converting paths to File objects:', error);
                        return [];
                    }
                };
                
                // Convert paths to File objects and create audio player
                convertPathsToFileObjects(window.pendingMusicFiles)
                    .then(fileObjects => {
                        // Filter out any null values (failed conversions)
                        const validFiles = fileObjects.filter(file => file);
                        
                        if (validFiles.length > 0) {
                            // Debug logs removed for release
                            
                            // Make sure the _commandLineMusicFilesNoInput flag is set
                            // This ensures the audio player doesn't use input with the music files
                            if (window._commandLineMusicFilesNoInput !== true) {
                                // Debug logs removed for release
                                window._commandLineMusicFilesNoInput = true;
                            }
                            
                            this.uiManager.createAudioPlayer(validFiles, false);
                            
                            // Start playback automatically after a short delay to ensure audio is loaded
                            setTimeout(() => {
                                // Debug logs removed for release
                                if (this.uiManager.audioPlayer) {
                                    this.uiManager.audioPlayer.play();
                                }
                            }, 1000);
                        } else {
                            console.error('No valid files after conversion');
                        }
                    })
                    .catch(error => {
                        console.error('Error in file conversion process:', error);
                    });
                
                // Clear the pending music files after processing
                window.pendingMusicFiles = [];
            }
        }
    }
}

/**
 * Display application version from package.json
 */
async function displayAppVersion() {
    try {
        const versionElement = document.getElementById('app-version');
        if (!versionElement) return;
        
        // Get version from Electron if available
        if (window.electronIntegration && window.electronIntegration.isElectron) {
            const version = await window.electronIntegration.getAppVersion();
            versionElement.textContent = version;
        } else {
            // For web version, fetch package.json from the relative path
            try {
                const response = await fetch('./package.json');
                if (response.ok) {
                    const packageData = await response.json();
                    versionElement.textContent = packageData.version;
                } else {
                    console.error('Failed to fetch package.json:', response.status);
                    versionElement.textContent = '';
                }
            } catch (fetchError) {
                console.error('Error fetching package.json:', fetchError);
                versionElement.textContent = '';
            }
        }
    } catch (error) {
        console.error('Failed to display app version:', error);
        // Don't display version in case of error
        const versionElement = document.getElementById('app-version');
        if (versionElement) {
            versionElement.textContent = '';
        }
    }
    
}

// Add event listener to save pipeline state to file when the app is closing
window.addEventListener('beforeunload', async (event) => {
    // Write the latest pipeline state to file on app exit
    await writePipelineStateToFile();
});

// Set up event listeners for tray menu functionality
if (window.electronAPI && window.electronIntegration && window.electronIntegration.isElectron) {
  // Listen for preset load requests from tray menu
  window.electronAPI.onIPC('load-preset-from-tray', (presetName) => {
    // Wait for app to be initialized before loading preset
    if (window.app && window.app.initialized && window.pipelineManager && window.pipelineManager.presetManager) {
      window.pipelineManager.presetManager.loadPreset(presetName).catch(error => {
        console.error('Error loading preset from tray:', error);
      });
    } else {
      // If app is not initialized yet, store the preset name to load later
      window.pendingTrayPresetName = presetName;
    }
  });
}

// Initialize application after first launch check is complete
// Use the already defined isFirstLaunchPromise from above
isFirstLaunchPromise.then(isFirstLaunch => {
    // Store the first launch status for other components
    window.isFirstLaunchConfirmed = isFirstLaunch;
    window.isFirstLaunch = isFirstLaunch;
    
    // Create app instance
    const app = new App();
    
    // Store app instance globally
    window.app = app;
    
    // Initialize app
    app.initialize().catch(error => {
        console.error('Failed to initialize app:', error);
    });
}).catch(error => {
    console.error('Failed to check first launch status:', error);
    
    // Create app instance anyway
    const app = new App();
    
    // Store app instance globally
    window.app = app;
    
    // Initialize app
    app.initialize().catch(error => {
        console.error('Failed to initialize app:', error);
    });
});
