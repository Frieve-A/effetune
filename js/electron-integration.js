/**
 * Electron integration module for EffeTune
 * Provides desktop-specific functionality when running in Electron
 */

// Import modules
import { updateApplicationMenu, updateTrayMenu } from './electron/menuIntegration.js';
import { 
  loadAudioPreferences, 
  saveAudioPreferences, 
  getAudioDevices, 
  showAudioConfigDialog 
} from './electron/audioIntegration.js';
import { 
  openPresetFile, 
  exportPreset, 
  importPreset, 
  openMusicFile, 
  processAudioFiles, 
  getAudioMimeType 
} from './electron/presetIntegration.js';
import {
  loadConfig,
  saveConfig,
  showConfigDialog
} from './electron/configIntegration.js';

class ElectronIntegration {
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
      this.loadAudioPreferences();
      this.loadConfig();
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
    return updateApplicationMenu(this.isElectron);
  }

  /**
   * Update the tray menu with translated labels
   */
  updateTrayMenu() {
    return updateTrayMenu(this.isElectron);
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
              if (language) {
                return `docs/i18n/${language}/README.md`;
              }
              return 'README.md';
            }
            
            // Handle plugin documentation
            if (basePath.startsWith('/plugins/')) {
              const language = window.uiManager.userLanguage;
              // Remove .html extension and any hash
              let cleanPath = basePath.replace('.html', '').split('#')[0];
              // Store the anchor if present
              const anchor = basePath.includes('#') ? basePath.split('#')[1] : '';
              
              if (language) {
                return `docs/i18n/${language}${cleanPath}.md${anchor ? '#' + anchor : ''}`;
              }
              return `docs${cleanPath}.md${anchor ? '#' + anchor : ''}`;
            }
            
            // Handle index.html or empty path
            if (basePath === '/index.html' || basePath === './') {
              const language = window.uiManager.userLanguage;
              if (language) {
                return `docs/i18n/${language}/README.md`;
              }
              return 'README.md';
            }
            
            // For other paths, just convert to local path
            const language = window.uiManager.userLanguage;
            if (language && !basePath.includes(`/i18n/${language}/`)) {
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
            window.uiManager.createAudioPlayer(filePaths, false);
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
    
    // Electron event listeners initialized
  }
  
  /**
   * Open a preset file from the file system
   * @param {string} filePath - Path to the preset file
   */
  async openPresetFile(filePath) {
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
  async saveAudioPreferences(preferences) {
    // Update global audio preferences reference
    if (preferences) {
      this.audioPreferences = preferences;
      // Make sure to update the global reference for AudioWorklet context
      window.audioPreferences = preferences;
    }
    return saveAudioPreferences(this.isElectron, preferences);
  }

  /**
   * Get available audio devices
   * @returns {Promise<Array>} List of audio devices
   */
  async getAudioDevices() {
    return getAudioDevices(this.isElectron);
  }

  /**
   * Show audio configuration dialog
   * @param {Function} callback - Callback function to be called when devices are selected
   */
  async showAudioConfigDialog(callback) {
    return showAudioConfigDialog(this.isElectron, this.audioPreferences, callback);
  }

  /**
   * Export current preset to a file
   */
  async exportPreset() {
    return exportPreset(this.isElectron);
  }

  /**
   * Import preset from a file
   */
  async importPreset() {
    return importPreset(this.isElectron);
  }

  /**
   * Open music file(s) for playback
   * This function is called when the user selects "Open music file..." from the File menu
   */
  async openMusicFile() {
    return openMusicFile(this.isElectron);
  }

  /**
   * Process audio files with current effects
   * This function is called when the user selects "Process Audio Files with Effects" from the File menu
   */
  processAudioFiles() {
    return processAudioFiles(this.isElectron);
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
      if (window.electronAPI) {
        try {
          // Force check for updates in About dialog
          await window.electronAPI.forceCheckForUpdates();
          
          // Get update info from main process
          const updateInfo = await window.electronAPI.getUpdateInfo();
          if (updateInfo && updateInfo.version) {
            const updateText = window.uiManager && window.uiManager.t ? 
                window.uiManager.t('ui.newVersionAvailable', { version: updateInfo.version }) : 
                `New ${updateInfo.version} available.`;
            updateLinkHTML = `
              <div class="about-update-link" id="about-update-link">
                ${updateText}
              </div>
            `;
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
            <div class="about-copyright">Copyright © Frieve 2025-2026</div>
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
      
      // Add event listener for update link if it exists
      const updateLink = document.getElementById('about-update-link');
      if (updateLink) {
        updateLink.addEventListener('click', () => {
          if (window.electronAPI && window.electronAPI.openExternal) {
            window.electronAPI.openExternal('https://github.com/Frieve-A/effetune/releases/');
          } else {
            window.open('https://github.com/Frieve-A/effetune/releases/', '_blank');
          }
        });
      }
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
    return cfg;
  }

  async saveConfig(cfg) {
    this.config = { ...this.config, ...cfg };
    await saveConfig(this.isElectron, this.config);
  }

  async showConfigDialog() {
    // Load the latest config before showing the dialog
    await this.loadConfig();
    return showConfigDialog(this.isElectron, this.config);
  }
}

// Export the ElectronIntegration class
export const electronIntegration = new ElectronIntegration();