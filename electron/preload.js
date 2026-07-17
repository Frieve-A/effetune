const { contextBridge, ipcRenderer, webUtils } = require('electron');

const libraryCatalogV1 = Object.freeze({
  apiVersion: 1,
  getCapabilities: () => ipcRenderer.invoke('library-catalog-v1:get-capabilities', {}),
  getCounts: (request = {}) => ipcRenderer.invoke('library-catalog-v1:get-counts', request),
  createContext: (request) => ipcRenderer.invoke('library-catalog-v1:create-context', request),
  getContextCount: (request) => ipcRenderer.invoke('library-catalog-v1:get-context-count', request),
  queryTracks: (request) => ipcRenderer.invoke('library-catalog-v1:query-tracks', request),
  queryEntities: (request) => ipcRenderer.invoke('library-catalog-v1:query-entities', request),
  readContextPageAtOrdinal: (request) => ipcRenderer.invoke('library-catalog-v1:read-context-page-at-ordinal', request),
  resolveEntityAnchor: (request) => ipcRenderer.invoke('library-catalog-v1:resolve-entity-anchor', request),
  releaseContext: (contextToken) => ipcRenderer.invoke('library-catalog-v1:release-context', { contextToken }),
  getTrack: (trackUid) => ipcRenderer.invoke('library-catalog-v1:get-track', { trackUid }),
  resolvePlaylistExportSource: (trackUid) => ipcRenderer.invoke(
    'library-catalog-v1:resolve-playlist-export-source',
    { trackUid }
  ),
  resolvePlaybackSource: (trackUid) => ipcRenderer.invoke('library-catalog-v1:resolve-playback-source', { trackUid }),
  showTrackInFolder: (trackUid) => ipcRenderer.invoke('library-catalog-v1:show-track-in-folder', { trackUid }),
  createPlaylist: (request) => ipcRenderer.invoke('library-catalog-v1:create-playlist', request),
  createPlaylistWithItems: (request) => ipcRenderer.invoke('library-catalog-v1:create-playlist-with-items', request),
  renamePlaylist: (request) => ipcRenderer.invoke('library-catalog-v1:rename-playlist', request),
  reorderPlaylistItem: (request) => ipcRenderer.invoke('library-catalog-v1:reorder-playlist-item', request),
  removePlaylistItem: (request) => ipcRenderer.invoke('library-catalog-v1:remove-playlist-item', request),
  duplicatePlaylist: (request) => ipcRenderer.invoke('library-catalog-v1:duplicate-playlist', request),
  queryPlaylistItems: (request) => ipcRenderer.invoke('library-catalog-v1:query-playlist-items', request),
  tombstonePlaylist: (request) => ipcRenderer.invoke('library-catalog-v1:tombstone-playlist', request),
  addFolder: (request = {}) => ipcRenderer.invoke('library-catalog-v1:add-folder', request),
  requestFolderAccess: (folderId) => ipcRenderer.invoke('library-catalog-v1:request-folder-access', { folderId }),
  scanFolders: (request) => ipcRenderer.invoke('library-catalog-v1:scan-folders', request),
  cancelScan: (scanId) => ipcRenderer.invoke('library-catalog-v1:cancel-scan', { scanId }),
  removeFolder: (folderId) => ipcRenderer.invoke('library-catalog-v1:remove-folder', { folderId }),
  requestArtwork: (request) => ipcRenderer.invoke('library-catalog-v1:request-artwork', request),
  pickPlaylistImport: () => ipcRenderer.invoke('library-catalog-v1:pick-playlist-import', {}),
  grantDroppedPlaylistImport: (file) => ipcRenderer.invoke(
    'library-catalog-v1:grant-dropped-playlist-import',
    { path: webUtils.getPathForFile(file) }
  ),
  onInvalidation: (callback) => addSingleArgIpcListener('library-catalog-v1:invalidation', callback),
  onScanEvent: (callback) => addSingleArgIpcListener('library-catalog-v1:scan-event', callback),
  onFolderRemovalEvent: (callback) => addSingleArgIpcListener(
    'library-catalog-v1:folder-removal-event',
    callback
  )
});

const libraryServiceV1 = Object.freeze({
  apiVersion: 1,
  start: (request) => ipcRenderer.invoke('library-service-v1:start', request),
  status: (operationId) => ipcRenderer.invoke('library-service-v1:status', { operationId }),
  cancel: (operationId) => ipcRenderer.invoke('library-service-v1:cancel', { operationId }),
  previewPlaylistImport: (request) => ipcRenderer.invoke('library-service-v1:preview-playlist-import', request),
  commitPlaylistImportPreview: (request) => ipcRenderer.invoke(
    'library-service-v1:commit-playlist-import-preview', request
  ),
  cancelPlaylistImportPreview: (request) => ipcRenderer.invoke(
    'library-service-v1:cancel-playlist-import-preview', request
  ),
  onEvent: (callback) => addSingleArgIpcListener('library-service-v1:event', callback)
});

const libraryPlaybackV1 = Object.freeze({
  apiVersion: 1,
  getProvisionalEntry: (operationId) => ipcRenderer.invoke('library-playback-v1:get-provisional-entry', { operationId }),
  readSequencePage: (request) => ipcRenderer.invoke('library-playback-v1:read-sequence-page', request),
  resolveSequenceEntrySource: (request) => ipcRenderer.invoke('library-playback-v1:resolve-sequence-entry-source', request)
});

const libraryRecoveryV1 = Object.freeze({
  apiVersion: 1,
  getState: () => ipcRenderer.invoke('library-recovery-v1:get-state', {}),
  resetCatalog: ({ confirmed = false } = {}) => ipcRenderer.invoke(
    'library-recovery-v1:reset-catalog',
    { confirmed: confirmed === true }
  ),
  onStateChange: callback => addSingleArgIpcListener('library-recovery-v1:state', callback)
});

const ALLOWED_IPC_LISTENER_CHANNELS = new Set([
  'add-music-folder',
  'load-preset-from-tray',
  'open-effect-pipeline-view',
  'open-library-view',
  'request-tray-menu-update',
  'rescan-library',
  'start-double-blind-test',
  'update-available'
]);

function addIpcListener(channel, callback, mapArgs = args => args) {
  if (typeof callback !== 'function') {
    throw new TypeError('IPC listener callback must be a function');
  }

  const listener = (event, ...args) => {
    callback(...mapArgs(args));
  };
  ipcRenderer.on(channel, listener);

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    ipcRenderer.removeListener(channel, listener);
  };
}

function addNoArgIpcListener(channel, callback) {
  return addIpcListener(channel, callback, () => []);
}

function addSingleArgIpcListener(channel, callback) {
  return addIpcListener(channel, callback, args => [args[0]]);
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electronAPI', {
    // Platform identifier ('darwin' | 'win32' | 'linux'). Synchronous so the
    // renderer can branch on it without an async round-trip.
    platform: process.platform,

    // File system operations
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    openPlaybackSelection: () => ipcRenderer.invoke('open-playback-selection'),
    saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    readFileBytes: (filePath, expectedByteLength) => {
      if (expectedByteLength === undefined) {
        return ipcRenderer.invoke('read-file-bytes', filePath);
      }
      if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 0) {
        const error = new TypeError('Expected file size must be a nonnegative safe integer');
        error.code = 'ERR_INVALID_EXPECTED_BYTE_LENGTH';
        throw error;
      }
      return ipcRenderer.invoke('read-file-bytes', filePath, expectedByteLength);
    },
    beginAtomicFileWrite: (filePath) => ipcRenderer.invoke('begin-atomic-file-write', filePath),
    writeAtomicFileChunk: (token, chunk) => ipcRenderer.invoke('write-atomic-file-chunk', token, chunk),
    commitAtomicFileWrite: (token) => ipcRenderer.invoke('commit-atomic-file-write', token),
    abortAtomicFileWrite: (token) => ipcRenderer.invoke('abort-atomic-file-write', token),
    readClipboardText: () => ipcRenderer.invoke('read-clipboard-text'),
    writeClipboardText: (text) => ipcRenderer.invoke('write-clipboard-text', text),

    // Versioned, bounded music catalog API. Filesystem grants remain brokered by the main process.
    libraryCatalogV1,

    // Catalog startup and recovery remain available even when the catalog utility cannot open.
    libraryRecoveryV1,

    // Durable bulk operations expose only the four service verbs and bounded events.
    libraryServiceV1,

    // Bounded disk-backed playback sequence access is separate from the four durable service verbs.
    libraryPlaybackV1,
    
    // Documentation operations
    openDocumentation: (path) => ipcRenderer.invoke('open-documentation', path),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
    openExternal: (url) => ipcRenderer.invoke('open-external-url', url),
    
    // Audio device operations
    getAudioDevices: () => ipcRenderer.invoke('get-audio-devices'),
    saveAudioPreferences: (preferences, options) => options === undefined
      ? ipcRenderer.invoke('save-audio-preferences', preferences)
      : ipcRenderer.invoke('save-audio-preferences', preferences, options),
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
      return addNoArgIpcListener('export-preset', callback);
    },
    onImportPreset: (callback) => {
      return addNoArgIpcListener('import-preset', callback);
    },
    onOpenPresetFile: (callback) => {
      return addSingleArgIpcListener('open-preset-file', callback);
    },
    onOpenMusicFile: (callback) => {
      return addNoArgIpcListener('open-music-file', callback);
    },
    onOpenMusicFiles: (callback) => {
      return addSingleArgIpcListener('open-music-files', callback);
    },
    onLoadUserPreset: (callback) => {
      return addSingleArgIpcListener('load-user-preset', callback);
    },
    onProcessAudioFiles: (callback) => {
      return addNoArgIpcListener('process-audio-files', callback);
    },
    onSavePreset: (callback) => {
      return addNoArgIpcListener('save-preset', callback);
    },
    onSavePresetAs: (callback) => {
      return addNoArgIpcListener('save-preset-as', callback);
    },
    onConfigAudio: (callback) => {
      return addNoArgIpcListener('config-audio', callback);
    },
    onConfigApp: (callback) => {
      return addNoArgIpcListener('config-app', callback);
    },
    onShowAboutDialog: (callback) => {
      return addSingleArgIpcListener('show-about-dialog', callback);
    },
    
    // Get app version
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),

    // Get command line preset file
    getCommandLinePresetFile: () => ipcRenderer.invoke('get-command-line-preset-file'),
    
    // Reload window
    reloadWindow: () => ipcRenderer.invoke('reload-window'),

    // Full app relaunch (kills renderer process — used for HDMI reconnect recovery)
    relaunchApp: () => ipcRenderer.invoke('relaunch-app'),

    // Renderer ping for the main-process watchdog (fire-and-forget).  Sent every
    // 2 s; if main does not see a ping for 15 s it forcibly relaunches the app.
    rendererPing: () => ipcRenderer.send('renderer-ping'),
    armRendererWatchdog: (reason) => ipcRenderer.invoke('renderer-watchdog-arm', reason),
    disarmRendererWatchdog: (reason) => ipcRenderer.invoke('renderer-watchdog-disarm', reason),

    // Request macOS microphone TCC permission (must be called before getUserMedia)
    requestMicrophoneAccess: () => ipcRenderer.invoke('request-microphone-access'),

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
  
  onRequestTrayMenuUpdate: (callback) => addNoArgIpcListener('request-tray-menu-update', callback),
  onStartDoubleBlindTest: (callback) => addNoArgIpcListener('start-double-blind-test', callback),
  onOpenEffectPipelineView: (callback) => addNoArgIpcListener('open-effect-pipeline-view', callback),
  onOpenLibraryView: (callback) => addNoArgIpcListener('open-library-view', callback),
  onAddMusicFolder: (callback) => addNoArgIpcListener('add-music-folder', callback),
  onRescanLibrary: (callback) => addNoArgIpcListener('rescan-library', callback),
  onUpdateAvailable: (callback) => addSingleArgIpcListener('update-available', callback),
  onLoadPresetFromTray: (callback) => addSingleArgIpcListener('load-preset-from-tray', callback),

  // Compatibility wrapper for existing renderer call sites. Only the channels
  // above may be subscribed from the renderer.
  onIPC: (channel, callback) => {
    if (!ALLOWED_IPC_LISTENER_CHANNELS.has(channel)) {
      throw new Error(`IPC listener channel is not allowed: ${channel}`);
    }
    return addIpcListener(channel, callback);
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
      return addNoArgIpcListener('request-pipeline-state-for-close', callback);
    },
    
    // Load and save config
    loadConfig: () => ipcRenderer.invoke('load-config'),
    saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
    
    // Listen for audio files dropped event
    onAudioFilesDropped: (callback) => {
      return addSingleArgIpcListener('audio-files-dropped', callback);
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
