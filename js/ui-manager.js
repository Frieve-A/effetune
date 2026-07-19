import { PluginListManager } from './ui/plugin-list-manager.js';
import { PipelineManager } from './ui/pipeline-manager.js';
import { StateManager } from './ui/state-manager.js';
import { AudioPlayer } from './ui/audio-player.js';
import {
    TRANSLATED_LANGUAGE_CODES,
    normalizeLanguagePreference,
    resolveLanguagePreference
} from './language-options.js';
import {
    getSerializablePluginStateShort,
    convertPresetToShortFormat
} from './utils/serialization-utils.js';
import {
    encodePipelineState,
    decodePipelineState
} from './utils/pipeline-state-codec.js';
import { DoubleBlindTest } from './ui/double-blind-test/double-blind-test.js';
import { copyTextToClipboard, readTextFromClipboard } from './utils/clipboard-utils.js';
import { LayoutModeManager } from './ui/layout-mode-manager.js';
import { MobileMenu } from './ui/mobile-menu.js';
import { MobileNav } from './ui/mobile-nav.js';
import { LibraryManagerV2 } from './library/library-manager-v2.js';
import { createWebCatalogRecoveryController } from './library/repository/catalog-client-factory.js';
import { LibraryView } from './ui/library/library-view.js';
import { PowerStateView } from './ui/power-state-view.js';
import { CatalogPlaybackBridge } from './ui/audio-player/catalog-playback-bridge.js';
import { resolveWebPlaybackSelection } from './ui/playback-selection-router.js';
import { resolveWebCueSiblingFiles } from './ui/web-cue-source-resolver.js';

function usesIOSFilePicker(windowRef = window) {
    const navigatorRef = windowRef?.navigator || globalThis.navigator;
    const userAgent = String(navigatorRef?.userAgent || '');
    const platform = String(navigatorRef?.platform || '');
    return /iPad|iPhone|iPod/.test(userAgent)
        || (platform === 'MacIntel' && Number(navigatorRef?.maxTouchPoints || 0) > 1);
}

const ERROR_MESSAGE_DURATION_MS = 5000;
const MINI_PLAYER_ALWAYS_ON_TOP_STORAGE_KEY = 'miniPlayerAlwaysOnTop';
const WEB_MUSIC_FILE_ACCEPT = 'audio/*,video/mp4,image/jpeg,image/png,.mp4,.cue,.jpg,.png';
const WEB_MUSIC_PICKER_TYPES = [{
    accept: {
        'audio/*': ['.aac', '.flac', '.m4a', '.mp3', '.mp4', '.ogg', '.opus', '.wav', '.webm'],
        'text/plain': ['.cue'],
        'image/jpeg': ['.jpg', '.jpeg'],
        'image/png': ['.png']
    }
}];

function fileExtension(name) {
    const value = String(name ?? '');
    const index = value.lastIndexOf('.');
    return index < 0 ? '' : value.slice(index + 1).toLowerCase();
}

function readStoredBoolean(key) {
    try {
        return globalThis.localStorage?.getItem?.(key) === 'true';
    } catch (_) {
        return false;
    }
}

function storeBoolean(key, value) {
    try {
        globalThis.localStorage?.setItem?.(key, value ? 'true' : 'false');
    } catch (_) {
        // Storage can be unavailable; the current session still keeps the state.
    }
}

export class UIManager {
    constructor(pluginManager, audioManager) {
        this.pluginManager = pluginManager;
        this.audioManager = audioManager;

        // Set directly in UIManager to maintain original behavior
        this.expandedPlugins = new Set();

        // Audio player reference
        this.audioPlayer = null;
        this.miniPlayerMode = false;
        this.miniPlayerTargetMode = false;
        this.miniPlayerAlwaysOnTop = readStoredBoolean(MINI_PLAYER_ALWAYS_ON_TOP_STORAGE_KEY);
        this.miniPlayerTransition = Promise.resolve(false);
        this.playbackSelectionGeneration = 0;
        this.playbackSelectionAbortController = null;
        this.audioPlayerLayoutPlaceholder = null;
        this.audioPlayerLayoutPlaceholderTimer = null;
        this.transientMessageTimer = null;
        this.libraryManager = null;
        this.libraryView = null;
        this.libraryInitPromise = null;
        this.libraryPlaybackBridge = null;
        this.libraryLifecycleCloseHandler = null;
        this.libraryRecoveryApi = window.electronAPI?.libraryRecoveryV1 ||
            createWebCatalogRecoveryController();
        this.libraryRecoveryState = window.electronAPI?.libraryRecoveryV1
            ? { apiVersion: 1, status: 'initializing', available: false, canReset: false }
            : this.libraryRecoveryApi.getState();
        this.libraryRecoveryReadyPromise = null;
        this.libraryRecoveryStateQueue = Promise.resolve();
        this.libraryRecoveryStateRevision = 0;
        this.libraryRecoveryUnsubscribe = null;
        this.libraryRecoveryRoot = null;
        this.libraryRecoveryResetButton = null;
        this.libraryRecoveryTitle = null;
        this.libraryRecoveryMessage = null;
        this.libraryDeferredStartupOptions = null;
        // Double Blind Test controller (created lazily) and URL-reflection gate
        this.doubleBlindTest = null;
        this.urlReflectionEnabled = true;
        this._pipelineSwitching = false;

        // UI elements
        this.errorDisplay = document.getElementById('errorDisplay');
        this.resetButton = document.getElementById('resetButton');
        this.shareButton = document.getElementById('shareButton');
        this.pluginList = document.getElementById('pluginList');
        this.pipelineList = document.getElementById('pipelineList');
        this.pipelineEmpty = document.getElementById('pipelineEmpty');
        this.sampleRate = document.getElementById('sampleRate');

        // Initialize layout mode before child managers so mobile-specific
        // branches can consult one shared source of truth.
        this.layoutMode = new LayoutModeManager();

        // Make UIManager instance globally available for URL updates and layout checks
        window.uiManager = this;

        // Initialize supported languages
        this.supportedLanguages = TRANSLATED_LANGUAGE_CODES;
        this.languagePreference = this.getStoredLanguagePreference();
        this.userLanguage = this.determineUserLanguage(this.languagePreference);

        // Initialize localization
        this.translations = {}; // Current language translations
        this.englishTranslations = {}; // English translations for fallback
        this.translationRequestGeneration = 0;

        // Initialize managers
        this.pluginListManager = new PluginListManager(pluginManager);
        this.pipelineManager = new PipelineManager(audioManager, pluginManager, this.expandedPlugins, this.pluginListManager);
        this.stateManager = new StateManager(audioManager);
        this.mobileMenu = new MobileMenu(this);
        this.mobileNav = new MobileNav(this);
        this.powerStateView = new PowerStateView({
            eventSource: this.audioManager,
            translate: (key, fallback) => {
                const translated = this.t?.(key);
                return translated && translated !== key ? translated : fallback;
            },
            onResume: () => this.audioManager.powerPolicyController
                ?.requestResumeFromUserGesture?.('dedicated-input')
        });
        this.layoutMode.onChange(() => {
            this.pipelineManager.core.columnManager.updatePipelineColumns(
                this.pipelineManager.core.columnManager.getCurrentColumns()
            );
            this.pluginListManager.updatePositions();
            this.powerStateView?.refreshActions?.();
        });

        // Initialize UI elements
        this.initWhatsThisLink();
        this.initPipelineManager();
        this.initShareButton();
        this.initPresetManagement();
        this.initOpenMusicButton();
        this.initOpenLibraryButton();
        this.initLibraryRecovery();

        // Initialize clipboard buttons
        this.undoButton = document.getElementById('undoButton');
        this.redoButton = document.getElementById('redoButton');
        this.cutButton = document.getElementById('cutButton');
        this.copyButton = document.getElementById('copyButton');
        this.pasteButton = document.getElementById('pasteButton');
        
        // Initialize pipeline toggle buttons
        this.pipelineToggleButton = document.getElementById('pipelineToggleButton');
        this.pipelineMenuButton = document.getElementById('pipelineMenuButton');
        this.pipelineMenu = document.getElementById('pipelineMenu');
        this.copyAToBButton = document.getElementById('copyAToBButton');
        this.copyBToAButton = document.getElementById('copyBToAButton');
        this.doubleBlindTestButton = document.getElementById('doubleBlindTestButton');

        // Initialize localization after everything else is set up
        // This is an async operation, but we can't make the constructor async
        this.localizationReady = this.initLocalization().then(() => {
            // Update UI texts after translations are loaded
            this.updateUITexts();
            this.powerStateView?.setTranslator?.((key, fallback) => {
                const translated = this.t?.(key);
                return translated && translated !== key ? translated : fallback;
            });
            // Initialize clipboard buttons after translations are loaded
            this.initClipboardButtons();
            // Initialize history buttons after translations are loaded
            this.initHistoryButtons();
            // Initialize pipeline toggle buttons after translations are loaded
            this.initPipelineToggleButtons();
            // Initialize keyboard shortcuts
            this.initKeyboardShortcuts();
            
            // Listen for pipeline changes to update UI
            this.audioManager.addEventListener('pipelineChanged', (event) => {
                this.updatePipelineToggleButton();
                this.pipelineManager.updatePipelineUI();
                // If the Double Blind Test panel is open, B may have appeared or
                // disappeared - refresh the start-button availability/warning.
                if (this.doubleBlindTest && this.doubleBlindTest.isActive()) {
                    this.doubleBlindTest._updateStartAvailability();
                }
            });
            return true;
        }).catch(error => {
            console.error('Failed to initialize localization:', error);
            return false;
        });
    }

    // Delegate to PluginListManager
    showLoadingSpinner() {
        this.pluginListManager.showLoadingSpinner();
    }

    hideLoadingSpinner() {
        this.pluginListManager.hideLoadingSpinner();
    }

    updateLoadingProgress(percent) {
        this.pluginListManager.updateLoadingProgress(percent);
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
        this.refreshRangeFillStyling();
    }

    initRangeFillStyling() {
        if (this._rangeFillStylingInitialized || typeof document === 'undefined') {
            return;
        }

        this._rangeFillStylingInitialized = true;
        this._rangeFillInput = (input) => {
            if (!input?.matches?.('input[type="range"]')) return;

            const min = input.min === '' ? 0 : Number(input.min);
            const max = input.max === '' ? 100 : Number(input.max);
            const value = Number(input.value);
            const range = max - min;
            const percent = range > 0 && Number.isFinite(value)
                ? ((value - min) / range) * 100
                : 0;
            const clampedPercent = percent < 0 ? 0 : (percent > 100 ? 100 : percent);

            if (input.style?.setProperty) {
                input.style.setProperty('--et-range-fill', `${clampedPercent}%`);
            }
        };

        this.refreshRangeFillStyling();

        const handleRangeInput = (event) => {
            this._rangeFillInput(event.target);
        };
        document.addEventListener?.('input', handleRangeInput, true);
        document.addEventListener?.('change', handleRangeInput, true);

        if (typeof MutationObserver !== 'undefined' && document.body) {
            this._rangeFillObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of Array.from(mutation.addedNodes || [])) {
                        this.refreshRangeFillStyling(node);
                    }
                }
            });
            this._rangeFillObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    refreshRangeFillStyling(root = document) {
        if (!this._rangeFillInput || !root) {
            return;
        }

        if (root.matches?.('input[type="range"]')) {
            this._rangeFillInput(root);
            return;
        }

        root.querySelectorAll?.('input[type="range"]').forEach(input => {
            this._rangeFillInput(input);
        });
    }

    _setMessage(message, isError = false, params = {}) {
        if (this.transientMessageTimer !== null) {
            clearTimeout(this.transientMessageTimer);
            this.transientMessageTimer = null;
        }

        // Check if the message is a translation key
        if (message && (message.startsWith('error.') || message.startsWith('success.') ||
            message.startsWith('status.') || message.startsWith('library.'))) {
            // Translate the message with provided parameters
            message = this.t(message, params);
        }

        this.stateManager.setError(message, isError);
    }

    _scheduleMessageClear(duration) {
        const timeoutId = setTimeout(() => {
            if (this.transientMessageTimer !== timeoutId) return;
            this.transientMessageTimer = null;
            this.stateManager.clearError();
        }, duration);
        this.transientMessageTimer = timeoutId;
    }

    // Delegate to StateManager with translation. Errors are notifications, not
    // persistent state indicators, so they must never remain in the header forever.
    setError(message, isError = false, params = {}) {
        this._setMessage(message, isError, params);
        if (isError) {
            this._scheduleMessageClear(ERROR_MESSAGE_DURATION_MS);
        }
    }

    showTransientMessage(message, isError = false, params = {}, duration = 3000) {
        this._setMessage(message, isError, params);
        this._scheduleMessageClear(duration);
    }

    toggleMiniPlayer() {
        return this.setMiniPlayerMode(!this.miniPlayerTargetMode);
    }

    setMiniPlayerMode(enabled) {
        const target = enabled === true;
        this.miniPlayerTargetMode = target;
        const transition = this.miniPlayerTransition
            .catch(() => false)
            .then(async () => {
                const changed = await this._setMiniPlayerMode(target);
                if (!changed && this.miniPlayerTargetMode === target) {
                    this.miniPlayerTargetMode = this.miniPlayerMode;
                }
                return changed;
            });
        this.miniPlayerTransition = transition;
        return transition;
    }

    async _setMiniPlayerMode(enabled) {
        const api = window.electronAPI;
        if (typeof api?.setMiniPlayerMode !== 'function') return false;
        if (enabled === this.miniPlayerMode) return true;

        if (enabled) {
            if (!this.audioPlayer?.ui?.container) {
                this.showTransientMessage('ui.mobileNav.noTrack');
                return false;
            }
            const recoveryVisible = this.libraryRecoveryRoot && this.libraryRecoveryRoot.hidden !== true;
            if (this.isDoubleBlindActive() || recoveryVisible) {
                this.showTransientMessage('ui.miniPlayerUnavailable');
                return false;
            }
        }

        const previous = this.miniPlayerMode;
        this.miniPlayerMode = enabled;
        document.body?.classList?.toggle('layout-mini-player', enabled);
        this.audioPlayer?.ui?.setMiniMode?.(enabled);
        this.audioManager?.powerPolicyController?.setDspUiSuppressed?.('mini-player', enabled);

        try {
            await api.setMiniPlayerMode({
                enabled,
                alwaysOnTop: this.miniPlayerAlwaysOnTop
            });
            return true;
        } catch (error) {
            console.error('Mini player mode change failed:', error);
            this.miniPlayerMode = previous;
            document.body?.classList?.toggle('layout-mini-player', previous);
            this.audioPlayer?.ui?.setMiniMode?.(previous);
            this.audioManager?.powerPolicyController?.setDspUiSuppressed?.('mini-player', previous);
            this.showTransientMessage('ui.miniPlayerUnavailable', true);
            return false;
        }
    }

    async setMiniPlayerAlwaysOnTop(enabled) {
        if (!this.miniPlayerMode || typeof window.electronAPI?.setAlwaysOnTop !== 'function') return false;
        const previous = this.miniPlayerAlwaysOnTop;
        this.miniPlayerAlwaysOnTop = enabled === true;
        this.audioPlayer?.ui?.setMiniPlayerAlwaysOnTop?.(this.miniPlayerAlwaysOnTop);
        try {
            await window.electronAPI.setAlwaysOnTop(this.miniPlayerAlwaysOnTop);
            storeBoolean(MINI_PLAYER_ALWAYS_ON_TOP_STORAGE_KEY, this.miniPlayerAlwaysOnTop);
            return true;
        } catch (error) {
            console.error('Mini player always-on-top change failed:', error);
            this.miniPlayerAlwaysOnTop = previous;
            this.audioPlayer?.ui?.setMiniPlayerAlwaysOnTop?.(previous);
            this.showTransientMessage('ui.miniPlayerUnavailable', true);
            return false;
        }
    }

    clearError() {
        if (this.transientMessageTimer !== null) {
            clearTimeout(this.transientMessageTimer);
            this.transientMessageTimer = null;
        }
        this.stateManager.clearError();
    }

    // URL state management
    parsePipelineState() {
        const params = new URLSearchParams(window.location.search);
        const pipelineParam = params.get('p');
        if (!pipelineParam) return null;

        try {
            // Validate base64 format using regex
            if (!/^[A-Za-z0-9+/=]+$/.test(pipelineParam)) {
                throw new Error('Invalid base64 characters in pipeline parameter');
            }

            const state = decodePipelineState(pipelineParam);

            // Validate that state is an array
            if (!Array.isArray(state)) {
                throw new Error('Pipeline state must be an array');
            }

            // Validate each plugin in the state
            const result = state.map(serializedParams => {
                // Validate required fields
                if (typeof serializedParams !== 'object' || serializedParams === null) {
                    throw new Error('Each plugin state must be an object');
                }

                const { nm: name, en: enabled, ib: inputBus, ob: outputBus, ch: channel, ...allParams } = serializedParams;

                // Validate plugin name
                if (typeof name !== 'string' || name.trim() === '') {
                    throw new Error('Plugin name is required and must be a string');
                }

                // Validate that the plugin exists in the plugin manager
                if (this.pluginManager && !this.pluginManager.isPluginAvailable(name)) {
                    console.warn(`Plugin "${name}" is not available in the current configuration`);
                    // We don't throw here to allow for backward compatibility with older configs
                }

                // Validate enabled state
                if (enabled !== undefined && typeof enabled !== 'boolean') {
                    throw new Error('Plugin enabled state must be a boolean');
                }

                // Create a deep copy of all parameters
                const paramsCopy = JSON.parse(JSON.stringify(allParams));

                // Return the complete plugin state
                const result = {
                    name,
                    enabled: enabled === undefined ? true : enabled, // Default to enabled if not specified
                    parameters: paramsCopy
                };

                // Add input and output bus if they exist
                if (inputBus !== undefined) {
                    result.inputBus = inputBus;
                }
                if (outputBus !== undefined) {
                    result.outputBus = outputBus;
                }
                if (channel !== undefined) {
                    result.channel = channel;
                }

                return result;
            });

            return result;
        } catch (error) {
            console.error('Failed to parse pipeline state:', error);
            // Show error to user
            if (this.stateManager) {
                this.setError(this.t('error.invalidUrl', { message: error.message }), true);
            }
            return null;
        }
    }

    getPipelineState() {
        // Get current pipeline state for URL sharing
        const state = this.audioManager.pipeline.map(plugin =>
            getSerializablePluginStateShort(plugin)
        );

        return encodePipelineState(state);
    }

    /**
     * Get (creating on first use) the Double Blind Test controller.
     * @returns {DoubleBlindTest}
     */
    getDoubleBlindTest() {
        if (!this.doubleBlindTest) {
            this.doubleBlindTest = new DoubleBlindTest(this);
        }
        return this.doubleBlindTest;
    }

    /** Is the Double Blind Test mode currently open? */
    isDoubleBlindActive() {
        return !!(this.doubleBlindTest && this.doubleBlindTest.isActive());
    }

    /** Rebuild the Electron application menu (enabled states depend on app state). */
    refreshApplicationMenu() {
        if (!window.electronIntegration || !window.electronIntegration.isElectronEnvironment?.()) {
            return;
        }
        import('./electron/menuIntegration.js')
            .then((m) => m.updateApplicationMenu(true))
            .catch((err) => console.warn('Failed to refresh application menu:', err));
    }

    updateURL() {
        // Suppressed while the Double Blind Test is open so pipeline data never
        // leaks into the address bar.
        if (!this.urlReflectionEnabled) return;

        // Get current state
        const state = this.getPipelineState();
        this.savePipelineStateToLocalStorage(state);
        const newURL = new URL(window.location.href);
        newURL.searchParams.set('p', state);

        // Clear any existing timeout
        if (this._updateURLTimeout) {
            clearTimeout(this._updateURLTimeout);
        }

        // Store the latest URL to ensure it gets applied
        this._latestURL = newURL;

        // Set a new timeout
        this._updateURLTimeout = setTimeout(() => {
            // Apply the latest URL
            window.history.replaceState({}, '', this._latestURL);
            this._updateURLTimeout = null;
        }, 100); // Throttle to once every 100ms
    }

    savePipelineStateToLocalStorage(encodedState = this.getPipelineState()) {
        if (window.electronIntegration?.isElectronEnvironment?.()) return;
        if (this._pipelineStorageTimeout) {
            clearTimeout(this._pipelineStorageTimeout);
        }
        this._pipelineStorageTimeout = setTimeout(() => {
            try {
                localStorage.setItem('effetune_pipeline_state', encodedState);
            } catch (error) {
                console.warn('Failed to save web pipeline state:', error);
            }
            this._pipelineStorageTimeout = null;
        }, 250);
    }

    flushPipelineStateToLocalStorage() {
        if (window.electronIntegration?.isElectronEnvironment?.()) return;
        if (this._pipelineStorageTimeout) {
            clearTimeout(this._pipelineStorageTimeout);
            this._pipelineStorageTimeout = null;
        }
        try {
            localStorage.setItem('effetune_pipeline_state', this.getPipelineState());
        } catch (error) {
            console.warn('Failed to flush web pipeline state:', error);
        }
    }

    loadPipelineStateFromLocalStorage() {
        if (window.electronIntegration?.isElectronEnvironment?.()) return null;
        try {
            const encodedState = localStorage.getItem('effetune_pipeline_state');
            if (!encodedState) return null;
            if (!/^[A-Za-z0-9+/=]+$/.test(encodedState)) return null;
            const decoded = decodePipelineState(encodedState);
            if (!Array.isArray(decoded)) return null;
            return decoded.map(serializedParams => {
                const { nm: name, en: enabled, ib: inputBus, ob: outputBus, ch: channel, ...parameters } = serializedParams;
                if (!name) return null;
                return {
                    name,
                    enabled: enabled === undefined ? true : enabled,
                    parameters,
                    ...(inputBus !== undefined && { inputBus }),
                    ...(outputBus !== undefined && { outputBus }),
                    ...(channel !== undefined && { channel })
                };
            }).filter(Boolean);
        } catch (error) {
            console.warn('Failed to load web pipeline state:', error);
            return null;
        }
    }

    // Call this method after audio context is initialized
    initAudio() {
        if (this.audioManager.audioContext) {
            this.updateSampleRateDisplay();

            // Set up a MutationObserver to watch for changes to the sampleRate element
            // This ensures the sample rate is always displayed correctly, even after sleep mode changes
            if (!this._sampleRateObserver && this.sampleRate) { // Added check for this.sampleRate
                this._sampleRateObserver = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        if (mutation.type === 'childList' || mutation.type === 'characterData') {
                            // If the content doesn't end with Hz, update it
                            const content = this.sampleRate.textContent;
                            if (!content.includes('Hz')) {
                                this.updateSampleRateDisplay();
                            }
                        }
                    }
                });

                this._sampleRateObserver.observe(this.sampleRate, {
                    childList: true,
                    characterData: true,
                    subtree: true
                });
            }

            // Listen for sleep mode changes from AudioManager
            this.audioManager.addEventListener('sleepModeChanged', (data) => {
                // Legacy sleep-mode indicator: kept as a fallback while the
                // power policy controller is disabled. When the controller is
                // enabled, PowerStateView owns the power-state presentation.
                if (this.audioManager.powerPolicyController?.isControllerEnabled?.()) return;
                this.updateSleepModeDisplay(data.isSleepMode, data.sampleRate);
            });

            this.audioManager.addEventListener('audioGraphRebuilt', () => {
                this.updateSampleRateDisplay();
            });

            this.initRangeFillStyling();
        }
    }

    // Update the sleep mode display based on the sleep mode state
    updateSleepModeDisplay(isSleepMode, sampleRate) {
        if (!this.sampleRate) return;

        const sleepModeText = this.t('ui.sleepMode');
        
        // Get current channel count from audio context destination
        const channelCount = this.audioManager.audioContext.destination.channelCount || 2;
        const showChannelCount = channelCount > 2;

        if (isSleepMode) {
            // Add sleep mode indicator if not already present
            if (!this.sampleRate.textContent.includes(sleepModeText)) {
                if (this.sampleRate) { // Added check
                    this.sampleRate.textContent += ` - ${sleepModeText}`;
                }
            }
        } else {
            // Remove sleep mode indicator and ensure sample rate is displayed correctly
            let currentText = this.sampleRate.textContent;
            let updatedText = currentText.replace(` - ${sleepModeText}`, '');
            if (this.sampleRate) { // Added check
                this.sampleRate.textContent = updatedText;
            }
            // Make sure the sample rate is still displayed correctly
            if (!this.sampleRate.textContent.includes('Hz') && sampleRate) {
                if (this.sampleRate) { // Added check
                    if (showChannelCount) {
                        this.sampleRate.textContent = `${sampleRate} Hz ${channelCount}ch`;
                    } else {
                        this.sampleRate.textContent = `${sampleRate} Hz`;
                    }
                }
            }
        }
    }

    // Update the sample rate display with the current audio context sample rate
    updateSampleRateDisplay() {
        if (this.audioManager.audioContext && this.sampleRate) {
            // Get the current sample rate from the audio context
            const currentSampleRate = this.audioManager.audioContext.sampleRate;
            
            // Get current channel count from audio context destination
            const channelCount = this.audioManager.audioContext.destination.channelCount || 2;

            // Preserve sleep mode indicator if present
            const sleepModeText = this.t('ui.sleepMode');
            const isSleepMode = this.sampleRate.textContent.includes(sleepModeText);
            
            // Set the basic sample rate text
            if (this.sampleRate) { // Added check
                // Display channel count only if it's not the default stereo (2ch)
                if (channelCount > 2) {
                    this.sampleRate.textContent = `${currentSampleRate} Hz ${channelCount}ch`;
                } else {
                    this.sampleRate.textContent = `${currentSampleRate} Hz`;
                }
                
                // Add sleep mode text if needed
                if (isSleepMode) {
                    this.sampleRate.textContent += ` - ${sleepModeText}`;
                }
            }

            // Add a visual indicator if the sample rate is below recommended value
            if (currentSampleRate < 88200) {
                this.sampleRate.classList.add('low-sample-rate');
                if (this.sampleRate) { // Added check
                    this.sampleRate.title = this.t('error.sampleRateWarning');
                }
            } else {
                this.sampleRate.classList.remove('low-sample-rate');
                if (this.sampleRate) { // Added check
                    this.sampleRate.title = '';
                }
            }
        }
    }

    getStoredLanguagePreference() {
        return normalizeLanguagePreference(window.appConfig?.language);
    }

    determineUserLanguage(languagePreference = this.getStoredLanguagePreference()) {
        return resolveLanguagePreference(languagePreference, navigator.language);
    }

    async syncLanguageWithConfig(config = window.appConfig) {
        const nextPreference = normalizeLanguagePreference(config?.language);
        const nextUserLanguage = this.determineUserLanguage(nextPreference);

        if (nextPreference === this.languagePreference && nextUserLanguage === this.userLanguage) {
            return this.userLanguage;
        }

        return this.setLanguagePreference(nextPreference, { persist: false });
    }

    async setLanguagePreference(languagePreference, { persist = true } = {}) {
        const normalizedPreference = normalizeLanguagePreference(languagePreference);
        const targetLocale = this.determineUserLanguage(normalizedPreference);
        const requestGeneration = ++this.translationRequestGeneration;

        this.languagePreference = normalizedPreference;
        this.userLanguage = targetLocale;

        if (persist && window.electronIntegration && window.electronIntegration.isElectronEnvironment()) {
            await window.electronIntegration.saveConfig({ language: normalizedPreference });
        }

        window.appConfig = {
            ...(window.appConfig || {}),
            language: normalizedPreference
        };

        await this.loadTranslations(targetLocale, requestGeneration);
        return this.userLanguage;
    }

    /**
     * Initialize localization system
     */
    async initLocalization() {
        try {
            // Always load English translations first for fallback
            await this.loadEnglishTranslations();

            // If user language is not English, load that language's translations
            if (this.userLanguage !== 'en') {
                await this.loadTranslations(this.userLanguage);
            }

            // Update Electron menu if in Electron environment
            if (window.electronIntegration && window.electronIntegration.isElectronEnvironment()) {
                window.electronIntegration.updateApplicationMenu();
            }

            return true;
        } catch (error) {
            console.error('Failed to initialize localization:', error);
            // Initialize with empty translations to avoid errors
            this.translations = {};
            this.englishTranslations = {};
            return false;
        }
    }

    /**
     * Load English translations for fallback
     */
    async loadEnglishTranslations() {
        try {
            // Try to load the English locale file
            const response = await fetch('js/locales/en.json5');

            // If the English file doesn't exist, initialize with empty object
            if (!response.ok) {
                console.error('English translation file not found');
                this.englishTranslations = {};
                return;
            }

            // Get the JSON5 content as text
            const json5Content = await response.text();

            // Remove comments from JSON5 (simple approach)
            const jsonContent = json5Content
                .replace(/\/\/.*$/gm, '') // Remove single-line comments
                .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments

            // Parse the JSON content
            this.englishTranslations = JSON.parse(jsonContent);

            // If user language is English, set translations to English
            if (this.userLanguage === 'en') {
                this.translations = { ...this.englishTranslations };
            }
        } catch (error) {
            console.error('Error loading English translations:', error);
            // If English file cannot be loaded, initialize with empty object
            this.englishTranslations = {};
        }
    }

    /**
     * Load translations for the specified language
     * @param {string} locale - The language code to load
     */
    async loadTranslations(locale, requestGeneration = ++this.translationRequestGeneration) {
        // Default to English if locale is not specified
        const targetLocale = locale || 'en';
        const publishTranslations = translations => {
            if (requestGeneration !== this.translationRequestGeneration ||
                targetLocale !== this.userLanguage) return;
            this.translations = translations;
            this.updateUITexts();
            if (window.electronIntegration && window.electronIntegration.isElectronEnvironment()) {
                window.electronIntegration.updateApplicationMenu();
            }
        };

        // If loading English, use the already loaded English translations
        if (targetLocale === 'en') {
            publishTranslations(this.englishTranslations);
            return;
        }

        try {
            // Try to load the specified locale file
            const response = await fetch(`js/locales/${targetLocale}.json5`);

            // If the locale file doesn't exist, fall back to English
            if (!response.ok) {
                console.warn(`Translation file for ${targetLocale} not found, falling back to English`);
                publishTranslations(this.englishTranslations);
                return;
            }

            // Get the JSON5 content as text
            const json5Content = await response.text();

            // Remove comments from JSON5 (simple approach)
            const jsonContent = json5Content
                .replace(/\/\/.*$/gm, '') // Remove single-line comments
                .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments

            // Parse the JSON content
            publishTranslations(JSON.parse(jsonContent));
        } catch (error) {
            console.error(`Error loading translations for ${targetLocale}:`, error);
            // Fall back to English translations
            publishTranslations(this.englishTranslations);
        }
    }

    /**
     * Get a translated string by key
     * @param {string} key - The translation key
     * @param {Object} params - Parameters to replace in the string
     * @returns {string} The translated string
     */
    t(key, params = {}) {
        // First try to get the translation from the current language
        let text;

        // If the key exists in current language translations, use it
        if (this.translations && this.translations[key]) {
            text = this.translations[key];
        }
        // If not found in current language but exists in English, use English translation
        else if (this.englishTranslations && this.englishTranslations[key]) {
            text = this.englishTranslations[key];
        }
        // If not found in either language, use the key itself
        else {
            text = key;
        }

        // Replace parameters in the string
        if (params && Object.keys(params).length > 0) {
            Object.entries(params).forEach(([param, value]) => {
                const placeholder = `{${param}}`;
                text = text.replace(new RegExp(placeholder, 'g'), value);
            });
        }

        return text;
    }

    /**
     * Update UI elements with translated text
     */
    updateUITexts() {
        // Update static UI elements
        const subtitleElement = document.querySelector('.subtitle');
        if (subtitleElement) {
            subtitleElement.textContent = "Color the music, unleash your senses. Craft your own signature sound.";
        }
        const whatsThisElement = document.querySelector('.whats-this');
        if (whatsThisElement) {
            whatsThisElement.textContent = this.t('ui.whatsThisApp');
            this.updateWhatsThisLinkTarget();
        }
        const availableEffectsTitle = document.getElementById('availableEffectsTitle');
        if (availableEffectsTitle) {
            availableEffectsTitle.textContent = "Available Effects";
        }
        const pipelineHeaderTitle = document.querySelector('.pipeline-header h2');
         if (pipelineHeaderTitle) {
            pipelineHeaderTitle.textContent = "Effect Pipeline";
         }
        this.updatePipelineEmptyContent();
        this.renderLibraryRecoveryShell();
        this.libraryView?.updateUITexts?.();
        const shareButton = document.getElementById('shareButton');
        if (shareButton) {
            shareButton.textContent = this.t('ui.shareButton');
        }
        this.stateManager?.updateLabels?.();
        this.mobileMenu?.updateLabels?.();
        this.powerStateView?.redrawLanguage?.();
        if (this.doubleBlindTestButton) {
            this.doubleBlindTestButton.textContent = this.t('menu.doubleBlindTest');
        }
        // Refresh the Double Blind Test panel text if it is open
        if (this.doubleBlindTest && this.doubleBlindTest.isActive()) {
            this.doubleBlindTest.updateTexts();
        }
        const effectSearchInput = document.getElementById('effectSearchInput');
         if (effectSearchInput) {
            effectSearchInput.placeholder = this.t('ui.searchEffectsPlaceholder');
         }

        // Update drag message in plugin list manager
        if (this.pluginListManager && this.pluginListManager.dragMessage) {
             // Assuming dragMessage is an HTML element
             if (this.pluginListManager.dragMessage) {
                this.pluginListManager.dragMessage.textContent = this.t('ui.dragEffectMessage');
             }
        }

        // Update titles for common buttons
        const openMusicButton = document.getElementById('openMusicButton');
        if (openMusicButton) {
            openMusicButton.title = this.t('ui.title.openMusic');
        }

        const effectPipelineButton = document.getElementById('effectPipelineButton');
        if (effectPipelineButton) {
            const title = this.t('ui.title.effectPipeline');
            effectPipelineButton.title = title;
            effectPipelineButton.setAttribute('aria-label', title);
        }

        const openLibraryButton = document.getElementById('openLibraryButton');
        if (openLibraryButton) {
            const title = this.t('ui.title.openLibrary');
            openLibraryButton.title = title;
            openLibraryButton.setAttribute('aria-label', title);
        }

        const sidebarButton = document.getElementById('sidebarButton');
        if (sidebarButton) {
            sidebarButton.title = this.t('ui.title.sidebar');
        }

        const searchButton = document.getElementById('effectSearchButton');
        if (searchButton) {
            searchButton.title = this.t('ui.title.searchEffects');
        }

        const masterToggle = document.querySelector('.toggle-button.master-toggle');
        if (masterToggle) {
            masterToggle.title = this.t('ui.title.masterToggle');
        }

        const presetSelect = document.getElementById('presetSelect');
        if (presetSelect) {
            presetSelect.title = this.t('ui.title.presetSelect');
        }

        const undoButton = document.getElementById('undoButton');
        if (undoButton) {
            undoButton.title = this.t('ui.title.undo');
        }

        const redoButton = document.getElementById('redoButton');
        if (redoButton) {
            redoButton.title = this.t('ui.title.redo');
        }

        const cutButton = document.getElementById('cutButton');
        if (cutButton) {
            cutButton.title = this.t('ui.title.cut');
        }

        const copyButton = document.getElementById('copyButton');
        if (copyButton) {
            copyButton.title = this.t('ui.title.copy');
        }

        const pasteButton = document.getElementById('pasteButton');
        if (pasteButton) {
            pasteButton.title = this.t('ui.title.paste');
        }

        const savePresetButton = document.getElementById('savePresetButton');
        if (savePresetButton) {
            savePresetButton.title = this.t('ui.title.savePreset');
        }

        const deletePresetButton = document.getElementById('deletePresetButton');
        if (deletePresetButton) {
            deletePresetButton.title = this.t('ui.title.deletePreset');
        }

        if (shareButton) {
            shareButton.title = this.t('ui.title.sharePipeline');
        }

        const decreaseColumnsButton = document.getElementById('decreaseColumnsButton');
        if (decreaseColumnsButton) {
            decreaseColumnsButton.title = this.t('ui.title.decreaseColumns');
        }

        const increaseColumnsButton = document.getElementById('increaseColumnsButton');
        if (increaseColumnsButton) {
            increaseColumnsButton.title = this.t('ui.title.increaseColumns');
        }

        // Update tab button titles
        const effectsTab = document.getElementById('effectsTab');
        if (effectsTab) {
            effectsTab.title = this.t('ui.title.availableEffects');
        }

        const systemPresetsTab = document.getElementById('systemPresetsTab');
        if (systemPresetsTab) {
            systemPresetsTab.title = this.t('ui.title.systemPresets');
        }

        const userPresetsTab = document.getElementById('userPresetsTab');
        if (userPresetsTab) {
            userPresetsTab.title = this.t('ui.title.userPresets');
        }
    }

    updatePipelineEmptyContent() {
        const pipelineEmpty = this.pipelineEmpty || document.getElementById('pipelineEmpty');
        if (!pipelineEmpty) return;

        let message = pipelineEmpty.querySelector?.('.pipeline-empty-message');
        if (!message) {
            Array.from(pipelineEmpty.children || []).forEach(child => {
                if (typeof child.remove === 'function') {
                    child.remove();
                } else {
                    pipelineEmpty.removeChild(child);
                }
            });
            pipelineEmpty.textContent = '';
            message = document.createElement('div');
            message.className = 'pipeline-empty-message';
            pipelineEmpty.appendChild(message);
        }
        message.textContent = this.t('ui.dragPluginsHere');
        pipelineEmpty.querySelectorAll?.('.mobile-effects-open-music')?.forEach(button => button.remove());
    }

    getLocalizedDocPath(basePath) {
        // Always use GitHub Pages paths for both web and Electron
        const baseUrl = 'https://effetune.frieve.com';

        // Ensure we're working with a clean path
        let cleanPath = basePath;

        // Convert .md to .html if needed
        if (cleanPath.endsWith('.md')) {
            cleanPath = cleanPath.replace(/\.md$/, '.html');
        }

        // If path is '/README.md' or '/README.html', use the localized top page
        if (cleanPath === '/README.html' || cleanPath === '/README.md' || cleanPath === '/') {
            if (this.userLanguage && this.userLanguage !== 'en') { // Only add language prefix if not English
                return `${baseUrl}/docs/i18n/${this.userLanguage}/`;
            }
            return `${baseUrl}/`; // Default English path
        }

        // Handle plugin documentation
        if (cleanPath.startsWith('/plugins/')) {
            // Extract anchor if present
            let anchor = '';
            if (cleanPath.includes('#')) {
                const parts = cleanPath.split('#');
                cleanPath = parts[0];
                anchor = '#' + parts[1];
            }

            // Remove any existing extension
            cleanPath = cleanPath.replace(/\.[^/.]+$/, '');

            // Add .html extension
            cleanPath = cleanPath + '.html' + anchor;

            if (this.userLanguage && this.userLanguage !== 'en') { // Only add language prefix if not English
                return `${baseUrl}/docs/i18n/${this.userLanguage}${cleanPath}`;
            }
            return `${baseUrl}/docs${cleanPath}`; // Default English path
        }

        // Handle index.html or empty path
        if (cleanPath === '/index.html' || cleanPath === './') {
            if (this.userLanguage && this.userLanguage !== 'en') { // Only add language prefix if not English
                return `${baseUrl}/docs/i18n/${this.userLanguage}/`;
            }
            return `${baseUrl}/docs/`; // Default English path
        }

        // For other paths
         if (this.userLanguage && this.userLanguage !== 'en') { // Only add language prefix if not English
            return `${baseUrl}/docs/i18n/${this.userLanguage}${cleanPath}`;
        }
        return `${baseUrl}/docs${cleanPath}`; // Default English path
    }


    initWhatsThisLink() {
        const whatsThisLink = document.querySelector('.whats-this');
        if (whatsThisLink) {
            // For both Electron and web, open the URL in external browser
            whatsThisLink.addEventListener('click', (e) => {
                e.preventDefault();
                const localizedPath = this.getLocalizedDocPath('/README.md');

                // In Electron, use shell.openExternal to open in default browser
                if (window.electronAPI) {
                    window.electronAPI.openExternalUrl(localizedPath)
                        .catch(err => {
                            console.error('Error opening external URL:', err);
                            // Fallback to window.open
                            window.open(localizedPath, '_blank');
                        });
                } else {
                    // For web, just open in new tab
                    window.open(localizedPath, '_blank');
                }
            });

            this.updateWhatsThisLinkTarget();
        }
    }

    updateWhatsThisLinkTarget() {
        const whatsThisLink = document.querySelector('.whats-this');
        if (!whatsThisLink) {
            return;
        }

        const localizedPath = this.getLocalizedDocPath('/README.md');
        whatsThisLink.href = localizedPath;
        whatsThisLink.target = '_blank';
    }

    initPipelineManager() {
        // Pass the getLocalizedDocPath method to PipelineManager
        this.pipelineManager.getLocalizedDocPath = this.getLocalizedDocPath.bind(this);
    }

    initShareButton() {
        if (this.shareButton) { // Added check
            this.shareButton.addEventListener('click', async () => {
                const state = this.getPipelineState();
                const newURL = new URL('https://effetune.frieve.com/effetune.html');
                newURL.searchParams.set('p', state);
                if (await copyTextToClipboard(newURL.toString())) {
                    this.setError('success.urlCopied', false);
                    setTimeout(() => this.clearError(), 3000);
                } else {
                    console.error('Failed to copy URL');
                    this.setError('error.failedToCopyUrl', true);
                }
            });
        }
    }

    /**
     * Initialize preset management by delegating to PipelineManager
     */
    initPresetManagement() {
        // Get preset UI elements for reference
        this.presetSelect = document.getElementById('presetSelect');
        this.presetList = document.getElementById('presetList');
        this.savePresetButton = document.getElementById('savePresetButton');
        this.deletePresetButton = document.getElementById('deletePresetButton');

        // Delegate preset management to PipelineManager
        // PipelineManager already initializes these elements in its constructor
    }

    /**
     * Initialize open music button
     * Handles opening music files in both Electron and browser environments
     */
    initOpenMusicButton() {
        // Get the open music button element
        this.openMusicButton = document.getElementById('openMusicButton');

        if (this.openMusicButton) {
            this.openMusicButton.addEventListener('click', () => {
                // Check if running in Electron environment
                const isElectron = window.electronIntegration && window.electronIntegration.isElectronEnvironment();

                if (isElectron) {
                    // Use Electron's openMusicFile function
                    window.electronIntegration.openMusicFile();
                } else {
                    this.openWebMusicFilePicker({
                        accept: WEB_MUSIC_FILE_ACCEPT,
                        onFiles: (files, fileHandles) => this.handleWebPlaybackFiles(files, fileHandles)
                    });
                }
            });
        }
    }

    async openWebMusicFilePicker({ accept, onFiles, onCancel = null }) {
        if (!usesIOSFilePicker(window) && typeof window.showOpenFilePicker === 'function') {
            try {
                const handles = await window.showOpenFilePicker({
                    multiple: true,
                    types: WEB_MUSIC_PICKER_TYPES
                });
                const files = await Promise.all(handles.map(handle => handle.getFile()));
                if (files.length > 0) {
                    onFiles(files, new Map(files.map((file, index) => [file, handles[index]])));
                } else {
                    onCancel?.();
                }
                return null;
            } catch (error) {
                if (error?.name === 'AbortError') {
                    onCancel?.();
                    return null;
                }
                console.warn('File System Access picker failed, using the file input fallback:', error);
            }
        }

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        if (accept && !usesIOSFilePicker(window)) fileInput.accept = accept;
        fileInput.multiple = true;
        fileInput.style.display = 'none';

        let settled = false;
        const cleanup = () => {
            if (fileInput.parentNode) fileInput.parentNode.removeChild(fileInput);
        };
        const cancel = () => {
            if (settled) return;
            settled = true;
            cleanup();
            onCancel?.();
        };
        fileInput.addEventListener('change', event => {
            if (settled) return;
            settled = true;
            const files = Array.from(event.target.files ?? []);
            cleanup();
            if (files.length > 0) onFiles(files, null);
            else onCancel?.();
        });
        fileInput.addEventListener('cancel', cancel);
        document.body.appendChild(fileInput);
        fileInput.click();
        return fileInput;
    }

    handleWebPlaybackFiles(files, fileHandles = null) {
        const gestureResume = this.beginPlaybackSelectionGestureResume();
        void this.openWebPlaybackSelection(files, gestureResume, { fileHandles });
        return true;
    }

    beginPlaybackSelectionGestureResume() {
        if (this.audioPlayer?.resumeAudioContextInGesture) {
            return this.audioPlayer.resumeAudioContextInGesture();
        }
        try {
            const controller = this.audioManager?.powerPolicyController;
            const result = controller?.enabled
                ? controller.beginUserGestureResume?.('player-only-play')
                : this.audioManager?.contextManager?.resumeAudioContext?.();
            return Promise.resolve(result ?? true).then(value => value !== false, () => false);
        } catch (_) {
            return Promise.resolve(false);
        }
    }

    async openWebPlaybackSelection(files, gestureResume, { fileHandles = null } = {}) {
        this.playbackSelectionAbortController?.abort();
        const controller = new AbortController();
        const generation = ++this.playbackSelectionGeneration;
        this.playbackSelectionAbortController = controller;
        try {
            const resolveSelection = this.playbackSelectionResolver ?? resolveWebPlaybackSelection;
            const cueFile = Array.from(files ?? []).find(file => fileExtension(file?.name) === 'cue');
            const cueFileHandle = cueFile ? fileHandles?.get?.(cueFile) : null;
            const cueSourceProvider = cueFileHandle
                ? request => (this.webCueSourceResolver ?? resolveWebCueSiblingFiles)({
                    cueFileHandle,
                    ...request
                })
                : null;
            const [selection, resumeReady] = await Promise.all([
                resolveSelection(files, {
                    cueSourceProvider,
                    signal: controller.signal,
                    requestKey: `direct-web:${generation}`
                }),
                Promise.resolve(gestureResume).then(value => value !== false, () => false)
            ]);
            if (generation !== this.playbackSelectionGeneration || controller.signal.aborted) return false;

            const player = this.createAudioPlayer([], false);
            if (resumeReady) {
                await player.loadFiles(selection.tracks, false);
            } else {
                await player.stop();
                player.playbackManager.loadFiles(selection.tracks, false);
                if (!player.ui.container) player.ui.createPlayerUI();
                await player.loadTrack(player.stateManager.getCurrentTrackIndex());
            }
            this.mobileNav?.setView('player');
            return true;
        } catch (error) {
            if (generation !== this.playbackSelectionGeneration || error?.name === 'AbortError') return false;
            console.error('Open Music selection diagnostic:', JSON.stringify({
                code: error?.code || error?.name || 'unknown',
                reason: error?.diagnosticCode || error?.cause?.code || null,
                files: Array.from(files ?? [], file => ({
                    name: String(file?.name ?? ''),
                    size: Number.isSafeInteger(file?.size) ? file.size : null,
                    type: String(file?.type ?? '')
                }))
            }));
            const errorKey = {
                cueSelectionTooLarge: 'error.cueSelectionTooLarge',
                cueSelectionMixed: 'error.cueSelectionMixed',
                cueSelectionInvalid: 'error.cueSelectionInvalid',
                cueSelectionSourceAccessRequired: 'error.cueSelectionSourceAccessRequired'
            }[error?.code] || 'error.musicSelectionUnavailable';
            this.setError(errorKey, true);
            return false;
        }
    }

    /**
     * Initialize music library button and Electron menu events.
     */
    initOpenLibraryButton() {
        this.effectPipelineButton = document.getElementById('effectPipelineButton');
        this.openLibraryButton = document.getElementById('openLibraryButton');
        this.effectPipelineButton?.addEventListener('click', (event) => {
            this.showEffectPipelineView({
                returnFocus: event.currentTarget
            });
        });
        this.openLibraryButton?.addEventListener('click', (event) => {
            this.toggleLibraryView({
                focusSearch: false,
                returnFocus: event.currentTarget
            });
        });

        if (window.electronAPI?.onIPC) {
            window.electronAPI.onIPC('open-library-view', () => this.showLibraryView());
            window.electronAPI.onIPC('open-effect-pipeline-view', () => this.showEffectPipelineView());
            window.electronAPI.onIPC('add-music-folder', async () => {
                try {
                    await this.showLibraryView({ focusSearch: false });
                    await this.libraryManager?.addFolder();
                    this.libraryView?.render();
                } catch (error) {
                    console.error('Failed to add a Music Library folder:', error);
                    this.setError('library.error.actionFailed', true);
                }
            });
            window.electronAPI.onIPC('rescan-library', async () => {
                try {
                    await this.ensureLibraryManager();
                    await this.libraryManager?.scanFolders();
                } catch (error) {
                    console.error('Failed to scan Music Library folders:', error);
                    this.setError('library.error.actionFailed', true);
                }
            });
        }
        window.electronAPI?.onExitMiniPlayer?.(() => this.setMiniPlayerMode(false));
        window.electronAPI?.onToggleMiniPlayer?.(() => this.toggleMiniPlayer());
        this.updateViewSwitchButtons();
    }

    initLibraryRecovery() {
        const api = this.libraryRecoveryApi;
        if (!api || typeof api.getState !== 'function') return;

        if (typeof api.onStateChange === 'function') {
            this.libraryRecoveryUnsubscribe = api.onStateChange(state => {
                this.libraryRecoveryStateRevision += 1;
                this.queueLibraryRecoveryState(state);
            });
        }

        const queryRevision = this.libraryRecoveryStateRevision;
        this.libraryRecoveryReadyPromise = Promise.resolve()
            .then(() => api.getState())
            .then(state => {
                if (queryRevision !== this.libraryRecoveryStateRevision) return this.libraryRecoveryState;
                return this.queueLibraryRecoveryState(state);
            })
            .catch(error => {
                console.error('Failed to read Music Library availability:', error);
                return this.libraryRecoveryState;
            });
    }

    queueLibraryRecoveryState(state) {
        this.libraryRecoveryStateQueue = this.libraryRecoveryStateQueue
            .then(() => this.applyLibraryRecoveryState(state))
            .catch(error => {
                console.error('Failed to apply Music Library availability:', error);
            });
        return this.libraryRecoveryStateQueue.then(() => this.libraryRecoveryState);
    }

    async applyLibraryRecoveryState(state) {
        const normalized = this.normalizeLibraryRecoveryState(state);
        if (!normalized) return this.libraryRecoveryState;
        const previous = this.libraryRecoveryState;
        this.libraryRecoveryState = normalized;
        this.renderLibraryRecoveryShell();

        if (!normalized.available) {
            const wasLibraryVisible = document.body?.classList?.contains('view-library') &&
                !this.libraryDeferredStartupOptions;
            if (previous?.available || this.libraryManager || this.libraryView) {
                await this.disposeLibraryManager({ destroyView: true });
            }
            if (wasLibraryVisible) this.showLibraryRecoveryShell();
            return normalized;
        }

        this.hideLibraryRecoveryShell();
        if (this.libraryDeferredStartupOptions) {
            const options = this.libraryDeferredStartupOptions;
            this.libraryDeferredStartupOptions = null;
            await this.showLibraryView({ ...options, skipRecoveryWait: true });
        } else if (document.body?.classList?.contains('view-library') && !this.libraryView) {
            await this.ensureLibraryManager({ skipRecoveryWait: true });
            if (this.libraryView) this.libraryView.show({ focusSearch: false });
        }
        return normalized;
    }

    normalizeLibraryRecoveryState(state) {
        const status = state?.status;
        if (state?.apiVersion !== 1 || !['initializing', 'available', 'unavailable', 'resetting'].includes(status)) {
            console.error('Ignored an invalid Music Library availability response.');
            return null;
        }
        return {
            apiVersion: 1,
            status,
            available: status === 'available' && state.available === true,
            canReset: status === 'unavailable' && state.canReset === true
        };
    }

    ensureLibraryRecoveryShell() {
        if (this.libraryRecoveryRoot || typeof document?.createElement !== 'function') {
            return this.libraryRecoveryRoot;
        }
        const root = document.createElement('section');
        root.className = 'library-recovery-shell';
        root.hidden = true;
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');

        const panel = document.createElement('div');
        panel.className = 'library-recovery-panel';
        const title = document.createElement('h2');
        title.className = 'library-recovery-title';
        const message = document.createElement('p');
        message.className = 'library-recovery-message';
        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'library-button library-recovery-reset';
        resetButton.addEventListener('click', () => void this.resetLibraryCatalog());
        panel.append(title, message, resetButton);
        root.append(panel);

        const mainContainer = document.querySelector?.('.main-container');
        mainContainer?.parentNode?.insertBefore?.(root, mainContainer.nextSibling);
        this.libraryRecoveryRoot = root;
        this.libraryRecoveryTitle = title;
        this.libraryRecoveryMessage = message;
        this.libraryRecoveryResetButton = resetButton;
        this.renderLibraryRecoveryShell();
        return root;
    }

    renderLibraryRecoveryShell() {
        if (!this.libraryRecoveryRoot) return;
        const status = this.libraryRecoveryState?.status || 'initializing';
        const titleKey = `library.recovery.${status}.title`;
        const messageKey = `library.recovery.${status}.message`;
        this.libraryRecoveryTitle.textContent = this.t?.(titleKey) || titleKey;
        this.libraryRecoveryMessage.textContent = this.t?.(messageKey) || messageKey;
        this.libraryRecoveryResetButton.textContent = this.t?.('library.recovery.action.reset') || 'Reset Library';
        this.libraryRecoveryResetButton.hidden = !this.libraryRecoveryState?.canReset;
        this.libraryRecoveryResetButton.disabled = !this.libraryRecoveryState?.canReset;
    }

    showLibraryRecoveryShell() {
        const root = this.ensureLibraryRecoveryShell();
        if (!root) return false;
        this.renderLibraryRecoveryShell();
        root.hidden = false;
        if (this.libraryView?.root) this.libraryView.root.hidden = true;
        document.body?.classList?.add('view-library');
        this.updateViewSwitchButtons(true);
        this.mobileNav?.setView?.('library', { fromLibraryView: true });
        return true;
    }

    hideLibraryRecoveryShell() {
        if (this.libraryRecoveryRoot) this.libraryRecoveryRoot.hidden = true;
        if (this.libraryView?.root) this.libraryView.root.hidden = false;
    }

    async resetLibraryCatalog() {
        if (!this.libraryRecoveryState?.canReset || typeof this.libraryRecoveryApi?.resetCatalog !== 'function') {
            return false;
        }
        const confirmation = this.t?.('library.recovery.confirm.reset') ||
            'Reset the saved Music Library catalog? Your audio files and other settings will not be changed.';
        if (typeof window.confirm !== 'function' || !window.confirm(confirmation)) return false;
        this.libraryRecoveryResetButton.disabled = true;
        try {
            const result = await this.libraryRecoveryApi.resetCatalog({ confirmed: true });
            if (result?.state) await this.queueLibraryRecoveryState(result.state);
            return result?.recovered === true;
        } catch (error) {
            console.error('Failed to reset the Music Library catalog:', error);
            this.renderLibraryRecoveryShell();
            return false;
        } finally {
            if (this.libraryRecoveryResetButton) {
                this.libraryRecoveryResetButton.disabled = !this.libraryRecoveryState?.canReset;
            }
        }
    }

    async ensureLibraryManager(options = {}) {
        if (this.libraryManager && this.libraryView) {
            return this.libraryManager;
        }
        if (!options.skipRecoveryWait) await this.libraryRecoveryReadyPromise;
        if (!this.libraryRecoveryState?.available) return null;
        if (!this.libraryInitPromise) {
            this.libraryInitPromise = (async () => {
                const manager = this.createLibraryManager();
                this.libraryManager = manager;
                window.libraryManager = manager;
                await manager.init();
                if (!this.libraryRecoveryState?.available || this.libraryManager !== manager) {
                    await manager.close?.();
                    return null;
                }
                this.connectLibraryPlaybackBridge();
                this.libraryView = this.createLibraryView(manager);
                this.libraryView.mount();
                this.mobileNav?.attachLibraryView?.();
                this.registerLibraryLifecycleCleanup();
                return this.libraryManager;
            })().catch(async error => {
                this.libraryInitPromise = null;
                console.error('Failed to initialize the Music Library:', error);
                if (typeof this.libraryRecoveryApi?.reportOpenFailure === 'function') {
                    this.libraryRecoveryApi.reportOpenFailure(error);
                    await this.libraryRecoveryStateQueue;
                } else {
                    this.setError('library.error.actionFailed', true);
                    await this.disposeLibraryManager({ destroyView: true });
                }
                return null;
            });
        }
        return this.libraryInitPromise;
    }

    createLibraryManager() {
        return new LibraryManagerV2({ uiManager: this });
    }

    createLibraryView(manager) {
        return new LibraryView({ manager, uiManager: this });
    }

    connectLibraryPlaybackBridge() {
        const service = this.libraryManager?.bulkOperationService;
        if (!service || this.libraryPlaybackBridge) return this.libraryPlaybackBridge;
        const sequenceClient = typeof service.readSequencePage === 'function'
            ? service
            : this.libraryManager.client;
        this.libraryPlaybackBridge = new CatalogPlaybackBridge({
            uiManager: this,
            service,
            sequenceClient,
            runtime: this.libraryManager.runtime,
            requestFolderAccess: folderId => this.libraryManager?.requestFolderAccess(folderId)
        });
        this.libraryManager.bulkOperationService = this.libraryPlaybackBridge;
        if (this.audioPlayer) this.audioPlayer.libraryOperationService = this.libraryPlaybackBridge;
        return this.libraryPlaybackBridge;
    }

    registerLibraryLifecycleCleanup() {
        if (this.libraryLifecycleCloseHandler) return;
        this.libraryLifecycleCloseHandler = () => {
            void this.disposeLibraryManager();
        };
        window.addEventListener?.('pagehide', this.libraryLifecycleCloseHandler, { once: true });
    }

    async disposeLibraryManager(options = {}) {
        const manager = this.libraryManager;
        const view = this.libraryView;
        this.libraryPlaybackBridge?.close?.();
        this.libraryPlaybackBridge = null;
        this.libraryManager = null;
        this.libraryView = null;
        this.libraryInitPromise = null;
        if (window.libraryManager === manager) window.libraryManager = null;
        if (options.destroyView && view) {
            view.hide?.({ restoreFocus: false });
            for (const unsubscribe of view.unsubscribe || []) unsubscribe?.();
            view.unsubscribe = [];
            view.handleGlobalLibraryKeyDown = () => {};
            view.handleMobilePopState = () => {};
            view.root?.remove?.();
        }
        await manager?.close?.();
    }

    async showLibraryView(options = {}) {
        if ((this.miniPlayerMode || this.miniPlayerTargetMode) && !await this.setMiniPlayerMode(false)) return false;
        await this.ensureLibraryManager({
            skipRecoveryWait: options.skipRecoveryWait === true
        });
        if (options.isCurrentRequest?.() === false) {
            return false;
        }
        if (!this.libraryView) {
            if (this.libraryRecoveryState?.available) {
                this.showEffectPipelineView({ restoreFocus: false });
                return false;
            }
            if (options.initialView !== undefined) {
                this.libraryDeferredStartupOptions = { ...options, isCurrentRequest: undefined };
                this.showEffectPipelineView({ restoreFocus: false });
                return false;
            }
            return this.showLibraryRecoveryShell();
        }
        this.hideLibraryRecoveryShell();
        const focusSearch = options.focusSearch ?? !this.layoutMode?.isMobile;
        const showOptions = {
            focusSearch,
            returnFocus: options.returnFocus || options.opener
        };
        if (options.initialView !== undefined) {
            showOptions.initialView = options.initialView;
        }
        this.libraryView.show(showOptions);
        this.updateViewSwitchButtons(true);
        this.mobileNav?.setView?.('library', { fromLibraryView: true });
        return true;
    }

    async showLibraryTrack(trackId, options = {}) {
        await this.showLibraryView({
            focusSearch: false,
            returnFocus: options.returnFocus
        });
        return this.libraryView?.showTrack?.(trackId, options) || false;
    }

    hideLibraryView(options = {}) {
        const fallbackFocus = options.returnFocus ||
            (this.layoutMode?.isMobile ? this.mobileNav?.getViewButton?.('library') : this.effectPipelineButton) ||
            this.effectPipelineButton ||
            this.openLibraryButton ||
            this.mobileNav?.getViewButton?.('library');
        this.libraryView?.hide({
            restoreFocus: options.restoreFocus,
            returnFocus: options.returnFocus,
            fallbackFocus
        });
        this.hideLibraryRecoveryShell();
        document.body?.classList?.remove('view-library');
        this.updateViewSwitchButtons(false);
    }

    showEffectPipelineView(options = {}) {
        if (this.miniPlayerMode || this.miniPlayerTargetMode) {
            return this.setMiniPlayerMode(false).then(restored =>
                restored ? this.showEffectPipelineView(options) : false);
        }
        if (document.body.classList.contains('view-library') && this.libraryView?.hasActiveDialog?.()) {
            return false;
        }
        this.hideLibraryView({
            ...options,
            returnFocus: options.returnFocus || options.opener
        });
        this.mobileNav?.setView?.('effects', { fromLibraryView: true });
        this.updateViewSwitchButtons(false);
        return true;
    }

    updateViewSwitchButtons(isLibraryVisible = document.body?.classList.contains('view-library')) {
        const setButtonState = (button, active) => {
            if (!button) return;
            if (active) {
                button.classList?.add?.('active');
            } else {
                button.classList?.remove?.('active');
            }
            button.setAttribute?.('aria-pressed', active ? 'true' : 'false');
        };
        setButtonState(this.effectPipelineButton, !isLibraryVisible);
        setButtonState(this.openLibraryButton, Boolean(isLibraryVisible));
    }

    async toggleLibraryView(options = {}) {
        if (document.body.classList.contains('view-library')) {
            return this.showEffectPipelineView(options);
        }
        return this.showLibraryView(options);
    }

    /**
     * Get current preset data for export
     * Delegates to PipelineManager
     * @returns {Object} Current preset data
     */
    getCurrentPresetData() {
        return this.pipelineManager.getCurrentPresetData();
    }

    preserveAudioPlayerLayoutForReplacement() {
        this.releaseAudioPlayerLayoutPlaceholder();

        const container = this.audioPlayer?.ui?.container;
        const parent = container?.parentNode;
        if (!container || !parent || typeof document === 'undefined' || typeof document.createElement !== 'function') {
            return;
        }

        const placeholder = document.createElement('div');
        placeholder.className = 'audio-player-layout-placeholder';
        placeholder.setAttribute?.('aria-hidden', 'true');
        placeholder.style.visibility = 'hidden';
        placeholder.style.pointerEvents = 'none';
        placeholder.style.boxSizing = 'border-box';
        placeholder.style.width = '100%';

        const rect = container.getBoundingClientRect?.();
        const height = Number.isFinite(rect?.height) && rect.height > 0
            ? rect.height
            : (Number.isFinite(container.offsetHeight) ? container.offsetHeight : 0);
        if (height > 0) {
            placeholder.style.height = `${height}px`;
        }

        const computedStyle = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
            ? window.getComputedStyle(container)
            : null;
        if (computedStyle) {
            placeholder.style.marginTop = computedStyle.marginTop;
            placeholder.style.marginRight = computedStyle.marginRight;
            placeholder.style.marginBottom = computedStyle.marginBottom;
            placeholder.style.marginLeft = computedStyle.marginLeft;
        } else {
            placeholder.style.margin = container.style?.margin || '0 0 20px 0';
        }

        if (typeof parent.insertBefore === 'function') {
            parent.insertBefore(placeholder, container);
        } else {
            parent.appendChild?.(placeholder);
        }

        this.audioPlayerLayoutPlaceholder = placeholder;
        this.audioPlayerLayoutPlaceholderTimer = setTimeout(() => {
            this.releaseAudioPlayerLayoutPlaceholder();
        }, 5000);
    }

    releaseAudioPlayerLayoutPlaceholder() {
        if (this.audioPlayerLayoutPlaceholderTimer !== null) {
            clearTimeout(this.audioPlayerLayoutPlaceholderTimer);
            this.audioPlayerLayoutPlaceholderTimer = null;
        }
        const placeholder = this.audioPlayerLayoutPlaceholder;
        this.audioPlayerLayoutPlaceholder = null;
        placeholder?.parentNode?.removeChild?.(placeholder);
    }

    /**
     * Create audio player for music file playback
     * @param {string[]} filePaths - Array of file paths to load
     * @param {boolean} replaceExisting - Whether to replace existing player or add to it
     */
    createAudioPlayer(filePaths, replaceExisting = false) {
        // If we already have an audio player and we're not replacing it,
        // just load the new files into the existing player
        if (this.audioPlayer && !replaceExisting) {
            // Load files into existing player
            if (filePaths && filePaths.length > 0) {
                this.audioPlayer.loadFiles(filePaths, false); // false = replace playlist
            }
            return this.audioPlayer;
        }

        // Close existing player if any
        if (this.audioPlayer) {
            this.preserveAudioPlayerLayoutForReplacement();
            this.audioPlayer.close();
        }

        // Create new player
        this.audioPlayer = new AudioPlayer(this.audioManager);
        if (this.libraryPlaybackBridge) {
            this.audioPlayer.libraryOperationService = this.libraryPlaybackBridge;
        }
        this.mobileNav?.attachPlayerState();

        // Load files
        if (filePaths && filePaths.length > 0) {
            this.audioPlayer.loadFiles(filePaths, false); // false = replace playlist
        }

        return this.audioPlayer;
    }

    /**
     * Load a preset into the pipeline
     * Delegates to PipelineManager
     * @param {Object} preset The preset to load
     */
    loadPreset(preset) {
        if (!preset) {
            this.setError('error.invalidPresetData', true);
            return;
        }

        try {
            // Handle different preset formats
            if (preset.pipeline && Array.isArray(preset.pipeline)) {
                // New format with pipeline array
                // Convert to the format expected by PipelineManager (short format)
                const pipelineManagerPreset = convertPresetToShortFormat(preset);

                // Load the preset directly without affecting localStorage
                this.pipelineManager.loadPreset(pipelineManagerPreset);

                // Clear the preset combo box after loading from file
                if (this.presetSelect) { // Added check
                    this.presetSelect.value = '';
                }
            } else if (preset.plugins && Array.isArray(preset.plugins)) {
                // Old format with plugins array - can be passed directly
                const presetName = preset.name || 'Imported Preset';

                // Ensure the preset has a name
                const pipelineManagerPreset = {
                    ...preset,
                    name: presetName
                };

                // Load the preset directly without affecting localStorage
                this.pipelineManager.loadPreset(pipelineManagerPreset);

                // Clear the preset combo box after loading from file
                if (this.presetSelect) { // Added check
                    this.presetSelect.value = '';
                }
            } else {
                this.setError('error.invalidPresetFormat', true);
            }
        } catch (error) {
            console.error('Failed to load preset:', error);
            this.setError('error.failedToLoadPreset', true);
        }
    }

    /**
     * Initialize clipboard buttons (cut, copy, paste)
     */
    initClipboardButtons() {
        if (this.cutButton) {
            this.cutButton.addEventListener('click', (e) => {
                // Stop event propagation to prevent pipeline click handler from clearing selection
                e.stopPropagation();
                
                this.pipelineManager.clipboardManager.cutSelectedPlugins();
            });
        }
        
        if (this.copyButton) {
            this.copyButton.addEventListener('click', (e) => {
                // Stop event propagation to prevent pipeline click handler from clearing selection
                e.stopPropagation();
                
                this.pipelineManager.clipboardManager.copySelectedPluginsToClipboard();
            });
        }
        
        if (this.pasteButton) {
            this.pasteButton.addEventListener('click', async (e) => {
                // Stop event propagation to prevent pipeline click handler from clearing selection
                e.stopPropagation();

                try {
                    const text = await readTextFromClipboard();
                    if (text) {
                        this.pipelineManager.clipboardManager.handlePaste(text);
                    }
                } catch (err) {
                    // Failed to read clipboard
                    this.setError('error.failedToReadClipboard', true);
                }
            });
        }
    }

    /**
     * Initialize undo/redo buttons
     */
    initHistoryButtons() {
        if (this.undoButton) {
            this.undoButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.pipelineManager.undo();
            });
        }

        if (this.redoButton) {
            this.redoButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.pipelineManager.redo();
            });
        }
    }

    /**
     * Initialize pipeline toggle buttons and menu
     */
    initPipelineToggleButtons() {
        if (this.pipelineToggleButton) {
            this.pipelineToggleButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePipeline();
            });
        }

        if (this.pipelineMenuButton) {
            this.pipelineMenuButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePipelineMenu();
            });
        }

        if (this.copyAToBButton) {
            this.copyAToBButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.copyAToB();
                this.hidePipelineMenu();
            });
        }

        if (this.copyBToAButton) {
            this.copyBToAButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.copyBToA();
                this.hidePipelineMenu();
            });
        }

        if (this.doubleBlindTestButton) {
            this.doubleBlindTestButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hidePipelineMenu();
                // The panel can always be opened; a saved test can be recalled
                // from inside it even when Pipeline B is not currently set up.
                this.getDoubleBlindTest().enterFresh();
            });
        }

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.pipelineMenu?.contains(e.target) && !this.pipelineMenuButton?.contains(e.target)) {
                this.hidePipelineMenu();
            }
        });
    }

    /**
     * Toggle between pipeline A and B
     */
    async togglePipeline() {
        if (this._pipelineSwitching) return;
        this._pipelineSwitching = true;
        try {
            await this.audioManager.togglePipelineWithTransition();
        } finally {
            this._pipelineSwitching = false;
        }
    }

    /**
     * Switch to a specific pipeline with the same output dip as the A/B toggle.
     * @param {string} pipeline - 'A' or 'B'
     */
    async switchPipelineWithTransition(pipeline) {
        if (this._pipelineSwitching || this.audioManager.currentPipeline === pipeline) return;
        this._pipelineSwitching = true;
        try {
            await this.audioManager.setCurrentPipelineWithTransition(pipeline);
        } finally {
            this._pipelineSwitching = false;
        }
    }

    /**
     * Copy pipeline A to B and switch to B
     */
    copyAToB() {
        this.audioManager.copyAToB();
        this.updatePipelineToggleButton();
        this.pipelineManager.updatePipelineUI();
    }

    /**
     * Copy pipeline B to A and switch to A
     */
    copyBToA() {
        this.audioManager.copyBToA();
        this.updatePipelineToggleButton();
        this.pipelineManager.updatePipelineUI();
    }

    /**
     * Update pipeline toggle button text
     */
    updatePipelineToggleButton() {
        if (this.pipelineToggleButton) {
            this.pipelineToggleButton.textContent = this.audioManager.currentPipeline;
        }
    }

    /**
     * Toggle pipeline menu visibility
     */
    togglePipelineMenu() {
        if (this.pipelineMenu) {
            this.pipelineMenu.classList.toggle('show');
        }
    }

    /**
     * Hide pipeline menu
     */
    hidePipelineMenu() {
        if (this.pipelineMenu) {
            this.pipelineMenu.classList.remove('show');
        }
    }

    /**
     * Initialize keyboard shortcuts
     */
    initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (isEditableShortcutTarget(e.target)) {
                return;
            }

            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'l') {
                e.preventDefault();
                if (document.body.classList.contains('view-library') && this.libraryView?.hasActiveDialog?.()) {
                    return;
                }
                this.toggleLibraryView();
                return;
            }

            // Only handle pipeline shortcuts when no modifier keys are pressed
            if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) {
                return;
            }

            // Disable A/B/T pipeline switching while the Double Blind Test is open
            // so the listener cannot reveal or change the active pipeline.
            if (this.isDoubleBlindActive()) {
                return;
            }

            // Handle pipeline shortcuts (T, A, B keys)
            switch (e.key.toLowerCase()) {
                case 't':
                    e.preventDefault();
                    this.togglePipeline();
                    break;
                case 'a':
                    e.preventDefault();
                    this.switchPipelineWithTransition('A');
                    break;
                case 'b':
                    e.preventDefault();
                    if (this.audioManager.pipelineB === null) {
                        // Use togglePipeline if B doesn't exist (same as T key)
                        this.togglePipeline();
                    } else {
                        // Switch to B if it exists
                        this.switchPipelineWithTransition('B');
                    }
                    break;
            }
        });
    }
}

function isEditableShortcutTarget(target) {
    const tagName = target?.tagName?.toLowerCase?.() || '';
    return tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        Boolean(target?.isContentEditable);
}
