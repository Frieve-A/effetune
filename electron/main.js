const { app, BrowserWindow, screen, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Import modules
const constants = require('./constants');
const configModule = require('./config');
const windowState = require('./window-state');
const ipcHandlers = require('./ipc-handlers');
const fileHandlers = require('./file-handlers');

// Get app version from package.json
const packageJson = require('../package.json');
const appVersion = packageJson.version;
constants.setAppVersion(appVersion);

let tray = null;

// Set up logging to file for debugging (disabled for release)
function setupFileLogging() {
  // Disabled for release
}

// Create the main application window
function createWindow() {
  // Load saved window state
  windowState.loadWindowState();
  
  // Get current display scaling factor
  const primaryDisplay = screen.getPrimaryDisplay();
  const currentScaleFactor = primaryDisplay.scaleFactor || 1.0;
  
  // Get the window state
  const state = constants.getWindowState();
  
  // Adjust window size if the display scale factor has changed
  let adjustedWidth = state.width;
  let adjustedHeight = state.height;

  if (state.scaleFactor) {
    const factor = currentScaleFactor / state.scaleFactor;
    adjustedWidth = Math.round(state.width * factor);
    adjustedHeight = Math.round(state.height * factor);
  }
  
  // Create the browser window
  const mainWindow = new BrowserWindow({
    width: adjustedWidth,
    height: adjustedHeight,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, '../images/favicon.ico'),
    acceptFirstMouse: true, // Accept mouse events on window activation
    show: false, // Don't show the window until it's ready
    webPreferences: {
      nodeIntegration: false, // Security: Keep Node.js integration disabled
      contextIsolation: true, // Security: Enable context isolation
      preload: path.join(__dirname, 'preload.js'), // Use a preload script for safe IPC
      // Note: The following settings are for development only and should be removed for production
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Disable Electron's built-in zoom functionality
      zoomFactor: 1.0
    }
  });
  
  // Set the main window reference in modules
  constants.setMainWindow(mainWindow);
  ipcHandlers.setMainWindow(mainWindow);
  fileHandlers.setMainWindow(mainWindow);
  
  // Enable file drag and drop for the window
  mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
    // Download event handler
  });
  
  // Enable file drag and drop explicitly
  mainWindow.webContents.on('did-finish-load', () => {
    // Execute JavaScript to enable file drag and drop
    mainWindow.webContents.executeJavaScript(`
      // =====================================================================
      // DRAG AND DROP IMPLEMENTATION FOR ELECTRON
      // =====================================================================
      // This implementation handles two types of files:
      // 1. Music files (.mp3, .wav, etc.) - Played in the audio player
      // 2. Preset files (.effetune_preset) - Loaded into the effect pipeline
      //
      // IMPORTANT SECURITY NOTES:
      // - In Electron's security model, renderer processes cannot directly access file paths
      // - We must process File objects directly in the renderer using FileReader
      // - Do NOT try to use file.path as it will be undefined in the renderer process
      // =====================================================================
      
      // Override default drag and drop behavior
      // Only prevent default for file drags, allow UI element drags
      document.addEventListener('dragover', (e) => {
        // Check if this is a file drag
        if (e.dataTransfer && e.dataTransfer.items && Array.from(e.dataTransfer.items).some(item => item.kind === 'file')) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          
          // Check for preset files or music files
          const items = Array.from(e.dataTransfer.items);
          
          // Check for preset files
          const hasPresetFiles = items.some(item =>
            item.kind === 'file' &&
            (item.type === '' || item.type === 'application/octet-stream')
          );
          
          // Check for music files
          const hasMusicFiles = items.some(item => {
            if (item.kind === 'file') {
              const file = item.getAsFile();
              if (!file) return false;
              
              // Check for audio file types
              if (file.type.startsWith('audio/') ||
                  /\\.(mp3|wav|ogg|flac|m4a|aac|aiff|wma|alac)$/i.test(file.name)) {
                return true;
              }
            }
            return false;
          });
          // IMPORTANT: Always add visual feedback for any file drag
          // This is critical for UX - users need immediate visual feedback when dragging files
          // The drag-over class must be applied regardless of file type (music or preset)
          document.body.classList.add('drag-over');
          
          // Force a reflow to ensure the style is applied
          void document.body.offsetHeight;
          
          
          return false;
        }
      }, true); // Use capture phase
      
      // Handle dragleave for file drags
      document.addEventListener('dragleave', (e) => {
        // Only handle if we're leaving the document and it's a file drag
        if ((!e.relatedTarget || e.relatedTarget === document.documentElement) &&
            document.body.classList.contains('drag-over')) {
          document.body.classList.remove('drag-over');
        }
      }, true); // Use capture phase
      
      // Only prevent default for file drops, allow UI element drops and specific drop areas
      document.addEventListener('drop', (e) => {
        // Check if this is a file drop
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          // Check if the target is the file-drop-area or a child of it
          const fileDropArea = e.target.closest('.file-drop-area');
          if (fileDropArea) {
            // Allow the drop event to propagate to the file-drop-area handler
            document.body.classList.remove('drag-over');
            return;
          }
          
          // For other areas, prevent default behavior
          e.preventDefault();
          e.stopPropagation();
          document.body.classList.remove('drag-over');
          
          // Check for preset files
          const presetFiles = Array.from(e.dataTransfer.files).filter(file =>
            file.name.toLowerCase().endsWith('.effetune_preset')
          );
          
          // Check for music files
          const musicFiles = Array.from(e.dataTransfer.files).filter(file =>
            file.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac|aiff|wma|alac)$/i.test(file.name)
          );
          
          // Process files directly in the renderer
          if (e.dataTransfer.files.length > 0) {
            try {
              // Process preset files
              if (presetFiles.length > 0) {
                const presetFile = presetFiles[0];
                
                // IMPORTANT: Read the preset file content directly in the renderer
                // In Electron, we can't access file paths from the renderer process
                // Instead, we must read the file content directly using FileReader
                // REGRESSION PREVENTION: Do not try to use file.path or URL.createObjectURL here
                const reader = new FileReader();
                reader.onload = (event) => {
                  try {
                    const fileData = event.target.result;
                    const presetData = JSON.parse(fileData);
                    
                    // Load the preset using the UI manager
                    if (window.uiManager) {
                      window.uiManager.loadPreset(presetData);
                    }
                  } catch (error) {
                    console.error('Failed to parse preset file:', error);
                  }
                };
                reader.readAsText(presetFile);
              }
              // Process music files
              else if (musicFiles.length > 0) {
                // IMPORTANT: Pass the File objects directly to the audio player
                // Don't try to create object URLs or access file paths
                // The audio player is designed to handle File objects directly
                // REGRESSION PREVENTION: Previously we tried to use URL.createObjectURL which
                // caused "NotSupportedError: Failed to load because no supported source was found"
                if (window.uiManager) {
                  // The createAudioPlayer method can handle File objects directly
                  // Store the files in a global variable for debugging
                  window._debugDroppedMusicFiles = musicFiles;
                  window.uiManager.createAudioPlayer(musicFiles, false);
                }
              }
            } catch (err) {
              console.error('Error processing files:', err);
            }
          }
          
          return false;
        }
      }, true); // Use capture phase
      
      // Add CSS for drag-over effect if it doesn't exist
      if (!document.getElementById('drag-drop-style')) {
        const style = document.createElement('style');
        style.id = 'drag-drop-style';
        style.textContent = \`
          body.drag-over {
            position: relative;
          }
          
          body.drag-over::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 120, 255, 0.2);
            border: 2px dashed rgba(0, 120, 255, 0.5);
            pointer-events: none;
            z-index: 9999;
          }
        \`;
        document.head.appendChild(style);
      }
      
    `).catch(err => {
      console.error('Failed to initialize drag and drop handlers:', err.message || String(err));
    });
  });
  
  // Register keyboard shortcuts
  const { globalShortcut } = require('electron');
  
  // Register Ctrl+Shift+I to toggle DevTools
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    }
  });
  
  // F1 key is now handled in the renderer process (js/app.js)
  // This allows the same behavior in both web and Electron environments

  // When the window is ready to show
  mainWindow.once('ready-to-show', () => {
    // Restore maximized state if needed
    if (constants.getWindowState().isMaximized) {
      mainWindow.maximize();
    }
    if (constants.getAppConfig().startMinimized) {
      if (constants.getAppConfig().minimizeToTray) {
        mainWindow.hide();
        createTray();
      } else {
        // For minimize to taskbar: show and minimize immediately
        mainWindow.minimize();
      }
    } else {
      mainWindow.show();
    }
  });
  
  // Load the app's HTML file
  mainWindow.loadFile('effetune.html');

  // Combined event handler for page load
  mainWindow.webContents.on('did-finish-load', () => {
     
    // 1. Disable Electron's built-in zoom functionality
    mainWindow.webContents.setZoomFactor(1.0);
    
    // If this is a splash reload, restore the saved command line preset file path
    if (constants.getIsSplashReload() && constants.getSavedCommandLinePresetFile()) {
      constants.setCommandLinePresetFile(constants.getSavedCommandLinePresetFile());
      constants.setSavedCommandLinePresetFile(null);
    }
    
    // If this is a splash reload, process command line arguments
    if (constants.getIsSplashReload()) {
      fileHandlers.processCommandLineArgs(constants.getSavedCommandLineMusicFiles());
      constants.clearSavedCommandLineMusicFiles();
    }
    
    // 2. Set initial zoom level to 1.0 (100%) on every page load and set critical flags
    mainWindow.webContents.executeJavaScript(`
      // Ensure zoom is always reset to 100% on page load
      document.body.style.zoom = 1.0;
      
      // Set initial zoom value (will be stored in settings file for portable mode)
      window.initialZoom = 1.0;
      
      // Set first launch flag for audio workaround
      window.isFirstLaunch = ${constants.getIsFirstLaunch()};
      
      // Get user data path to check if we're in portable mode
      const userDataPath = '${fileHandlers.getUserDataPath()}';
      const standardUserDataPath = '${app.getPath('userData')}';
      const isPortableMode = userDataPath !== standardUserDataPath;
      
      // Set pipeline state loaded flag based on commandLinePresetFile and portable mode
      // If commandLinePresetFile is set, don't load previous pipeline state
      // For portable mode, we always want to load the pipeline state unless a command line preset is specified
      window.pipelineStateLoaded = ${constants.getCommandLinePresetFile() ? false : constants.getShouldLoadPipelineState()};
      
      // Store this in a global constant that can't be changed
      window.ORIGINAL_PIPELINE_STATE_LOADED = window.pipelineStateLoaded;
      
      // Instead of using Object.defineProperty which causes IPC cloning issues,
      // we'll use a simple variable to track if changes should be allowed
      window._allowPipelineStateChanges = false;
    `).catch(err => {
      console.error('Error setting initial zoom and flags:', err.message || String(err));
    });

    // 3. Enable wheel-based zooming by injecting JavaScript
    mainWindow.webContents.executeJavaScript(`
      // Add event listener for wheel events with Ctrl key
      document.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
          // Use an IIFE to create a local scope for variables
          (function() {
            // Prevent the default browser zoom behavior
            e.preventDefault();
            
            // Get the current zoom level from the body's style or default to 1
            const zoom = parseFloat(document.body.style.zoom || '1');
            
            // Calculate new zoom level (zoom in or out based on wheel direction)
            let newZoom = zoom;
            if (e.deltaY < 0) {
              // Zoom in
              newZoom = Math.min(zoom + 0.1, 3.0); // Max zoom: 300%
            } else {
              // Zoom out
              newZoom = Math.max(zoom - 0.1, 0.3); // Min zoom: 30%
            }
            
            // Apply the new zoom level to the body
            document.body.style.zoom = newZoom;
          })();
        }
      });
    `).catch(err => {
      console.error('Error setting up wheel zoom:', err.message || String(err));
    });
    
    // 4. Handle file to open if specified via command line
    if (constants.getCommandLinePresetFile()) {
      // Set pipelineStateLoaded to false immediately to prevent loading previous state
      mainWindow.webContents.executeJavaScript(`
        window.pipelineStateLoaded = false;
      `).catch(err => {
        console.error('Error setting pipelineStateLoaded flag:', err.message || String(err));
      });
      
      // Process files immediately after page load
      // Set a minimal timeout to ensure the app is ready to receive events
      setTimeout(() => {
        if (constants.getCommandLinePresetFile()) {
          // Double-check that pipelineStateLoaded is still false
          mainWindow.webContents.executeJavaScript(`
            if (window.pipelineStateLoaded !== false) {
              window.pipelineStateLoaded = false;
            }
          `).catch(err => {
            console.error('Error checking pipelineStateLoaded flag:', err.message || String(err));
          });
          
          // Send the file path to the renderer process
          mainWindow.webContents.send('open-preset-file', constants.getCommandLinePresetFile());
          // Always reset commandLinePresetFile after use to prevent it from being loaded again on manual reload
          constants.setCommandLinePresetFile(null);
          constants.setSavedCommandLinePresetFile(null);
        }
        
        // Store music files for later sending when renderer is ready
        // Don't send them immediately to ensure pipeline is built first
        if (constants.getCommandLineMusicFiles().length > 0) {
          // Debug logs removed for release
          
          // Store the music files for later use
          constants.setPendingCommandLineMusicFiles([...constants.getCommandLineMusicFiles()]);
          
          // Reset command line music files after storing
          constants.clearCommandLineMusicFiles();
          constants.clearSavedCommandLineMusicFiles();
          
          // Debug logs removed for release
        }
        
        // Reset the splash reload flag if it was set
        if (constants.getIsSplashReload()) {
          constants.setIsSplashReload(false);
        }

        if (constants.getStartupPreset()) {
          mainWindow.webContents.send('load-user-preset', constants.getStartupPreset());
          constants.setStartupPreset(null);
        }
      }, 300);
    } else if (constants.getCommandLineMusicFiles().length > 0) {
      // If there's no preset file but there are music files, store them for later
      // Debug logs removed for release
      
      // Store the music files for later use
      constants.setPendingCommandLineMusicFiles([...constants.getCommandLineMusicFiles()]);
      
      // Reset command line music files after storing
      constants.clearCommandLineMusicFiles();
      constants.clearSavedCommandLineMusicFiles();
      
      // Reset the splash reload flag if it was set
      if (constants.getIsSplashReload()) {
        constants.setIsSplashReload(false);
      }
    } else if (constants.getIsSplashReload()) {
      // If there's no file to open but this is a splash screen reload, reset the flag
      // Make sure we set pipelineStateLoaded to the correct value based on shouldLoadPipelineState
      mainWindow.webContents.executeJavaScript(`
        window.pipelineStateLoaded = ${constants.getShouldLoadPipelineState()};
      `).catch(err => {
        console.error('Error setting pipelineStateLoaded flag:', err.message || String(err));
      });
      constants.setIsSplashReload(false);
    }
  });

  // Enable file drop events
  mainWindow.webContents.on('will-navigate', (e) => {
    e.preventDefault();
  });
  
  // Enable file drag and drop
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Prevent opening new windows
    return { action: 'deny' };
  });

  // Set up the application menu
  ipcHandlers.createMenu();
  
  // Note: File opening from command line is now handled in the combined did-finish-load event handler

  // Open DevTools in development mode
  // if (process.env.NODE_ENV === 'development') {
  //   mainWindow.webContents.openDevTools();
  // }

  // Save window state when window is moved or resized
  mainWindow.on('resize', () => windowState.saveWindowState());
  mainWindow.on('move', () => windowState.saveWindowState());
  
  mainWindow.on('minimize', (e) => {
    if (constants.getAppConfig().minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
      createTray();
      // Request tray menu update from renderer process
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('request-tray-menu-update');
      }
    }
  });

  mainWindow.on('restore', () => {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });
  
  // Flag to track if we're in the process of closing
  let isClosing = false;

  // Set up the trigger close function for IPC handler to use
  constants.setTriggerClose(() => {
    isClosing = true;
    mainWindow.close();
  });

  // Handle window close event
  mainWindow.on('close', (event) => {
    // If already closing (after pipeline save), allow the close
    if (isClosing) {
      windowState.saveWindowState();
      globalShortcut.unregisterAll();
      return;
    }

    // Prevent the window from closing immediately
    event.preventDefault();

    // Request the renderer process to send pipeline state
    if (mainWindow && mainWindow.webContents) {
      // Set a timeout to ensure the app closes even if renderer doesn't respond
      const closeTimeout = setTimeout(() => {
        console.log('Pipeline state save timeout, closing window');
        isClosing = true;
        mainWindow.close();
      }, 3000);

      // Store the timeout ID so we can clear it when we receive the state
      constants.setCloseTimeout(closeTimeout);

      // Request pipeline state from renderer
      mainWindow.webContents.send('request-pipeline-state-for-close');
    } else {
      // No renderer available, just close
      isClosing = true;
      mainWindow.close();
    }
  });
  
  mainWindow.on('closed', () => {
    constants.setMainWindow(null);
  });
}

// Initialize variables in constants module
function initGlobalVariables() {
  // Flag to track if this is the first launch (for audio workaround)
  constants.setIsFirstLaunch(true);
  
  // Flag to track if the current reload is from the splash screen
  constants.setIsSplashReload(false);
  
  // Flag to track if pipeline state should be loaded
  // Set to true by default, will be set to false if command line preset file is provided
  constants.setShouldLoadPipelineState(true);
  
  // Store command line preset file path
  constants.setCommandLinePresetFile(null);
  
  // Store command line preset file path for splash reload
  // This ensures the value is preserved across the splash screen reload
  constants.setSavedCommandLinePresetFile(null);
  
  // Store command line music files
  constants.setCommandLineMusicFiles([]);
  
  // Store command line music files for splash reload
  constants.setSavedCommandLineMusicFiles([]);
  
  // Store app version - already set in the imports section
}

// Store update info for later sending
let pendingUpdateInfo = null;

// Function to get pending update info (for IPC handlers)
function getPendingUpdateInfo() {
  return pendingUpdateInfo;
}

// Check for updates from GitHub
async function checkForUpdates() {
  try {
    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/frieve-a/effetune/releases/latest',
        method: 'GET',
        headers: {
          'User-Agent': 'EffeTune-Update-Checker/1.0',
          'Accept': 'application/vnd.github.v3+json'
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', (err) => {
        reject(err);
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.end();
    });
    
    // Extract version from the "name" field (e.g., "Version 1.60.0")
    const latestVersionName = response.name;
    const currentVersion = constants.getAppVersion();
    
    // Compare versions
    if (latestVersionName && latestVersionName !== `Version ${currentVersion}`) {
      // Store update info for later sending
      pendingUpdateInfo = {
        version: latestVersionName,
        url: 'https://github.com/Frieve-A/effetune/releases/'
      };
      
      // Try to send immediately if window is ready
      const mainWindow = constants.getMainWindow();
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('update-available', pendingUpdateInfo);
      }
    }
  } catch (error) {
    console.error('Failed to check for updates:', error);
  }
}

// Send pending update info when renderer is ready
function sendPendingUpdateInfo() {
  if (pendingUpdateInfo) {
    const mainWindow = constants.getMainWindow();
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('update-available', pendingUpdateInfo);
    }
  }
}

// Create splash screen
function createSplashScreen() {
  // Create splash window with About dialog content
  let splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    parent: constants.getMainWindow(),
    modal: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  // Create HTML content for splash window
  const splashContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>EffeTune</title>
    <style>
      body {
        background-color: rgba(34, 34, 34, 0.9);
        color: #fff;
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        border-radius: 8px;
        overflow: hidden;
      }
      .splash-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 20px;
        width: 100%;
      }
      .splash-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-bottom: 20px;
      }
      .splash-icon {
        width: 64px;
        height: 64px;
        margin-bottom: 10px;
      }
      .splash-header h2 {
        margin: 0;
        font-size: 24px;
      }
      .splash-content {
        text-align: center;
        margin-bottom: 20px;
      }
      .splash-version {
        font-size: 16px;
        margin-bottom: 10px;
      }
      .splash-description {
        font-size: 14px;
        color: #ccc;
        margin-bottom: 5px;
      }
      .splash-copyright {
        font-size: 12px;
        color: #999;
      }
      .splash-loading {
        margin-top: 15px;
        font-size: 12px;
        color: #999;
      }
    </style>
  </head>
  <body>
    <div class="splash-container">
      <div class="splash-header">
        <img src="${path.join(__dirname, '../images/icon_64x64.png')}" class="splash-icon" alt="EffeTune Icon">
        <h2>Frieve EffeTune</h2>
      </div>
      <div class="splash-content">
        <div class="splash-version">Version ${constants.getAppVersion()}</div>
        <div class="splash-description">Desktop Audio Effect Processor</div>
        <div class="splash-copyright">Copyright © Frieve 2025-2026</div>
        <div class="splash-loading">Starting application...</div>
      </div>
    </div>
  </body>
  </html>
  `;
  
  // Write splash content to a temporary file
  const splashPath = path.join(app.getPath('temp'), 'effetune-splash.html');
  fs.writeFileSync(splashPath, splashContent);
  
  // Load the splash window
  splashWindow.loadFile(splashPath);
  
  // Show splash window when ready (only if not starting minimized)
  splashWindow.once('ready-to-show', () => {
    // Check if starting minimized - if so, don't show splash screen
    const appConfig = constants.getAppConfig();
    if (appConfig && appConfig.startMinimized) {
      // Don't show splash window when starting minimized
      return;
    }
    
    // Position splash window in the center of the main window
    const mainWindow = constants.getMainWindow();
    if (mainWindow) {
      const mainBounds = mainWindow.getBounds();
      const splashBounds = splashWindow.getBounds();
      
      // Calculate the center position
      const x = Math.round(mainBounds.x + (mainBounds.width - splashBounds.width) / 2);
      const y = Math.round(mainBounds.y + (mainBounds.height - splashBounds.height) / 2);
      
      // Set the position
      splashWindow.setPosition(x, y);
    }
    
    // Show the splash window
    splashWindow.show();
  });
  
  // Workaround for audio issues: reload the window after 3 seconds
  setTimeout(() => {
    const mainWindow = constants.getMainWindow();
    if (mainWindow) {
      constants.setIsFirstLaunch(false);
      
      // Set flag to indicate this is a splash screen reload
      constants.setIsSplashReload(true);
      
      // Save command line preset file path before reload
      constants.setSavedCommandLinePresetFile(constants.getCommandLinePresetFile());
      
      // Save command line music files before reload
      constants.setSavedCommandLineMusicFiles([...process.argv]);
      
      // Close splash window and reload main window
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      
      // Reload the main window
      mainWindow.reload();
      
      // Check for updates after reload if enabled in config
      setTimeout(() => {
        const cfg = constants.getAppConfig();
        if (cfg && cfg.checkForUpdatesOnStartup !== false) {
          checkForUpdates();
        }
      }, 1000);
      
      // Clean up temporary splash file
      try {
        fs.unlinkSync(splashPath);
      } catch (error) {
        console.error('Error removing temporary splash file:', error);
      }
    }
  }, 3000);
}

// Store tray menu labels for translation
let trayMenuLabels = {
  open: 'Open',
  quit: 'Quit',
  presets: 'Presets'
};

// Update tray menu template with translated labels
function updateTrayMenuTemplate(trayMenuTemplate) {
  try {
    // Update the stored labels
    if (trayMenuTemplate.open && trayMenuTemplate.open.label) {
      trayMenuLabels.open = trayMenuTemplate.open.label;
    }
    if (trayMenuTemplate.quit && trayMenuTemplate.quit.label) {
      trayMenuLabels.quit = trayMenuTemplate.quit.label;
    }
    if (trayMenuTemplate.presets && trayMenuTemplate.presets.label) {
      trayMenuLabels.presets = trayMenuTemplate.presets.label;
    }
    
    // Update the tray menu if it exists
    if (tray) {
      const menuTemplate = [];
      
      // Add preset submenu if presets are available
      if (trayMenuTemplate.presets && trayMenuTemplate.presets.items && trayMenuTemplate.presets.items.length > 0) {
        const presetMenuItems = trayMenuTemplate.presets.items.map(presetName => ({
          label: presetName,
          click: async () => {
            try {
              const mainWin = constants.getMainWindow();
              if (mainWin && mainWin.webContents) {
                mainWin.webContents.send('load-preset-from-tray', presetName);
              }
            } catch (error) {
              console.error('Error loading preset from tray:', error);
            }
          }
        }));
        
        menuTemplate.push(
          {
            label: trayMenuLabels.presets,
            submenu: presetMenuItems
          },
          { type: 'separator' }
        );
      }
      
      // Add standard menu items
      menuTemplate.push(
        { label: trayMenuLabels.open, click: () => { const win = constants.getMainWindow(); if (win) { win.show(); } } },
        { label: trayMenuLabels.quit, click: () => { app.quit(); } }
      );
      
      const contextMenu = Menu.buildFromTemplate(menuTemplate);
      tray.setContextMenu(contextMenu);
    }
  } catch (error) {
    console.error('Error updating tray menu template:', error);
  }
}

// Store the updateTrayMenuTemplate function in constants so it can be accessed from ipc-handlers
constants.setUpdateTrayMenuTemplate(updateTrayMenuTemplate);

function createTray() {
  if (tray) return;
  
  // Use PNG file for macOS compatibility and proper path resolution
  const iconPath = path.join(app.getAppPath(), 'images/icon_64x64.png');
  
  try {
    tray = new Tray(iconPath);
    
    // Create initial menu template (will be updated when translations are loaded)
    const menuTemplate = [
      { label: trayMenuLabels.open, click: () => { const win = constants.getMainWindow(); if (win) { win.show(); } } },
      { label: trayMenuLabels.quit, click: () => { app.quit(); } }
    ];
    
    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    tray.setToolTip('EffeTune');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      const win = constants.getMainWindow();
      if (win) {
        win.show();
      }
    });
  } catch (error) {
    console.error('Failed to create tray icon:', error);
    // Don't throw the error, just log it and continue without tray
  }
}

// Initialize the app
function initializeApp() {
  // Set up file logging first to capture all logs
  setupFileLogging();
  
  // Get user data path
  const userDataPath = fileHandlers.getUserDataPath();
  const isPortable = userDataPath !== app.getPath('userData');
  
  // If portable mode is enabled, make sure we never use standard userData path
  if (isPortable) {
    // Override app.getPath for userData to always return our portable path
    // This ensures any direct calls to app.getPath('userData') will use portable path
    const originalGetPath = app.getPath;
    app.getPath = function(name) {
      if (name === 'userData') {
        return userDataPath;
      }
      return originalGetPath.call(this, name);
    };
    
    // For portable mode, we always want to load the pipeline state from the portable directory
    // unless a command line preset file is specified
    if (constants.getCommandLinePresetFile()) {
      // If command line preset file is specified, don't load pipeline state
      constants.setShouldLoadPipelineState(false);
    } else {
      // Otherwise, ensure we load the pipeline state from the portable directory
      constants.setShouldLoadPipelineState(true);
    }
  }
  
  const cfgDefaults = {
    autoLaunch: false,
    startMinimized: false,
    minimizeToTray: false,
    pipelineStartup: 'last',
    startupPreset: '',
    checkForUpdatesOnStartup: true
  };
  const cfg = { ...cfgDefaults, ...configModule.loadConfig() };
  configModule.saveConfig(cfg);
  constants.setAppConfig(cfg);
  app.setLoginItemSettings({ openAtLogin: !!cfg.autoLaunch });
  if (cfg.pipelineStartup === 'default') {
    constants.setShouldLoadPipelineState(false);
  } else if (cfg.pipelineStartup === 'last') {
    constants.setShouldLoadPipelineState(true);
  } else if (cfg.pipelineStartup === 'preset') {
    constants.setShouldLoadPipelineState(false);
    constants.setStartupPreset(cfg.startupPreset);
  }

  // Create the main window
  createWindow();
  
  // Register IPC handlers
  ipcHandlers.registerIpcHandlers();
  
  // Register IPC handler for renderer-ready-for-music-files event
  const { ipcMain } = require('electron');
  ipcMain.on('renderer-ready-for-music-files', (event) => {
    // Debug logs removed for release
    
    // Check if we have pending music files to send
    const pendingFiles = constants.getPendingCommandLineMusicFiles();
    if (pendingFiles && pendingFiles.length > 0) {
      // Debug logs removed for release
      
      // Send music files to the renderer process
      const mainWindow = constants.getMainWindow();
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('open-music-files', pendingFiles);
        
        // Clear pending music files after sending
        constants.clearPendingCommandLineMusicFiles();
      }
    }
  });
  
  // Create splash screen
  createSplashScreen();
}

// Initialize global variables
initGlobalVariables();

// Disable hardware acceleration to avoid DXGI errors
app.disableHardwareAcceleration();

// Store command line arguments for processing after splash screen
constants.setSavedCommandLineMusicFiles([...process.argv]);

// Handle second instance (when user tries to open another instance of the app)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // If we couldn't get the lock, it means another instance is already running
  // so we quit this one
  app.quit();
} else {
  // This is the first instance
  // Listen for second-instance event (when user opens a file with the app)
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Process the command line arguments from the second instance
    // This will set shouldLoadPipelineState to false if a preset file is specified
    // and will detect music files
    fileHandlers.processCommandLineArgs(commandLine);
    
    // Focus the main window if it exists
    const mainWindow = constants.getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      // If there's a preset file, send it to the renderer
      const commandLinePresetFile = constants.getCommandLinePresetFile();
      if (commandLinePresetFile) {
        mainWindow.webContents.send('open-preset-file', commandLinePresetFile);
        constants.setCommandLinePresetFile(null);
      }
      
      // If there are music files, send them to the renderer
      const commandLineMusicFiles = constants.getCommandLineMusicFiles();
      if (commandLineMusicFiles.length > 0) {
        mainWindow.webContents.send('open-music-files', commandLineMusicFiles);
        constants.clearCommandLineMusicFiles();
      }
    }
  });
}

// Handle macOS file open events
app.on('open-file', (event, path) => {
  event.preventDefault();
  
  if (path.endsWith('.effetune_preset')) {
    try {
      // Check if file exists
      if (fs.existsSync(path)) {
        // If a preset file is specified, don't load previous pipeline state
        constants.setShouldLoadPipelineState(false);
        
        const mainWin = constants.getMainWindow();
        if (mainWin && mainWin.webContents) {
          // If app is already running, send the file path to the renderer
          mainWin.webContents.send('open-preset-file', path);
        } else {
          // If app is not yet running, store the path to be opened when the app is ready
          constants.setCommandLinePresetFile(path);
        }
      } else {
        console.error('Preset file does not exist:', path);
      }
    } catch (error) {
      console.error('Error checking preset file:', error);
    }
  } else if (/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(path)) {
    try {
      // Check if file exists
      if (fs.existsSync(path)) {
        const mainWin = constants.getMainWindow();
        if (mainWin && mainWin.webContents) {
          // If app is already running, send the file path to the renderer
          mainWin.webContents.send('open-music-files', [path]);
        } else {
          // If app is not yet running, store the path to be opened when the app is ready
          constants.addCommandLineMusicFile(path);
          // Also store in savedCommandLineMusicFiles for splash reload
          constants.addSavedCommandLineMusicFile(path);
        }
      } else {
        console.error('Music file does not exist:', path);
      }
    } catch (error) {
      console.error('Error checking music file:', error);
    }
  } else {
    // Not a supported file, ignore
    console.log('Unsupported file type:', path);
  }
});

// Register the app as the default handler for effetune:// protocol
app.setAsDefaultProtocolClient('effetune');

// Main entry point
app.whenReady().then(() => {
  // Initialize the app
  initializeApp();
  
  // On macOS, recreate window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit the app when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Export functions for use in other modules
module.exports = {
  sendPendingUpdateInfo,
  getPendingUpdateInfo,
  checkForUpdates
};