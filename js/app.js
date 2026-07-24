import { PluginManager } from './plugin-manager.js';
import { AudioManager } from './audio-manager.js';
import { UIManager } from './ui-manager.js';
import { electronIntegration } from './electron-integration.js';
import { applySerializedState } from './utils/serialization-utils.js';
import { startRendererWatchdogHeartbeat } from './electron-watchdog.js';
import {
    createFirstLaunchPromise,
    handleFirstLaunchPromise,
    registerPipelineStateCloseHandler,
    startApplication
} from './app-bootstrap.js';
import { normalizeMusicLibraryStartupView } from './library/constants.js';
import { createUpdateNotification } from './update-notification.js';

// Make electronIntegration globally accessible first
window.electronIntegration = electronIntegration;

// Function to get the current pipeline state for saving
function getPipelineStateForSave() {
    if (!window.electronAPI || !window.electronIntegration || !window.electronIntegration.isElectron) {
        return null;
    }

    // Get the latest state from audioManager to ensure we save the current state
    if (!window.audioManager || !window.pipelineManager) {
        return null;
    }

    const currentPipeline = window.audioManager.getCurrentPipeline();
    if (!currentPipeline || currentPipeline.length === 0) {
        return null;
    }

    return currentPipeline.map(plugin =>
        window.pipelineManager.core.getSerializablePluginState(plugin, false, false, false)
    );
}

// Function to write the current pipeline state to file on app exit (legacy, used for manual save)
async function writePipelineStateToFile() {
    const pipelineState = getPipelineStateForSave();
    if (!pipelineState) {
        return;
    }

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

// Set up listener for pipeline state request from main process (for window close)
registerPipelineStateCloseHandler(getPipelineStateForSave);

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
let isFirstLaunchPromise = createFirstLaunchPromise();

// Handle the first launch status when it resolves
handleFirstLaunchPromise(isFirstLaunchPromise, tempStyle);

// Configuration for initialization wait times (in milliseconds)
const INITIALIZATION_CONFIG = {
    // Wait time between AudioWorklet initialization and pipeline initialization/building
    // Set to 0 to disable wait
    AUDIOWORKLET_TO_PIPELINE_WAIT: 500
};

function isElectronStartupWindow(windowRef = window) {
    return Boolean(
        windowRef.electronIntegration?.isElectronEnvironment?.() ||
        windowRef.electronIntegration?.isElectron
    );
}

function getStartupDocument(windowRef = window) {
    return windowRef.document || (typeof document !== 'undefined' ? document : null);
}

function hasExplicitStartupViewRequest(windowRef = window) {
    if (windowRef.isFirstLaunch === true && isElectronStartupWindow(windowRef)) {
        return true;
    }

    try {
        const params = new URLSearchParams(windowRef.location?.search || '');
        return params.has('p') || params.has('dbt');
    } catch (error) {
        return false;
    }
}

function getCachedStartupConfig(windowRef = window) {
    return windowRef.appConfig || windowRef.electronIntegration?.config || null;
}

function shouldUseLibraryStartupView(config, windowRef = window) {
    return config?.startupView === 'library' && !hasExplicitStartupViewRequest(windowRef);
}

function addDocumentBodyClass(documentRef, className) {
    const body = documentRef?.body;
    if (!body) return;
    if (body.classList?.add) {
        body.classList.add(className);
        return;
    }
    const classes = new Set(String(body.className || '').split(/\s+/).filter(Boolean));
    classes.add(className);
    body.className = Array.from(classes).join(' ');
}

function applyInitialStartupViewClass(config, windowRef = window) {
    if (shouldUseLibraryStartupView(config, windowRef)) {
        addDocumentBodyClass(getStartupDocument(windowRef), 'view-library');
    }
}

class App {
    constructor(dependencies = {}) {
        const PluginManagerClass = dependencies.PluginManagerClass || PluginManager;
        const AudioManagerClass = dependencies.AudioManagerClass || AudioManager;
        const UIManagerClass = dependencies.UIManagerClass || UIManager;
        this.startupConfig = dependencies.startupConfig || getCachedStartupConfig(window) || null;

        // Initialize core components
        this.pluginManager = dependencies.pluginManager || new PluginManagerClass();
        this.audioManager = dependencies.audioManager || new AudioManagerClass();
        
        // Initialize UI components
        this.uiManager = dependencies.uiManager || new UIManagerClass(this.pluginManager, this.audioManager);
        this.loadStartupConfig = dependencies.loadStartupConfig || (async () => {
            const { loadConfig } = await import('./electron/configIntegration.js');
            const isElectron = window.electronIntegration?.isElectronEnvironment?.() ||
                window.electronIntegration?.isElectron ||
                false;
            return loadConfig(isElectron);
        });
        this.loadPipelineState = dependencies.loadPipelineState || loadPipelineState;

        if (shouldUseLibraryStartupView(this.startupConfig, window)) {
            this.uiManager.deferLibraryStartupView?.(
                normalizeMusicLibraryStartupView(this.startupConfig.libraryStartupView)
            );
        }
        
        // Set pipeline manager reference in audio manager
        this.audioManager.pipelineManager = this.uiManager.pipelineManager;
        
        // Pass first launch flag to audio manager for audio workaround
        // Use a default value of false if window.isFirstLaunchConfirmed is not set
        this.audioManager.isFirstLaunch = false;

        // Track whether preferred output device was absent on last devicechange scan
        // Used to detect absent→present transitions for HDMI reconnect recovery
        this._preferredDeviceWasAbsent = false;

        // HDMI reconnect throttling: timestamp of last reconnect handling (0 = never)
        this._lastHdmiReconnectResetTime = 0;
        // Debounce timer for disconnect: avoids immediate fallback reset during HDMI oscillation
        this._disconnectDebounceTimer = null;
        // Guard against concurrent handleOutputDeviceChange executions
        this._deviceChangeInProgress = false;
        // App-start timestamp — used to skip auto-relaunch immediately after launch
        // to prevent infinite relaunch loops when HDMI is unstable at startup
        this._appStartTime = Date.now();
        this.startupWarningMessage = null;

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
            await this.refreshPresetListAfterPluginLoad();

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

            // All updatePlugins messages from the startup sequence (saved state,
            // startup/CLI/tray preset) have been posted to the worklet by now.
            // The output gain has been held at 0 since initAudioOutput so nothing
            // could leak through. Finish the optional JS/WASM choice while the
            // graph is still private, then publish it with one safety fade.
            await this.audioManager.waitForDspActivationBeforeOutput?.();
            this.audioManager.fadeInOutput();

            // Power ownership starts only after the initial graph and output
            // safety fade are fully established.
            await this.audioManager.startPowerPolicyController?.();

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

            // Apply the configured initial view after startup content has been handled.
            await this.applyStartupViewPreference();
            
            // Set initialized flag to true
            this.initialized = true;
            
        } catch (error) {
            console.error('Initialization error:', error);
            this.uiManager.setError(error.message, true);
            
            // Set initialized flag to true even on error to allow UI to function
            this.initialized = true;
        }
    }

    async refreshPresetListAfterPluginLoad() {
        const presetManager = this.uiManager?.pipelineManager?.presetManager;
        if (typeof presetManager?.loadPresetList !== 'function') {
            return;
        }

        try {
            await presetManager.loadPresetList();
        } catch (error) {
            console.error('Failed to refresh preset list after plugin load:', error);
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

    restoreDoubleBlindTestFromUrl() {
        // If the page was opened from a Double Blind Test share URL, restore both
        // pipelines and enter the blind test mode automatically (web version).
        try {
            const dbtParam = new URLSearchParams(window.location.search).get('dbt');
            if (dbtParam && this.uiManager && this.uiManager.getDoubleBlindTest) {
                this.uiManager.getDoubleBlindTest().restoreFromShare(dbtParam);
            }
        } catch (error) {
            console.warn('Failed to restore Double Blind Test from URL:', error);
        }
    }

    setStartupWarning(message) {
        this.startupWarningMessage = message;
        this.uiManager?.setError?.(message, false);
    }

    hasExplicitStartupViewRequest() {
        return hasExplicitStartupViewRequest(window);
    }

    async applyStartupViewPreference() {
        let startupConfig = this.startupConfig || getCachedStartupConfig(window) || {};
        if (!startupConfig.startupView) {
            try {
                startupConfig = await this.loadStartupConfig() || {};
                this.startupConfig = startupConfig;
            } catch (error) {
                console.error('Error loading config for startup view:', error);
                return;
            }
        }

        if (!shouldUseLibraryStartupView(startupConfig, window)) {
            return;
        }

        try {
            const initialView = normalizeMusicLibraryStartupView(startupConfig.libraryStartupView);
            this.uiManager?.deferLibraryStartupView?.(initialView);
            applyInitialStartupViewClass(startupConfig, window);
            await this.uiManager?.showLibraryView?.({
                focusSearch: false,
                initialView
            });
        } catch (error) {
            console.error('Error opening startup view:', error);
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
            this._handledCommandLinePresetAtStartup = true;
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
        
        let startupConfig = {};
        let webUrlState = null;
        if (!isElectron) {
            webUrlState = this.uiManager.parsePipelineState();
        }

        // Check config settings for startup preset.
        if (window.electronIntegration) {
            try {
                startupConfig = await this.loadStartupConfig() || {};
                this.startupConfig = startupConfig;

                if (!isElectron && !webUrlState && startupConfig.pipelineStartup === 'preset' && startupConfig.startupPreset) {
                    const presetManager = this.uiManager.pipelineManager.presetManager;
                    const presets = await presetManager.getPresets();

                    if (presets[startupConfig.startupPreset]) {
                        try {
                            await presetManager.loadPreset(startupConfig.startupPreset);

                            if (this.audioManager.workletNode) {
                                try {
                                    this.audioManager.workletNode.disconnect();
                                } catch (e) {
                                    // Ignore errors if already disconnected
                                }
                            }

                            await this.audioManager.rebuildPipeline(true);
                            this.restoreDoubleBlindTestFromUrl();
                            return;
                        } catch (error) {
                            console.error('Error loading startup preset:', error);
                            this.setStartupWarning(`Failed to load startup preset '${startupConfig.startupPreset}'.`);
                        }
                    } else {
                        const message = `Startup preset '${startupConfig.startupPreset}' not found`;
                        console.warn(message);
                        this.setStartupWarning(message);
                    }
                }
                
                // If Electron config specifies a preset for startup, load it instead of previous state.
                if (isElectron && startupConfig.pipelineStartup === 'preset' && startupConfig.startupPreset) {
                    const presetManager = this.uiManager.pipelineManager.presetManager;
                    const presets = await presetManager.getPresets();
                    
                    if (presets[startupConfig.startupPreset]) {
                        try {
                            // Set flags to prevent loading previous state
                            window.pipelineStateLoaded = false;
                            if (typeof window.ORIGINAL_PIPELINE_STATE_LOADED !== 'undefined') {
                                window.ORIGINAL_PIPELINE_STATE_LOADED = false;
                            }
                            window.__FORCE_SKIP_PIPELINE_STATE_LOAD = true;
                            
                            // Load the specified preset
                            await presetManager.loadPreset(startupConfig.startupPreset);
                            
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
                        console.warn(`Startup preset '${startupConfig.startupPreset}' not found`);
                    }
                }
                
                // If config specifies default settings, skip loading previous state
                if (isElectron && startupConfig.pipelineStartup === 'default') {
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
                savedState = await this.loadPipelineState();
            } catch (error) {
                // Error loading pipeline state, will use default
                console.error('Error loading pipeline state:', error);
            }
        }
        
        // If no saved state from file, try URL state (for web version)
        if (!savedState) {
            savedState = webUrlState || this.uiManager.parsePipelineState();
        }

        if (!savedState && !isElectron && (!startupConfig.pipelineStartup || startupConfig.pipelineStartup === 'last')) {
            savedState = this.uiManager.loadPipelineStateFromLocalStorage?.() || null;
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

        this.restoreDoubleBlindTestFromUrl();

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

        const powerController = this.audioManager.powerPolicyController;
        const resumeAudioFromInteraction = () => {
            if (document.hidden) return;
            if (powerController?.enabled) {
                try {
                    Promise.resolve(
                        powerController.requestResumeFromUserInteraction?.()
                    ).catch(error => {
                        console.warn('Audio processing resume after user interaction failed:', error);
                    });
                } catch (error) {
                    console.warn('Audio processing resume after user interaction failed:', error);
                }
                return;
            }
            if (this.audioManager.audioContext?.state === 'suspended') {
                Promise.resolve(this.audioManager.audioContext.resume()).catch(error => {
                    console.warn('AudioContext resume after user interaction failed:', error);
                });
            }
        };
        // Page-lifecycle events are registered on their specified targets in
        // capture phase because freeze/resume do not reliably bubble.
        const handleDocumentLifecycle = (event, eventType = event?.type) => {
            if (eventType === 'visibilitychange' && document.hidden) {
                this.uiManager.flushPipelineStateToLocalStorage?.();
            }
            if (powerController?.enabled) {
                powerController.handlePageLifecycleEvent?.(eventType, {
                    hidden: document.hidden,
                    visibilityState: document.visibilityState
                });
            }
            if (!document.hidden &&
                (eventType === 'visibilitychange' || eventType === 'resume')) {
                resumeAudioFromInteraction();
            }
        };
        document.addEventListener(
            'visibilitychange',
            event => handleDocumentLifecycle(event, 'visibilitychange'),
            true
        );
        document.addEventListener('freeze', event => handleDocumentLifecycle(event, 'freeze'), true);
        document.addEventListener('resume', event => handleDocumentLifecycle(event, 'resume'), true);

        const handleWindowLifecycle = (event, eventType = event?.type) => {
            if (eventType === 'pagehide') {
                this.uiManager.flushPipelineStateToLocalStorage?.();
            }
            powerController?.handlePageLifecycleEvent?.(eventType, {
                persisted: event.persisted === true,
                hidden: document.hidden
            });
            if (eventType === 'pageshow' && !document.hidden) {
                resumeAudioFromInteraction();
            }
        };
        window.addEventListener?.(
            'pageshow',
            event => handleWindowLifecycle(event, 'pageshow'),
            true
        );
        window.addEventListener?.(
            'pagehide',
            event => handleWindowLifecycle(event, 'pagehide'),
            true
        );
        powerController?.handlePageLifecycleEvent?.('startup', {
            hidden: document.hidden,
            visibilityState: document.visibilityState,
            wasDiscarded: document.wasDiscarded === true
        });

        // Start recovery while transient user activation is still available.
        // The controller returns immediately when the required resources are active.
        document.addEventListener('pointerdown', resumeAudioFromInteraction, { passive: true });
        document.addEventListener('keydown', resumeAudioFromInteraction);
        window.addEventListener?.('focus', resumeAudioFromInteraction, true);

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
            
            const updateElement = createUpdateNotification(updateInfo, {
                documentRef: document,
                windowRef: window
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

        if (this.startupWarningMessage && !this.hasAudioError) {
            this.uiManager.setError(this.startupWarningMessage, false);
        }

        // Display microphone error message if there was one
        if (this.hasAudioError) {
            // Show a non-blocking warning message to the user, then auto-clear
            // after 3 s so the warning does not linger indefinitely.
            this.uiManager.setError('error.microphoneAccessDenied', false);
            setTimeout(() => window.uiManager.clearError(), 3000);
        }
    }

    /**
     * Handle output device change events.
     * Uses a 3-second disconnect debounce to avoid reacting to brief HDMI state
     * oscillations during re-plug, and a 10-second cooldown (in _doMacosRelaunch)
     * to prevent repeated reconnect resets from the same reconnect event.
     */
    async handleOutputDeviceChange() {
        if (!window.electronIntegration ||
            !window.electronIntegration.isElectronEnvironment ||
            !window.electronIntegration.isElectronEnvironment()) {
            return;
        }

        if (this._deviceChangeInProgress) {
            return;
        }
        this._deviceChangeInProgress = true;
        try {
            await this._handleOutputDeviceChangeImpl();
        } finally {
            this._deviceChangeInProgress = false;
        }
    }

    async _handleOutputDeviceChangeImpl() {
        let prefs;
        try {
            prefs = await window.electronIntegration.loadAudioPreferences();
        } catch (err) {
            console.warn('[_handleOutputDeviceChangeImpl] Failed to load audio preferences:', err);
            return;
        }
        if (!prefs || !prefs.outputDeviceId) return;

        let devices;
        try {
            devices = await navigator.mediaDevices.enumerateDevices();
        } catch (err) {
            console.warn('Failed to enumerate devices on devicechange:', err);
            return;
        }

        const outputs = devices.filter(d => d.kind === 'audiooutput');

        // Try exact ID match; fall back to label match (HDMI may get new ID on reconnect)
        let foundDevice = outputs.find(d => d.deviceId === prefs.outputDeviceId);
        let foundByLabel = false;
        if (!foundDevice && prefs.outputDeviceLabel) {
            foundDevice = outputs.find(d => d.label === prefs.outputDeviceLabel);
            foundByLabel = !!foundDevice;
        }

        const wasAbsent = this._preferredDeviceWasAbsent;
        this._preferredDeviceWasAbsent = !foundDevice;

        const ioMgr = this.audioManager.ioManager;
        const ctx = this.audioManager.contextManager?.audioContext;
        const useCtxSink = ioMgr.audioContextSinkMode && typeof ctx?.setSinkId === 'function';
        const currentSink = useCtxSink
            ? ctx?.sinkId
            : ioMgr.audioElement?.sinkId;
        const activeDeviceId = foundDevice?.deviceId ?? prefs.outputDeviceId;

        if (typeof currentSink === 'undefined') {
            if (foundDevice) await this.audioManager.reset(null);
            return;
        }

        if (!foundDevice) {
            // Device absent.  Don't reset immediately — HDMI often briefly disappears
            // during re-plug (state oscillation).  Debounce 3s and only reset if still absent.
            if (currentSink !== prefs.outputDeviceId) return;

            if (this._disconnectDebounceTimer) clearTimeout(this._disconnectDebounceTimer);
            this._disconnectDebounceTimer = setTimeout(async () => {
                this._disconnectDebounceTimer = null;
                let devices2;
                try { devices2 = await navigator.mediaDevices.enumerateDevices(); } catch (e) { return; }
                const stillAbsent = !devices2.some(d =>
                    d.kind === 'audiooutput' &&
                    (d.deviceId === prefs.outputDeviceId ||
                     (prefs.outputDeviceLabel && d.label === prefs.outputDeviceLabel)));
                if (!stillAbsent) return;
                // Confirmed long disconnect: reset to fallback.
                // Save pipeline state first so a watchdog-triggered force-relaunch
                // (if reset() somehow hangs despite our timeouts) still preserves
                // the user's plugin configuration.
                this._lastHdmiReconnectResetTime = 0;
                await this._savePipelineStateBeforeRisk();
                try {
                    await this.audioManager.reset(null);
                } catch (err) {
                    console.error('[disconnectDebounce] reset failed:', err);
                }
            }, 3000);
            return;
        }

        // Device is present — cancel any pending disconnect debounce
        if (this._disconnectDebounceTimer) {
            clearTimeout(this._disconnectDebounceTimer);
            this._disconnectDebounceTimer = null;
        }

        if (wasAbsent || foundByLabel) {
            // The full app-relaunch path is a macOS-specific workaround for
            // CoreAudio HDMI reconnect — Chromium's renderer must be killed
            // before audio can be restored.  On Windows/Linux, sinkId reapply
            // (or a full audio reset) recovers without restarting the process,
            // so do not relaunch there.
            if (window.electronAPI?.platform === 'darwin') {
                await this._doMacosRelaunch();
                return;
            }

            // Non-macOS: sinkId reapply is sufficient on Windows/Linux.
            // Force a reapply even when the cached sinkId still matches, since
            // on those platforms the underlying audio binding can become stale
            // after the device disappeared and reappeared.
            const success = await this.audioManager.ioManager.reapplyOutputDevice(activeDeviceId);
            if (!success) {
                console.warn('[handleOutputDeviceChange] reapplyOutputDevice failed on non-macOS HDMI reconnect, falling back to full reset');
                try {
                    await this.audioManager.reset(null);
                } catch (err) {
                    console.error('[handleOutputDeviceChange] reset(null) after reapply failure threw:', err);
                }
            }
            return;
        }

        if (currentSink !== activeDeviceId) {
            const success = await this.audioManager.ioManager.reapplyOutputDevice(activeDeviceId);
            if (!success) {
                if (window.electronAPI?.platform === 'darwin') {
                    // On macOS, sinkId reapply failure usually means CoreAudio is in a
                    // stuck HDMI state — reset(null) cannot recover and tends to hang.
                    // Defer to the relaunch handler (gated by cooldown + startup grace).
                    console.warn('[handleOutputDeviceChange] reapplyOutputDevice failed on sinkId mismatch, deferring to macOS relaunch');
                    await this._doMacosRelaunch();
                } else {
                    console.warn('[handleOutputDeviceChange] reapplyOutputDevice failed on sinkId mismatch, falling back to full reset');
                    try {
                        await this.audioManager.reset(null);
                    } catch (err) {
                        console.error('[handleOutputDeviceChange] reset(null) after reapply failure threw:', err);
                    }
                }
            }
        }
    }

    /**
     * Save current pipeline state to file (best-effort, non-blocking on failure).
     * Used before risky audio operations so a watchdog-triggered force-relaunch
     * still preserves the user's pipeline configuration.
     */
    async _savePipelineStateBeforeRisk() {
        try {
            const core = window.pipelineManager?.core;
            if (window.electronAPI?.savePipelineStateToFile && core && this.audioManager) {
                const serialize = (pl) => pl
                    ? pl.map(p => core.getSerializablePluginState(p, false, false, false))
                    : null;
                const state = {
                    pipelineA: serialize(this.audioManager.pipelineA),
                    pipelineB: serialize(this.audioManager.pipelineB),
                    currentPipeline: this.audioManager.currentPipeline
                };
                await window.electronAPI.savePipelineStateToFile(state);
            }
        } catch (err) {
            console.warn('[savePipelineStateBeforeRisk] state save failed (continuing):', err);
        }
    }

    /**
     * macOS-only HDMI reconnect recovery via full app relaunch.
     * Called from both the devicechange handler and the device-poll fallback.
     * Gated by a 10 s cooldown and a 10 s startup grace (≤ 6 relaunches/min
     * worst case) so that an unstable HDMI link around app launch cannot
     * trigger an infinite relaunch loop.
     * No-op outside the gate — caller may safely await without further checks.
     */
    async _doMacosRelaunch() {
        const now = Date.now();
        const elapsed = now - this._lastHdmiReconnectResetTime;
        if (elapsed < 10000) {
            return;
        }

        // Skip auto-relaunch for the first 10 s after app start to prevent
        // infinite relaunch loops when HDMI is unstable around launch.
        // (Was 30 s — shortened because user-driven HDMI tests within the
        // first 30 s of startup were being silently blocked from recovery,
        // and the cooldown alone is sufficient to bound loops at 6/min.)
        const timeSinceStart = Date.now() - this._appStartTime;
        if (timeSinceStart < 10000) {
            return;
        }

        // Arm cooldown only once we've actually committed to relaunching,
        // so the startup-grace early-return does not erroneously block
        // legitimate reconnects within the next 10 seconds.
        this._lastHdmiReconnectResetTime = now;

        // Save pipeline state before relaunch so user's work is preserved.
        // Use pipelineManager.core to produce the serializable form (name/enabled/parameters),
        // not audioManager.getPipelineState() which returns raw plugin instances.
        try {
            const core = window.pipelineManager?.core;
            if (window.electronAPI?.savePipelineStateToFile && core && this.audioManager) {
                const serialize = (pl) => pl
                    ? pl.map(p => core.getSerializablePluginState(p, false, false, false))
                    : null;
                const state = {
                    pipelineA: serialize(this.audioManager.pipelineA),
                    pipelineB: serialize(this.audioManager.pipelineB),
                    currentPipeline: this.audioManager.currentPipeline
                };
                await window.electronAPI.savePipelineStateToFile(state);
            } else if (!core) {
                console.error('[_doMacosRelaunch] pipelineManager.core unavailable — skipping pipeline save before relaunch');
            }
        } catch (err) {
            console.error('[_doMacosRelaunch] Failed to save pipeline state before relaunch — user work may be lost:', err);
        }

        try {
            if (window.electronAPI?.relaunchApp) {
                await window.electronAPI.relaunchApp();
            } else {
                console.warn('[_doMacosRelaunch] electronAPI.relaunchApp unavailable, falling back to window.location.reload()');
                window.location.reload();
            }
        } catch (err) {
            console.error('[_doMacosRelaunch] relaunchApp failed, falling back to reload:', err);
            window.location.reload();
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
                
                const playbackDescriptors = window.pendingMusicFiles.filter(item =>
                    item && typeof item === 'object' && typeof item.path === 'string' &&
                    Number.isSafeInteger(item.byteLength) && item.byteLength >= 0
                );
                if (playbackDescriptors.length > 0) {
                    try {
                        window._commandLineMusicFilesNoInput = true;
                        this.uiManager.createAudioPlayer(playbackDescriptors, false);
                        setTimeout(() => {
                            if (this.uiManager.audioPlayer) this.uiManager.audioPlayer.play();
                        }, 1000);
                    } catch (error) {
                        console.error('Initial music playback setup diagnostic:', error);
                    }
                } else {
                    console.error('Initial music file admission returned no playable files');
                }
                
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

function autoStartApplication({
    windowRef = window,
    AppClass = App,
    firstLaunchPromise = isFirstLaunchPromise,
    startHeartbeat = startRendererWatchdogHeartbeat,
    startApplicationFn = startApplication
} = {}) {
    if (windowRef.__EFFECTUNE_DISABLE_APP_AUTO_START__) {
        return null;
    }

    return startApplicationFn({
        AppClass,
        firstLaunchPromise,
        loadInitialConfigFn: async () => {
            const { loadConfig } = await import('./electron/configIntegration.js');
            const isElectron = windowRef.electronIntegration?.isElectronEnvironment?.() ||
                windowRef.electronIntegration?.isElectron ||
                false;
            const config = await loadConfig(isElectron);
            windowRef.appConfig = config;
            if (windowRef.electronIntegration) {
                windowRef.electronIntegration.config = config;
            }
            applyInitialStartupViewClass(config, windowRef);
            return config;
        },
        startHeartbeat,
        windowRef
    });
}

autoStartApplication();

export {
    App,
    INITIALIZATION_CONFIG,
    autoStartApplication,
    displayAppVersion,
    getPipelineStateForSave,
    loadPipelineState,
    writePipelineStateToFile
};
