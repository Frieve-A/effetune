const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electronAPI', {
    // File system operations
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
    readFile: (filePath, binary = false) => ipcRenderer.invoke('read-file', filePath, binary),
    readFileAsBuffer: (filePath) => ipcRenderer.invoke('read-file-as-buffer', filePath),
    
    // Documentation operations
    openDocumentation: (path) => ipcRenderer.invoke('open-documentation', path),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
    openExternal: (url) => ipcRenderer.invoke('open-external-url', url),
    
    // Audio device operations
    getAudioDevices: () => ipcRenderer.invoke('get-audio-devices'),
    saveAudioPreferences: (preferences) => ipcRenderer.invoke('save-audio-preferences', preferences),
    loadAudioPreferences: () => ipcRenderer.invoke('load-audio-preferences'),
    // First launch flag for audio workaround - use IPC instead of window property
    isFirstLaunch: () => {
      // Return a Promise that resolves to a boolean
      return ipcRenderer.invoke('get-first-launch-flag')
        .then(result => {
          return Boolean(result);
        })
        .catch(error => {
          return false;
        });
    },
    
    // Listen for events from main process
    onExportPreset: (callback) => {
      ipcRenderer.on('export-preset', () => callback());
    },
    onImportPreset: (callback) => {
      ipcRenderer.on('import-preset', () => callback());
    },
    onOpenPresetFile: (callback) => {
      ipcRenderer.on('open-preset-file', (_, filePath) => callback(filePath));
    },
    onOpenMusicFile: (callback) => {
      ipcRenderer.on('open-music-file', () => callback());
    },
    onOpenMusicFiles: (callback) => {
      ipcRenderer.on('open-music-files', (_, filePaths) => callback(filePaths));
    },
    onLoadUserPreset: (callback) => {
      ipcRenderer.on('load-user-preset', (_, name) => callback(name));
    },
    onProcessAudioFiles: (callback) => {
      ipcRenderer.on('process-audio-files', () => callback());
    },
    onSavePreset: (callback) => {
      ipcRenderer.on('save-preset', () => callback());
    },
    onSavePresetAs: (callback) => {
      ipcRenderer.on('save-preset-as', () => callback());
    },
    onConfigAudio: (callback) => {
      ipcRenderer.on('config-audio', () => callback());
    },
    onConfigApp: (callback) => {
      ipcRenderer.on('config-app', () => callback());
    },
    onShowAboutDialog: (callback) => {
      ipcRenderer.on('show-about-dialog', (_, data) => callback(data));
    },
    
    // Get app version
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // Get command line preset file
    getCommandLinePresetFile: () => ipcRenderer.invoke('get-command-line-preset-file'),
    
    // Reload window
    reloadWindow: () => ipcRenderer.invoke('reload-window'),
    
    // Clear permission overrides for microphone
    clearMicrophonePermission: () => ipcRenderer.invoke('clear-microphone-permission'),
    
    // Update application menu with translations
    updateApplicationMenu: (menuTemplate) => ipcRenderer.invoke('update-application-menu', menuTemplate),
    
      // Update tray menu with translations
  updateTrayMenu: (trayMenuTemplate) => ipcRenderer.invoke('update-tray-menu', trayMenuTemplate),
  
  // Load preset from tray menu
  loadPresetFromTray: (presetName) => ipcRenderer.invoke('load-preset-from-tray', presetName),
  
  // Get user presets for tray menu
  getUserPresetsForTray: () => ipcRenderer.invoke('get-user-presets-for-tray'),
  
  // Listen for IPC events
  onIPC: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },
    
    // Hide application menu
    hideApplicationMenu: () => ipcRenderer.invoke('hide-application-menu'),
    
    // Restore default application menu
    restoreDefaultMenu: () => ipcRenderer.invoke('restore-default-menu'),
    
    // Navigate back to main page
    navigateToMain: () => ipcRenderer.invoke('navigate-to-main'),
    
    // Get current application menu template
    getApplicationMenu: () => ipcRenderer.invoke('get-application-menu'),
    
    // Get path
    getPath: (name) => ipcRenderer.invoke('getPath', name),
    
    // Join paths (platform-specific)
    joinPaths: (basePath, ...paths) => ipcRenderer.invoke('joinPaths', basePath, ...paths),
    
    // Check if file exists
    fileExists: (filePath) => ipcRenderer.invoke('fileExists', filePath),
    
    // Save pipeline state to file
    savePipelineStateToFile: (pipelineState) => ipcRenderer.invoke('save-pipeline-state-to-file', pipelineState),

    // Send pipeline state for close (synchronous send, no response needed)
    sendPipelineStateForClose: (pipelineState) => ipcRenderer.send('pipeline-state-for-close', pipelineState),

    // Listen for pipeline state request from main process (for window close)
    onRequestPipelineStateForClose: (callback) => {
      ipcRenderer.on('request-pipeline-state-for-close', () => callback());
    },
    
    // Load and save config
    loadConfig: () => ipcRenderer.invoke('load-config'),
    saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
    
    // Expose ipcRenderer for event listeners
    ipcRenderer: ipcRenderer,
    
    // Listen for audio files dropped event
    onAudioFilesDropped: (callback) => {
      ipcRenderer.on('audio-files-dropped', (event, filePaths) => callback(filePaths));
    },
    
    // Signal that the renderer is ready to receive music files
    signalReadyForMusicFiles: () => {
      ipcRenderer.send('renderer-ready-for-music-files');
    },
    
    // Signal that the renderer is ready to receive update notifications
    signalReadyForUpdates: () => {
      return ipcRenderer.invoke('renderer-ready-for-updates');
    },
    
    // Get update info
    getUpdateInfo: () => {
      return ipcRenderer.invoke('get-update-info');
    },
    
    // Force check for updates (used in About dialog)
    forceCheckForUpdates: () => {
      return ipcRenderer.invoke('force-check-for-updates');
    }
  }
);

// Add methods to get the real path of a file
contextBridge.exposeInMainWorld(
  'electronFileSystem', {
    // Get the real path of a file
    getRealPath: (file) => {
      try {
        // In Electron, we need to use IPC to get the file path
        // because nodeIntegration is false
        return ipcRenderer.invoke('get-file-path', {
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified
        });
      } catch (error) {
        console.error('Error getting real path:', error);
        return Promise.resolve(null);
      }
    },
    
    // Get real paths for multiple files
    getRealPaths: (files) => {
      try {
        // Use IPC to get file paths
        return ipcRenderer.invoke('get-file-paths', Array.from(files).map(file => ({
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified
        })));
      } catch (error) {
        console.error('Error getting real paths:', error);
        return Promise.resolve([]);
      }
    },
    
    // Handle dropped files
    handleDroppedFiles: (files) => {
      try {
        // Process dropped files in the main process
        
        // Get file paths directly
        const filePaths = Array.from(files).map(file => file.path).filter(Boolean);
        
        // If we have file paths, send them to main process
        if (filePaths.length > 0) {
          return ipcRenderer.invoke('handle-dropped-files-with-paths', filePaths);
        }
        
        // Fallback: send file info to main process
        return ipcRenderer.invoke('handle-dropped-files', Array.from(files).map(file => ({
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified
        })));
      } catch (error) {
        console.error('Error handling dropped files:', error);
        return Promise.resolve([]);
      }
    },
    
    // Handle dropped preset file
    handleDroppedPresetFile: (file) => {
      try {
        // Process dropped preset file in the main process
        
        // Send file info to main process to get path
        return ipcRenderer.invoke('handle-dropped-preset-file', {
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified
        });
      } catch (error) {
        console.error('Error handling dropped preset file:', error);
        return Promise.resolve(null);
      }
    }
  }
);

// Add a direct event listener for drag and drop events
// This is a diagnostic addition to help debug the drag and drop issues
document.addEventListener('DOMContentLoaded', () => {
  // Add global drag and drop event listeners
  document.addEventListener('dragover', (e) => {
    // Only log once per second to avoid flooding the console
    if (!window._lastDragOverLog || Date.now() - window._lastDragOverLog > 1000) {
      window._lastDragOverLog = Date.now();
    }
  }, false);
  
  document.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // Try to get file paths
      const filePaths = Array.from(e.dataTransfer.files).map(file => file.path).filter(Boolean);
      
      // Send to main process
      if (filePaths.length > 0) {
        ipcRenderer.send('files-dropped', filePaths);
      }
    }
  }, false);
});

// Note: We're not adding drag and drop event listeners here anymore
// to avoid conflicts with the existing drag and drop functionality
// The existing functionality is implemented in main.js
