const { ipcMain, shell, systemPreferences, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const constants = require('./constants');
const config = require('./config');

// Import file handlers
const fileHandlers = require('./file-handlers');

// Set the main window reference
function setMainWindow(window) {
  constants.setMainWindow(window);
}

// Helper function to simulate keyboard shortcuts
function simulateKeyboardShortcut(keyCode, modifiers = []) {
  const mainWin = constants.getMainWindow();
  if (!mainWin) return;
  
  // Send key down event
  mainWin.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: keyCode,
    modifiers: modifiers
  });
  
  // Send key up event
  mainWin.webContents.sendInputEvent({
    type: 'keyUp',
    keyCode: keyCode,
    modifiers: modifiers
  });
}

// Register all IPC handlers
function registerIpcHandlers() {
  // Get first launch flag
  ipcMain.handle('get-first-launch-flag', () => {
    return constants.getIsFirstLaunch();
  });

  // Get command line preset file
  ipcMain.handle('get-command-line-preset-file', () => {
    return constants.getCommandLinePresetFile();
  });

  // Handle update notifications
  ipcMain.on('update-available', (event, updateInfo) => {
    const mainWin = constants.getMainWindow();
    if (mainWin && mainWin.webContents) {
      mainWin.webContents.send('update-available', updateInfo);
    }
  });

  // Handle renderer ready for update notifications
  ipcMain.handle('renderer-ready-for-updates', () => {
    // Import the sendPendingUpdateInfo function
    const { sendPendingUpdateInfo } = require('./main');
    sendPendingUpdateInfo();
    return { success: true };
  });

  // Handle get update info request
  ipcMain.handle('get-update-info', () => {
    try {
      // Import the getPendingUpdateInfo function from main
      const { getPendingUpdateInfo } = require('./main');
      return getPendingUpdateInfo();
    } catch (error) {
      console.error('IPC handler: Error in get-update-info:', error);
      return null;
    }
  });

  // Handle force check for updates request
  ipcMain.handle('force-check-for-updates', async () => {
    try {
      // Import the checkForUpdates function from main
      const { checkForUpdates } = require('./main');
      await checkForUpdates();
      return { success: true };
    } catch (error) {
      console.error('IPC handler: Error in force-check-for-updates:', error);
      return { success: false, error: error.message };
    }
  });



  // File dialog operations
  ipcMain.handle('show-save-dialog', async (event, options) => {
    return await fileHandlers.showSaveDialog(options);
  });

  ipcMain.handle('show-open-dialog', async (event, options) => {
    return await fileHandlers.showOpenDialog(options);
  });

  // File operations
  ipcMain.handle('save-file', async (event, filePath, content) => {
    return await fileHandlers.saveFile(filePath, content);
  });

  ipcMain.handle('read-file', async (event, filePath, binary = false) => {
    return await fileHandlers.readFile(filePath, binary);
  });

  ipcMain.handle('read-file-as-buffer', async (event, filePath) => {
    return await fileHandlers.readFileAsBuffer(filePath);
  });

  // Get audio devices
  ipcMain.handle('get-audio-devices', async () => {
    try {
      // Get input devices (microphones)
      const inputDevices = await systemPreferences.getMediaAccessStatus('microphone');
      if (inputDevices !== 'granted') {
        await systemPreferences.askForMediaAccess('microphone');
      }
      
      // Use Electron's built-in method to get audio devices
      const mainWin = constants.getMainWindow();
      const devices = await mainWin.webContents.executeJavaScript(`
        navigator.mediaDevices.enumerateDevices()
          .then(async devices => {
            // Get additional device information including sample rates
            const deviceList = devices
              .filter(device => device.kind === 'audioinput' || device.kind === 'audiooutput')
              .map(device => ({
                deviceId: device.deviceId,
                kind: device.kind,
                label: device.label || (device.kind === 'audioinput' ? 'Microphone ' : 'Speaker ') + device.deviceId.substring(0, 5)
              }));
            
            // We don't need to try to determine sample rates here
            // The actual sample rate will be determined when the device is opened
            // and the AudioContext is created
            
            return deviceList;
          })
          .catch(err => {
            console.error('Error enumerating devices:', err.message || String(err));
            return [];
          });
      `);
      
      return { success: true, devices };
    } catch (error) {
      console.error('Error getting audio devices:', error);
      return { success: false, error: error.message };
    }
  });

  // Save audio device preferences
  ipcMain.handle('save-audio-preferences', async (event, preferences) => {
    try {
      const userDataPath = fileHandlers.getUserDataPath();
      const prefsPath = path.join(userDataPath, 'audio-preferences.json');
      
      // Ensure the directory exists
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      
      fs.writeFileSync(prefsPath, JSON.stringify(preferences, null, 2));
      
      // Show message that audio settings are saved and the application will reload shortly
      const mainWin = constants.getMainWindow();
      if (mainWin) {
        mainWin.webContents.send('show-message', 'Audio settings saved. The application will reload shortly.');
        
        // Wait for a few seconds before reloading
        setTimeout(() => {
          const mainWin = constants.getMainWindow();
          if (mainWin) {
            mainWin.reload();
          }
        }, 3000); // 3 seconds delay
      }
      return { success: true };
    } catch (error) {
      console.error('Error saving preferences:', error);
      return { success: false, error: error.message };
    }
  });

  // Load audio device preferences
  ipcMain.handle('load-audio-preferences', async () => {
    try {
      const userDataPath = fileHandlers.getUserDataPath();
      const prefsPath = path.join(userDataPath, 'audio-preferences.json');
      
      if (fs.existsSync(prefsPath)) {
        const content = fs.readFileSync(prefsPath, 'utf8');
        const preferences = JSON.parse(content);
        return { success: true, preferences };
      }
      
      return { success: true, preferences: null };
    } catch (error) {
      console.error('Error loading preferences:', error);
      return { success: false, error: error.message };
    }
  });

  // Save configuration
  ipcMain.handle('save-config', async (event, cfg) => {
    try {
      const current = { ...config.loadConfig(), ...cfg };
      config.saveConfig(current);
      constants.setAppConfig(current);
      require('electron').app.setLoginItemSettings({ openAtLogin: !!current.autoLaunch });
      return { success: true };
    } catch (error) {
      console.error('Error saving config:', error);
      return { success: false, error: error.message };
    }
  });

  // Load configuration
  ipcMain.handle('load-config', async () => {
    try {
      const cfg = config.loadConfig();
      return { success: true, config: cfg };
    } catch (error) {
      console.error('Error loading config:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle opening external URLs in default browser
  ipcMain.handle('open-external-url', async (event, url) => {
    try {
      // Make sure the URL is properly formatted
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        // Extract anchor if present
        let anchor = '';
        if (url.includes('#')) {
          const parts = url.split('#');
          url = parts[0];
          anchor = '#' + parts[1];
        }
        
        // Remove any existing extension and add .html
        url = url.replace(/\.[^/.]+$/, '') + '.html';
        
        // Add anchor back if it was present
        url = url + anchor;
        
        // Add base URL
        url = 'https://effetune.frieve.com' + (url.startsWith('/') ? url : '/' + url);
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('Error opening external URL:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Handle get app version request
  ipcMain.handle('get-app-version', () => {
    return constants.getAppVersion();
  });

  // Handle get path request
  ipcMain.handle('getPath', (event, name) => {
    // If userData path is requested, use our custom function to support portable mode
    if (name === 'userData') {
      return fileHandlers.getUserDataPath();
    }
    return require('electron').app.getPath(name);
  });

  // Handle join paths request
  ipcMain.handle('joinPaths', (event, basePath, ...paths) => {
    return fileHandlers.joinPaths(basePath, ...paths);
  });

  // Handle file exists request
  ipcMain.handle('fileExists', (event, filePath) => {
    return fileHandlers.fileExists(filePath);
  });

  // Handle get file path request
  ipcMain.handle('get-file-path', async (event, fileInfo) => {
    return await fileHandlers.getFilePath(fileInfo);
  });

  // Handle get file paths request
  ipcMain.handle('get-file-paths', async (event, filesInfo) => {
    return await fileHandlers.getFilePaths(filesInfo);
  });

  // Handle dropped files with paths
  ipcMain.handle('handle-dropped-files-with-paths', async (event, filePaths) => {
    return await fileHandlers.handleDroppedFilesWithPaths(filePaths);
  });

  // Handle dropped files (fallback method)
  ipcMain.handle('handle-dropped-files', async (event, filesInfo) => {
    return await fileHandlers.handleDroppedFiles(filesInfo);
  });

  // Handle dropped preset file
  ipcMain.handle('handle-dropped-preset-file', async (event, fileInfo) => {
    return await fileHandlers.handleDroppedPresetFile(fileInfo);
  });

  // Handle save pipeline state to file request
  ipcMain.handle('save-pipeline-state-to-file', async (event, pipelineState) => {
    return await fileHandlers.savePipelineStateToFile(pipelineState);
  });

  // Handle pipeline state response for window close
  ipcMain.on('pipeline-state-for-close', async (event, pipelineState) => {
    // Clear the close timeout
    constants.clearCloseTimeout();

    // Save the pipeline state
    if (pipelineState) {
      await fileHandlers.savePipelineStateToFile(pipelineState);
    }

    // Trigger the actual window close
    const triggerClose = constants.getTriggerClose();
    if (triggerClose) {
      triggerClose();
    }
  });

  // Handle window reload request
  ipcMain.handle('reload-window', () => {
    const mainWin = constants.getMainWindow();
    if (mainWin) {
      mainWin.reload();
      return { success: true };
    }
    return { success: false, error: 'Main window not available' };
  });

  // Handle clear microphone permission request
  ipcMain.handle('clear-microphone-permission', async () => {
    try {
      const mainWin = constants.getMainWindow();
      if (mainWin) {
        // Clear permission overrides for microphone
        await mainWin.webContents.session.clearPermissionOverrides({
          origin: 'file://',
          permission: 'media'
        });
        
        // Request microphone access again
        const status = await systemPreferences.getMediaAccessStatus('microphone');
        if (status !== 'granted') {
          await systemPreferences.askForMediaAccess('microphone');
        }
        
        return { success: true };
      }
      return { success: false, error: 'Main window not available' };
    } catch (error) {
      console.error('Error clearing microphone permission:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle application menu update request
  ipcMain.handle('update-application-menu', (event, menuTemplate) => {
    try {
      // Create a new menu template with the same structure but updated labels
      const template = [
        {
          label: menuTemplate.file.label,
          submenu: [
            {
              label: menuTemplate.file.submenu[0].label, // Save
              accelerator: 'CommandOrControl+S',
              click: () => simulateKeyboardShortcut('S', ['control'])
            },
            {
              label: menuTemplate.file.submenu[1].label, // Save As...
              accelerator: 'CommandOrControl+Shift+S',
              click: () => simulateKeyboardShortcut('S', ['control', 'shift'])
            },
            { type: 'separator' },
            {
              label: menuTemplate.file.submenu[3].label, // Open music file...
              accelerator: 'CommandOrControl+O',
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.webContents.send('open-music-file');
                }
              }
            },
            {
              label: menuTemplate.file.submenu[4].label, // Process Audio Files with Effects...
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.webContents.send('process-audio-files');
                }
              }
            },
            { type: 'separator' },
            {
              label: menuTemplate.file.submenu[6].label, // Export Preset...
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.webContents.send('export-preset');
                }
              }
            },
            {
              label: menuTemplate.file.submenu[7].label, // Import Preset...
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.webContents.send('import-preset');
                }
              }
            },
            { type: 'separator' },
            { role: 'quit', label: menuTemplate.file.submenu[9].label } // Quit
          ]
        },
        {
          label: menuTemplate.edit.label,
          submenu: [
            {
              label: menuTemplate.edit.submenu[0].label, // Undo
              accelerator: 'CommandOrControl+Z',
              click: () => simulateKeyboardShortcut('Z', ['control'])
            },
            {
              label: menuTemplate.edit.submenu[1].label, // Redo
              accelerator: 'CommandOrControl+Y',
              click: () => simulateKeyboardShortcut('Y', ['control'])
            },
            { type: 'separator' },
            {
              label: menuTemplate.edit.submenu[3].label, // Cut
              accelerator: 'CommandOrControl+X',
              click: () => simulateKeyboardShortcut('X', ['control'])
            },
            {
              label: menuTemplate.edit.submenu[4].label, // Copy
              accelerator: 'CommandOrControl+C',
              click: () => simulateKeyboardShortcut('C', ['control'])
            },
            {
              label: menuTemplate.edit.submenu[5].label, // Paste
              accelerator: 'CommandOrControl+V',
              click: () => simulateKeyboardShortcut('V', ['control'])
            },
            { type: 'separator' },
            {
              label: menuTemplate.edit.submenu[7].label, // Delete
              accelerator: 'Delete',
              click: () => simulateKeyboardShortcut('Delete')
            },
            {
              label: menuTemplate.edit.submenu[8].label, // Select All
              accelerator: 'CommandOrControl+A',
              click: () => simulateKeyboardShortcut('A', ['control'])
            }
          ]
        },
        {
          label: menuTemplate.view.label,
          submenu: [
            {
              label: menuTemplate.view.submenu[0].label, // Reload
              accelerator: 'CommandOrControl+R',
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  // First ensure we reset any custom zoom
                  mainWin.webContents.executeJavaScript(`
                    // Reset zoom before reload
                    document.body.style.zoom = 1.0;
                  `).catch(err => {
                    console.error('Error resetting zoom before reload:', err);
                  }).finally(() => {
                    // Then reload the window
                    mainWin.reload();
                  });
                }
              }
            },
            { type: 'separator' },
            {
              label: menuTemplate.view.submenu[2].label, // Reset Zoom
              accelerator: 'CommandOrControl+0',
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.webContents.executeJavaScript(`
                    (function() {
                      document.body.style.zoom = 1.0;
                    })();
                  `).catch(err => {
                    console.error('Error executing zoom reset script:', err);
                  });
                }
              }
            },
            {
              label: menuTemplate.view.submenu[3].label, // Zoom In
              accelerator: 'CommandOrControl+=',
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.webContents.executeJavaScript(`
                    (function() {
                      const zoom = parseFloat(document.body.style.zoom || '1');
                      const newZoom = Math.min(zoom + 0.1, 3.0);
                      document.body.style.zoom = newZoom;
                    })();
                  `).catch(err => {
                    console.error('Error executing zoom in script:', err);
                  });
                }
              }
            },
            {
              label: menuTemplate.view.submenu[4].label, // Zoom Out
              accelerator: 'CommandOrControl+-',
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.webContents.executeJavaScript(`
                    (function() {
                      const zoom = parseFloat(document.body.style.zoom || '1');
                      const newZoom = Math.max(zoom - 0.1, 0.3);
                      document.body.style.zoom = newZoom;
                    })();
                  `).catch(err => {
                    console.error('Error executing zoom out script:', err);
                  });
                }
              }
            },
            { type: 'separator' },
            {
              role: 'togglefullscreen',
              label: menuTemplate.view.submenu[6].label // Toggle Fullscreen
            }
          ]
        },
        {
          label: menuTemplate.settings.label,
          submenu: [
            {
              label: menuTemplate.settings.submenu[0].label, // Config...
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.webContents.send('config-app');
                }
              }
            },
            {
              label: menuTemplate.settings.submenu[1].label, // Audio Devices...
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.webContents.send('config-audio');
                }
              }
            },
            {
              label: menuTemplate.settings.submenu[2].label, // Performance Benchmark
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.loadFile('features/effetune_bench.html');
                }
              }
            },
            {
              label: menuTemplate.settings.submenu[3].label, // Frequency Response Measurement
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.loadFile('features/measurement/measurement.html');
                }
              }
            }
          ]
        },
        {
          label: menuTemplate.help.label,
          submenu: [
            {
              label: menuTemplate.help.submenu[0].label, // Help
              accelerator: 'F1', // Add F1 as the keyboard shortcut
              click: () => {
                // Simply click the "What's this app" link in the renderer process
                // This ensures the same behavior in both web and Electron environments
                const mainWin = constants.getMainWindow();
            if (mainWin && mainWin.webContents) {
                  mainWin.webContents.executeJavaScript(`
                    const whatsThisLink = document.querySelector('.whats-this');
                    if (whatsThisLink) {
                      whatsThisLink.click();
                    }
                  `).catch(error => {
                    console.error('Error executing Help menu action:', error);
                  });
                }
              }
            },
            {
              label: menuTemplate.help.submenu[1].label, // Discord
              click: () => {
                require('electron').shell.openExternal('https://discord.gg/gf95v3Gza2');
              }
            },
            { type: 'separator' },
            {
              label: menuTemplate.help.submenu[3].label, // About
              click: () => {
                const mainWin = constants.getMainWindow();
                if (mainWin) {
                  mainWin.webContents.send('show-about-dialog', {
                    version: constants.getAppVersion(),
                    icon: path.join(__dirname, '../images/favicon.ico')
                  });
                }
              }
            }
          ]
        }
      ];

      // Build and set the new menu
      const menu = Menu.buildFromTemplate(template);
      Menu.setApplicationMenu(menu);
      
      return { success: true };
    } catch (error) {
      console.error('Error updating application menu:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle tray menu update request
  ipcMain.handle('update-tray-menu', (event, trayMenuTemplate) => {
    try {
      // Get the updateTrayMenuTemplate function from constants
      const updateTrayMenuTemplate = constants.getUpdateTrayMenuTemplate();
      if (updateTrayMenuTemplate) {
        updateTrayMenuTemplate(trayMenuTemplate);
        return { success: true };
      } else {
        return { success: false, error: 'updateTrayMenuTemplate function not available' };
      }
    } catch (error) {
      console.error('Error updating tray menu:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle tray preset load request
  ipcMain.handle('load-preset-from-tray', async (event, presetName) => {
    try {
      const mainWin = constants.getMainWindow();
      if (mainWin && mainWin.webContents) {
        // Send preset load command to renderer process
        mainWin.webContents.send('load-preset-from-tray', presetName);
        return { success: true };
      } else {
        return { success: false, error: 'Main window not available' };
      }
    } catch (error) {
      console.error('Error loading preset from tray:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle get user presets request for tray menu
  ipcMain.handle('get-user-presets-for-tray', async () => {
    try {
      const fileHandlers = require('./file-handlers.js');
      const userDataPath = fileHandlers.getUserDataPath();
      const presetsFilePath = path.join(userDataPath, 'effetune_presets.json');
      
      // Check if presets file exists
      if (!fs.existsSync(presetsFilePath)) {
        return { success: true, presets: [] };
      }
      
      // Read presets file
      const presetsContent = fs.readFileSync(presetsFilePath, 'utf8');
      const presets = JSON.parse(presetsContent);
      
      // Return sorted preset names
      const presetNames = Object.keys(presets).sort();
      return { success: true, presets: presetNames };
    } catch (error) {
      console.error('Error getting user presets for tray:', error);
      return { success: false, error: error.message, presets: [] };
    }
  });

  // Handle get application menu request
  ipcMain.handle('get-application-menu', () => {
    try {
      // Get the current menu template
      const menu = Menu.getApplicationMenu();
      if (!menu) {
        return null;
      }
      
      // Create a simplified menu template from the current menu
      const template = {
        file: {
          label: menu.items[0].label,
          submenu: menu.items[0].submenu.items.map(item => ({
            label: item.label,
            role: item.role
          }))
        },
        edit: {
          label: menu.items[1].label,
          submenu: menu.items[1].submenu.items.map(item => ({
            label: item.label
          }))
        },
        view: {
          label: menu.items[2].label,
          submenu: menu.items[2].submenu.items.map(item => ({
            label: item.label
          }))
        },
        settings: {
          label: menu.items[3].label,
          submenu: menu.items[3].submenu.items.map(item => ({
            label: item.label
          }))
        },
        help: {
          label: menu.items[4].label,
          submenu: menu.items[4].submenu.items.map(item => ({
            label: item.label
          }))
        }
      };
      
      return template;
    } catch (error) {
      console.error('Error getting application menu:', error);
      return null;
    }
  });

  // Handle hide application menu request
  ipcMain.handle('hide-application-menu', () => {
    try {
      // Hide the application menu
      Menu.setApplicationMenu(null);
      return { success: true };
    } catch (error) {
      console.error('Error hiding application menu:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle restore default application menu request
  ipcMain.handle('restore-default-menu', () => {
    try {
      // Restore the default menu
      createMenu();
      return { success: true };
    } catch (error) {
      console.error('Error restoring default menu:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle navigate back to main page request
  ipcMain.handle('navigate-to-main', () => {
    try {
      const mainWin = constants.getMainWindow();
      if (mainWin) {
        // Restore the default menu first
        createMenu();
        // Then navigate back to the main page
        mainWin.loadFile('effetune.html');
        return { success: true };
      }
      return { success: false, error: 'Main window not available' };
    } catch (error) {
      console.error('Error navigating to main page:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle opening documentation
  ipcMain.handle('open-documentation', async (event, docPath) => {
    try {
      // For all documentation, use shell.openExternal to open in default browser
      // Convert local path to GitHub Pages URL if needed
      let url = docPath;
      if (!url.startsWith('http')) {
        // Extract anchor if present
        let anchor = '';
        if (docPath.includes('#')) {
          const parts = docPath.split('#');
          docPath = parts[0];
          anchor = '#' + parts[1];
        }
        
        // Remove any existing extension and add .html
        docPath = docPath.replace(/\.[^/.]+$/, '') + '.html';
        
        // Add anchor back if it was present
        docPath = docPath + anchor;
        
        url = `https://effetune.frieve.com${docPath}`;
        
      }
      await shell.openExternal(url);
      return { success: true };
      
      // Nothing more to do here, we've already opened the URL in the default browser
    } catch (error) {
      console.error('Error opening documentation:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Handle files dropped from preload script
  ipcMain.on('files-dropped', (event, filePaths) => {
    try {
      // Filter for audio files
      const audioFilePaths = filePaths.filter(filePath => {
        const ext = path.extname(filePath).toLowerCase();
        const isAudio = ['.mp3', '.wav', '.ogg', '.flac', '.opus', '.m4a', '.aac', '.webm'].includes(ext);
        return isAudio;
      });
      
      // Send the audio file paths back to the renderer process
      const mainWin = constants.getMainWindow();
      if (mainWin && mainWin.webContents) {
        mainWin.webContents.send('audio-files-dropped', audioFilePaths);
      } else {
        console.error('mainWin or webContents not available');
      }
    } catch (error) {
      console.error('Error handling dropped files:', error);
    }
  });
}

// Create application menu
function createMenu() {
  const { Menu } = require('electron');
  
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Save',
          accelerator: 'CommandOrControl+S',
          click: () => simulateKeyboardShortcut('S', ['control'])
        },
        {
          label: 'Save As...',
          accelerator: 'CommandOrControl+Shift+S',
          click: () => simulateKeyboardShortcut('S', ['control', 'shift'])
        },
        { type: 'separator' },
        {
          label: 'Open music file...',
          accelerator: 'CommandOrControl+O',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.webContents.send('open-music-file');
            }
          }
        },
        {
          label: 'Process Audio Files with Effects...',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.webContents.send('process-audio-files');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Export Preset...',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.webContents.send('export-preset');
            }
          }
        },
        {
          label: 'Import Preset...',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.webContents.send('import-preset');
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CommandOrControl+Z',
          click: () => simulateKeyboardShortcut('Z', ['control'])
        },
        {
          label: 'Redo',
          accelerator: 'CommandOrControl+Y',
          click: () => simulateKeyboardShortcut('Y', ['control'])
        },
        { type: 'separator' },
        {
          label: 'Cut',
          accelerator: 'CommandOrControl+X',
          click: () => simulateKeyboardShortcut('X', ['control'])
        },
        {
          label: 'Copy',
          accelerator: 'CommandOrControl+C',
          click: () => simulateKeyboardShortcut('C', ['control'])
        },
        {
          label: 'Paste',
          accelerator: 'CommandOrControl+V',
          click: () => simulateKeyboardShortcut('V', ['control'])
        },
        { type: 'separator' },
        {
          label: 'Delete',
          accelerator: 'Delete',
          click: () => simulateKeyboardShortcut('Delete')
        },
        {
          label: 'Select All',
          accelerator: 'CommandOrControl+A',
          click: () => simulateKeyboardShortcut('A', ['control'])
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CommandOrControl+R',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              // First ensure we reset any custom zoom
              mainWin.webContents.executeJavaScript(`
                // Reset zoom before reload
                document.body.style.zoom = 1.0;
              `).catch(err => {
                console.error('Error resetting zoom before reload:', err.message || String(err));
              }).finally(() => {
                // Then reload the window
                mainWin.reload();
              });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Reset Zoom',
          accelerator: 'CommandOrControl+0',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.webContents.executeJavaScript(`
                (function() {
                  document.body.style.zoom = 1.0;
                })();
              `).catch(err => {
                console.error('Error executing zoom reset script:', err.message || String(err));
              });
            }
          }
        },
        {
          label: 'Zoom In',
          accelerator: 'CommandOrControl+=',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.webContents.executeJavaScript(`
                (function() {
                  const zoom = parseFloat(document.body.style.zoom || '1');
                  const newZoom = Math.min(zoom + 0.1, 3.0);
                  document.body.style.zoom = newZoom;
                })();
              `).catch(err => {
                console.error('Error executing zoom in script:', err.message || String(err));
              });
            }
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CommandOrControl+-',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.webContents.executeJavaScript(`
                (function() {
                  const zoom = parseFloat(document.body.style.zoom || '1');
                  const newZoom = Math.max(zoom - 0.1, 0.3);
                  document.body.style.zoom = newZoom;
                })();
              `).catch(err => {
                console.error('Error executing zoom out script:', err.message || String(err));
              });
            }
          }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Config...',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.webContents.send('config-app');
            }
          }
        },
        {
          label: 'Audio Devices...',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.webContents.send('config-audio');
            }
          }
        },
        {
          label: 'Performance Benchmark',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.loadFile('features/effetune_bench.html');
            }
          }
        },
        {
          label: 'Frequency Response Measurement',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.loadFile('features/measurement/measurement.html');
            }
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Help',
          accelerator: 'F1', // Add F1 as the keyboard shortcut
          click: () => {
            // Simply click the "What's this app" link in the renderer process
            // This ensures the same behavior in both web and Electron environments
            const mainWin = constants.getMainWindow();
            if (mainWin && mainWin.webContents) {
              mainWin.webContents.executeJavaScript(`
                const whatsThisLink = document.querySelector('.whats-this');
                if (whatsThisLink) {
                  whatsThisLink.click();
                }
              `).catch(error => {
                console.error('Error executing Help menu action:', error);
              });
            }
          }
        },
        {
          label: 'Discord',
          click: () => {
            require('electron').shell.openExternal('https://discord.gg/gf95v3Gza2');
          }
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (mainWin) {
              mainWin.webContents.send('show-about-dialog', {
                version: constants.getAppVersion(),
                icon: path.join(__dirname, '../images/favicon.ico')
              });
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Export functions
module.exports = {
  setMainWindow,
  registerIpcHandlers,
  createMenu,
  simulateKeyboardShortcut
};