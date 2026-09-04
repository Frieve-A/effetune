/**
 * Electron integration module for EffeTune
 * Provides desktop-specific functionality when running in Electron
 */

import { getAudioMimeType } from './audio/audio-mime.js';
import {
  loadAudioPreferences,
  mergeWebAudioPreferences,
  saveAudioPreferences
} from './electron/audio-preference-store.js';
import { loadConfig, saveConfig } from './electron/config-store.js';

export class ElectronIntegration {
  constructor() {
    // More robust detection of Electron environment
    const userAgent = navigator.userAgent.toLowerCase();
    const isElectronUA = userAgent.indexOf(' electron/') > -1;
    this.isElectron = window.electronAPI !== undefined || isElectronUA;
    this.audioPreferences = null;
    this.config = null;
    
    // Initialize event listeners if running in Electron
    if (this.isElectron) {
      // Initialize event listeners
      this.initEventListeners();
      this.patchDocumentationLinks();
    }
  }
  
  /**
   * Add debug handler for drag and drop events (for development only)
   * @private
   */
  addDragDropDebugHandler() {
    // This method is kept for reference but not used in production
  }

  /**
   * Update the application menu with translated labels
   * This method is called when translations are loaded
   */
  updateApplicationMenu() {
    return import('./electron/menuIntegration.js')
      .then(module => module.updateApplicationMenu(this.isElectron));
  }

  /**
   * Update the tray menu with translated labels
   */
  updateTrayMenu() {
    return import('./electron/menuIntegration.js')
      .then(module => module.updateTrayMenu(this.isElectron));
  }

  /**
   * Patch document links to use local markdown files in Electron
   */
  patchDocumentationLinks() {
    // Override the getLocalizedDocPath method in UIManager when it's available
    const waitForUIManager = setInterval(() => {
      if (window.uiManager) {
        const originalGetLocalizedDocPath = window.uiManager.getLocalizedDocPath;
        
        window.uiManager.getLocalizedDocPath = (basePath) => {
          // If we're in Electron, convert paths to local markdown files
          if (this.isElectron) {
            // Convert doc path for Electron
            
            // Handle the main README
            if (basePath === '/README.md' || basePath === '/') {
              const language = window.uiManager.userLanguage;
              if (language && language !== 'en') {
                return '/docs/i18n/' + language + '/';
              }
              return '/';
            }
            
            // Handle plugin documentation
            if (basePath.startsWith('/plugins/')) {
              const language = window.uiManager.userLanguage;
              // Remove .html extension and any hash
              let cleanPath = basePath.replace('.html', '').split('#')[0];
              // Store the anchor if present
              const anchor = basePath.includes('#') ? basePath.split('#')[1] : '';
              
              if (language && language !== 'en') {
                return `docs/i18n/${language}${cleanPath}.md${anchor ? '#' + anchor : ''}`;
              }
              return `docs${cleanPath}.md${anchor ? '#' + anchor : ''}`;
            }
            
            // Handle index.html or empty path
            if (basePath === '/index.html' || basePath === './') {
              const language = window.uiManager.userLanguage;
              if (language && language !== 'en') {
                return '/docs/i18n/' + language + '/';
              }
              return '/';
            }
            
            // For other paths, just convert to local path
            const language = window.uiManager.userLanguage;
            if (language && language !== 'en' && !basePath.includes(`/i18n/${language}/`)) {
              // Make sure the path has a file extension
              if (!basePath.includes('.')) {
                return `docs/i18n/${language}${basePath}/README.md`;
              }
              return `docs/i18n/${language}${basePath}`;
            }
            
            // Make sure the path has a file extension
            if (!basePath.includes('.')) {
              return `docs${basePath}/README.md`;
            }
            return `docs${basePath}`;
          }
          
          // If not in Electron, use the original method
          return originalGetLocalizedDocPath(basePath);
        };
        
        // Also patch the PipelineManager's method if it exists
        if (window.uiManager.pipelineManager) {
          window.uiManager.pipelineManager.getLocalizedDocPath = window.uiManager.getLocalizedDocPath.bind(window.uiManager);
        }
        
        clearInterval(waitForUIManager);
      }
    }, 100);
  }

  /**
   * Initialize event listeners for Electron menu actions
   */
  initEventListeners() {
    // Listen for export preset request from main process
    window.electronAPI.onExportPreset(() => {
      this.exportPreset();
    });

    // Listen for import preset request from main process
    window.electronAPI.onImportPreset(() => {
      this.importPreset();
    });
    
    // Listen for open preset file request from main process
    window.electronAPI.onOpenPresetFile((filePath) => {
      
      // Check if the app is already initialized (AudioWorklet is ready)
      if (window.app && window.app.audioManager && window.app.audioManager.workletNode) {
        // If the app is already initialized, load the preset file directly
        this.openPresetFile(filePath);
      } else {
        // If the app is not yet initialized, store the path for later use
        window.pendingPresetFilePath = filePath;
      }
    });
    
    // Listen for open music file request from main process
    window.electronAPI.onOpenMusicFile(() => {
      // Open music file menu item clicked
      this.openMusicFile();
    });

    // Listen for open music files request from main process (for command line arguments)
    window.electronAPI.onOpenMusicFiles((filePaths) => {
      if (filePaths && filePaths.length > 0) {
        // Debug logs removed for release
        
        // Check if the app is already initialized and not in first launch
        if (window.app && window.app.audioManager && window.app.audioManager.workletNode &&
            window.isFirstLaunch !== true) {
          // If the app is already initialized and not in first launch, create audio player directly
          
          // Create audio player with the music files
          // Use the existing audio preferences
          if (window.uiManager) {
            // Debug logs removed for release
            // Store the files in a global variable for debugging
            window._debugCommandLineMusicFiles = filePaths;
            void Promise.resolve(window.uiManager.createAudioPlayer(filePaths, false))
              .catch(error => {
                console.error('Failed to open command-line music files:', error);
                window.uiManager?.setError?.('error.musicSelectionUnavailable', true);
              });
          }
        } else {
          // If the app is not yet initialized or in first launch, store file paths for later use
          // Debug logs removed for release
          window.pendingMusicFiles = filePaths;
          // Store the files in a global variable for debugging
          window._debugPendingMusicFiles = filePaths;
          
          // Set useInputWithPlayer to false immediately, even during first launch
          // This ensures the same behavior as drag and drop
          if (window.electronIntegration && window.electronIntegration.audioPreferences) {
            // Debug logs removed for release
            window.electronIntegration.audioPreferences.useInputWithPlayer = false;
          }
          
          // Also set a flag to indicate that command line music files should not use input
          window._commandLineMusicFilesNoInput = true;
          
          // Debug logs removed for release
        }
      }
    });

    // Listen for process audio files request from main process
    window.electronAPI.onProcessAudioFiles(() => {
      // Process audio files menu item clicked
      this.processAudioFiles();
    });
    
    // Listen for save preset request from main process
    window.electronAPI.onSavePreset(() => {
      // Save preset menu item clicked
      this.exportPreset(); // Reuse export preset functionality
    });
    
    // Listen for save preset as request from main process
    window.electronAPI.onSavePresetAs(() => {
      // Save preset as menu item clicked
      this.exportPreset(); // Reuse export preset functionality
    });
    
    // Listen for config audio request from main process
    window.electronAPI.onConfigAudio(() => {
      // Config audio menu item clicked
      this.showAudioConfigDialog();
    });
    
    window.electronAPI.onConfigApp(() => {
      this.showConfigDialog();
    });

    window.electronAPI.onLoadUserPreset((name) => {
      if (window.pipelineManager && window.pipelineManager.presetManager) {
        if (window.app && window.app.audioManager && window.app.audioManager.workletNode) {
          window.pipelineManager.presetManager.loadPreset(name);
        } else {
          window.pendingPresetName = name;
        }
      }
    });
    
    // Listen for tray menu update request from main process
    window.electronAPI.onIPC('request-tray-menu-update', () => {
      // Update tray menu when requested (e.g., when manually minimizing to tray)
      this.updateTrayMenu();
    });
    
    // Listen for show about dialog request from main process
    window.electronAPI.onShowAboutDialog((data) => {
      // About menu item clicked
      this.showAboutDialog(data);
    });

    // Listen for Double Blind Test launch request from the application menu
    window.electronAPI.onIPC('start-double-blind-test', () => {
      if (window.uiManager && window.uiManager.getDoubleBlindTest) {
        void Promise.resolve(window.uiManager.getDoubleBlindTest())
          .then(doubleBlindTest => doubleBlindTest.enterFresh())
          .catch(error => console.error('Failed to open Double Blind Test:', error));
      }
    });

    // Electron event listeners initialized
  }
  
  /**
   * Open a preset file from the file system
   * @param {string} filePath - Path to the preset file
   */
  async openPresetFile(filePath) {
    const { openPresetFile } = await import('./electron/presetIntegration.js');
    return openPresetFile(this.isElectron, filePath);
  }

  /**
   * Load saved audio preferences
   */
  async loadAudioPreferences() {
    const preferences = await loadAudioPreferences(this.isElectron);
    if (preferences) {
      this.audioPreferences = preferences;
      // Make sure to set a global reference that can be accessed in AudioWorklet context
      window.audioPreferences = preferences;
    }
    return preferences;
  }

  /**
   * Save audio preferences
   * @param {Object} preferences - Audio device preferences
   */
  async saveAudioPreferences(preferences, options = {}) {
    const effectivePreferences = preferences
      ? mergeWebAudioPreferences(this.audioPreferences, preferences)
      : preferences;
    // Persist only the requested fields: the stored preferences are merged by
    // the store itself, so session-only mirror overrides are never written.
    const saved = await saveAudioPreferences(this.isElectron, preferences, options);
    if (!saved) return false;
    if (effectivePreferences) {
      this.audioPreferences = effectivePreferences;
      window.audioPreferences = effectivePreferences;
    }
    return true;
  }

  /**
   * Get available audio devices
   * @returns {Promise<Array>} List of audio devices
   */
  async getAudioDevices() {
    const { getAudioDevices } = await import('./electron/audioIntegration.js');
    return getAudioDevices(this.isElectron);
  }

  /**
   * Show audio configuration dialog
   * @param {Function} callback - Callback function to be called when devices are selected
   */
  async showAudioConfigDialog(callback) {
    const preferences = this.audioPreferences || await this.loadAudioPreferences();
    const { showAudioConfigDialog } = await import('./electron/audioIntegration.js');
    return showAudioConfigDialog(this.isElectron, preferences, callback);
  }

  /**
   * Export current preset to a file
   */
  async exportPreset() {
    const { exportPreset } = await import('./electron/presetIntegration.js');
    return exportPreset(this.isElectron);
  }

  /**
   * Import preset from a file
   */
  async importPreset() {
    const { importPreset } = await import('./electron/presetIntegration.js');
    return importPreset(this.isElectron);
  }

  /**
   * Open music file(s) for playback
   * This function is called when the user selects "Open music file..." from the File menu
   */
  async openMusicFile() {
    const { openMusicFile } = await import('./electron/presetIntegration.js');
    return openMusicFile(this.isElectron);
  }

  /**
   * Process audio files with current effects
   * This function is called when the user selects "Process Audio Files with Effects" from the File menu
   */
  processAudioFiles() {
    if (!this.isElectron) return;
    void import('./electron/presetIntegration.js')
      .then(module => module.processAudioFiles(true))
      .catch(error => {
        console.error('Failed to open offline audio processing:', error);
        window.uiManager?.setError?.('error.offlineOutput.invalidOutput', true);
      });
  }
  
  /**
   * Get MIME type for audio file based on extension
   * @param {string} fileName - File name with extension
   * @returns {string} MIME type
   */
  getAudioMimeType(fileName) {
    return getAudioMimeType(fileName);
  }

  /**
   * Show about dialog
   * @param {Object} data - Data for the about dialog
   * @param {string} data.version - App version
   * @param {string} data.icon - Path to app icon
   */
  async showAboutDialog(data) {
    if (!this.isElectron) return;
    
    try {
      // Check for available updates (always check in About dialog regardless of config)
      let updateLinkHTML = '';
      let availableUpdate = null;
      if (window.electronAPI) {
        try {
          // Force check for updates in About dialog
          await window.electronAPI.forceCheckForUpdates();
          
          // Get update info from main process
          const updateInfo = await window.electronAPI.getUpdateInfo();
          if (updateInfo && updateInfo.version) {
            availableUpdate = updateInfo;
            updateLinkHTML = '<div class="about-update-link" id="about-update-link"></div>';
          }
        } catch (error) {
          console.error('Failed to get update info:', error);
        }
      }
      
      // Create dialog HTML
      const dialogHTML = `
        <div class="about-dialog">
          <div class="about-header">
            <img src="images/icon_64x64.png" class="about-icon" alt="EffeTune Icon">
            <h2>Frieve EffeTune</h2>
          </div>
          <div class="about-content">
            <div class="about-version">Version ${data.version}</div>
            ${updateLinkHTML}
            <div class="about-description">Desktop Audio Effect Processor</div>
            <div class="about-copyright">Copyright © Frieve 2025, 2026</div>
          </div>
          <div class="dialog-buttons">
          <button id="close-button">Close</button>
          </div>
        </div>
      `;
      
      // Create dialog element
      const dialogElement = document.createElement('div');
      dialogElement.className = 'modal-overlay';
      dialogElement.innerHTML = dialogHTML;
      document.body.appendChild(dialogElement);

      if (availableUpdate) {
        const updateSlot = document.getElementById('about-update-link');
        const { createUpdateNotification } = await import('./update-notification.js');
        const updateSurface = createUpdateNotification(availableUpdate, {
          documentRef: document,
          windowRef: window
        });
        updateSlot?.appendChild(updateSurface);
      }
      
      // Add dialog styles
      const styleElement = document.createElement('style');
      styleElement.textContent = `
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.7);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }
        .about-dialog {
          background-color: #222;
          border-radius: 8px;
          padding: 20px;
          width: 400px;
          color: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .about-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 20px;
        }
        .about-icon {
          width: 64px;
          height: 64px;
          margin-bottom: 10px;
        }
        .about-header h2 {
          margin: 0;
          font-size: 24px;
        }
        .about-content {
          text-align: center;
          margin-bottom: 20px;
        }
        .about-version {
          font-size: 16px;
          margin-bottom: 10px;
        }
        .about-update-link {
          color: #4a9eff;
          text-decoration: none;
          font-size: 14px;
          margin-bottom: 10px;
          cursor: pointer;
          transition: color 0.2s ease;
        }
        .about-update-link:hover {
          color: #66b3ff;
        }
        .about-description {
          font-size: 14px;
          color: #ccc;
          margin-bottom: 5px;
        }
        .about-copyright {
          font-size: 12px;
          color: #999;
        }
        .dialog-buttons {
          display: flex;
          justify-content: center;
          margin-top: 20px;
        }
        .dialog-buttons button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          background-color: #007bff;
          color: #fff;
        }
        .dialog-buttons button:hover {
          background-color: #0069d9;
        }
      `;
      document.head.appendChild(styleElement);
      
      // Add event listener for close button
      const closeButton = document.getElementById('close-button');
      closeButton.addEventListener('click', () => {
        document.body.removeChild(dialogElement);
        document.head.removeChild(styleElement);
      });
      
    } catch (error) {
      console.error('Failed to show about dialog:', error);
    }
  }

  /**
   * Get application version from package.json
   * @returns {Promise<string>} Application version
   */
  async getAppVersion() {
    if (!this.isElectron) {
      // If not running in Electron, return empty string
      return '';
    }
    
    try {
      return await window.electronAPI.getAppVersion();
    } catch (error) {
      console.error('Failed to get app version:', error);
      return '';
    }
  }

  /**
   * Check if running in Electron environment
   * @returns {boolean} True if running in Electron
   */
  isElectronEnvironment() {
    // More robust detection of Electron environment
    const userAgent = navigator.userAgent.toLowerCase();
    const isElectronUA = userAgent.indexOf(' electron/') > -1;
    
    // Update isElectron property with more robust detection
    this.isElectron = window.electronAPI !== undefined || isElectronUA;
    // Update isElectron property
    
    return this.isElectron;
  }

  async loadConfig() {
    const cfg = await loadConfig(this.isElectron);
    this.config = cfg;
    window.appConfig = cfg;
    if (window.uiManager && typeof window.uiManager.syncLanguageWithConfig === 'function') {
      await window.uiManager.syncLanguageWithConfig(cfg);
    }
    return cfg;
  }

  async saveConfig(cfg) {
    if (this.isElectron) {
      const saved = await saveConfig(true, cfg);
      if (!saved) return false;
      this.config = window.appConfig;
      return true;
    }

    const saved = await saveConfig(false, cfg);
    if (!saved) return false;
    this.config = await loadConfig(false);
    window.appConfig = this.config;
    return true;
  }

  async showConfigDialog() {
    // Load the latest config before showing the dialog
    await this.loadConfig();
    const { showConfigDialog } = await import('./electron/configIntegration.js');
    return showConfigDialog(this.isElectron, this.config);
  }
}

// Export the ElectronIntegration class
export const electronIntegration = new ElectronIntegration();
