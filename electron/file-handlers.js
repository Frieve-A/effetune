const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const constants = require('./constants');
const fileUtils = require('./file-utils');

const PLAYBACK_AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'opus', 'm4a', 'aac', 'webm', 'mp4'];
const PLAYBACK_AUDIO_FILTER_NAME = 'Audio Files (MP3, WAV, OGG, FLAC, OPUS, M4A, AAC, WEBM, MP4)';
const PLAYBACK_AUDIO_EXTENSION_PATTERN = new RegExp(`\\.(${PLAYBACK_AUDIO_EXTENSIONS.join('|')})$`, 'i');
const OFFLINE_AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
const OFFLINE_AUDIO_FILTER_NAME = 'Audio Files for Processing (MP3, WAV, OGG, FLAC, M4A, AAC)';

function isSupportedPlaybackAudioPath(filePath) {
  return PLAYBACK_AUDIO_EXTENSION_PATTERN.test(filePath || '');
}

function normalizeAudioOpenDialogOptions(options = {}) {
  if (!options || !Array.isArray(options.filters)) return options;

  const isOfflineProcessingDialog = options.title === 'Select Audio Files to Process';
  let changed = false;
  const filters = options.filters.map(filter => {
    if (!filter || filter.name !== 'Audio Files') return filter;

    changed = true;
    return isOfflineProcessingDialog
      ? { name: OFFLINE_AUDIO_FILTER_NAME, extensions: OFFLINE_AUDIO_EXTENSIONS }
      : { name: PLAYBACK_AUDIO_FILTER_NAME, extensions: PLAYBACK_AUDIO_EXTENSIONS };
  });

  return changed ? { ...options, filters } : options;
}

// Set the main window reference
function setMainWindow(window) {
  constants.setMainWindow(window);
}

// Get the actual executable path for packaged apps
function getActualExePath() {
  // In packaged apps, process.execPath points to the actual executable
  return process.execPath;
}

// Get user data path (portable or standard)
function getUserDataPath() {
  // According to the requirements:
  // 1. If there's an effetune_settings folder in the same directory as the exe, use it (portable mode)
  // 2. Otherwise, use the standard userData path (installed mode)
  
  const { app } = require('electron');
  
  // Check in the executable directory using process.execPath
  const execPath = getActualExePath();
  const execDir = path.dirname(execPath);
  let portableSettingsPath = path.join(execDir, 'effetune_settings');
  
  // If the settings folder exists in the exe directory, use it (portable mode)
  if (fs.existsSync(portableSettingsPath)) {
    return portableSettingsPath;
  }
  
  // If no portable settings folder found, use standard userData path
  return app.getPath('userData');
}

// File dialog operations
async function showSaveDialog(options) {
  const mainWindow = constants.getMainWindow();
  return await dialog.showSaveDialog(mainWindow, options);
}

async function showOpenDialog(options) {
  const mainWindow = constants.getMainWindow();
  return await dialog.showOpenDialog(mainWindow, normalizeAudioOpenDialogOptions(options));
}

// File operations - using fileUtils
async function saveFile(filePath, content) {
  return await fileUtils.saveFile(filePath, content);
}

async function readFile(filePath, binary = false) {
  return await fileUtils.readFile(filePath, binary);
}

// Handle read file as buffer request (for ID3 tag reading)
async function readFileAsBuffer(filePath) {
  return await fileUtils.readFileAsBuffer(filePath);
}

// File path utilities - using fileUtils
function joinPaths(basePath, ...paths) {
  return fileUtils.joinPaths(basePath, ...paths);
}
function fileExists(filePath) {
  return fileUtils.fileExists(filePath);
}

// Handle get file path request
async function getFilePath(fileInfo) {
  try {
    // Show open dialog to let the user select the file
    const mainWindow = constants.getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Select ${fileInfo.name}`,
      properties: ['openFile'],
      filters: [
        { name: PLAYBACK_AUDIO_FILTER_NAME, extensions: PLAYBACK_AUDIO_EXTENSIONS },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      console.log('File selection canceled');
      return null;
    }
    
    return result.filePaths[0];
  } catch (error) {
    console.error('Error in get-file-path:', error);
    return null;
  }
}

// Handle get file paths request
async function getFilePaths(filesInfo) {
  try {
    // Show open dialog to let the user select multiple files
    const mainWindow = constants.getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Music Files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: PLAYBACK_AUDIO_FILTER_NAME, extensions: PLAYBACK_AUDIO_EXTENSIONS },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      console.log('File selection canceled');
      return [];
    }
    
    return result.filePaths;
  } catch (error) {
    console.error('Error in get-file-paths:', error);
    return [];
  }
}

// Handle dropped files with paths
async function handleDroppedFilesWithPaths(filePaths) {
  try {
    // Filter for audio files
    const audioFilePaths = filePaths.filter(filePath => {
      return isSupportedPlaybackAudioPath(filePath);
    });
    
    return audioFilePaths;
  } catch (error) {
    console.error('Error handling dropped files with paths:', error);
    return [];
  }
}

// Handle dropped files (fallback method)
async function handleDroppedFiles(filesInfo) {
  try {
    // For security reasons, Electron doesn't provide direct access to file paths from the renderer process
    // We'll use a different approach to handle dropped files
    
    // Show a dialog to let the user select the files
    // This is the most reliable approach
    const mainWindow = constants.getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Music Files',
      defaultPath: require('electron').app.getPath('music'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: PLAYBACK_AUDIO_FILTER_NAME, extensions: PLAYBACK_AUDIO_EXTENSIONS },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      console.log('File selection canceled');
      return [];
    }
    
    return result.filePaths;
  } catch (error) {
    console.error('Error handling dropped files:', error);
    return [];
  }
}

// Handle dropped preset file
async function handleDroppedPresetFile(fileInfo) {
  try {
    // In a real implementation, we would use the file info to locate the actual file
    
    // For now, we'll show a dialog to let the user select the file
    
    const mainWindow = constants.getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Preset File',
      properties: ['openFile'],
      filters: [
        { name: 'EffeTune Preset Files', extensions: ['effetune_preset'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      console.log('File selection canceled');
      return null;
    }
    
    return result.filePaths[0];
  } catch (error) {
    console.error('Error handling dropped preset file:', error);
    return null;
  }
}
// Handle save pipeline state to file request
async function savePipelineStateToFile(pipelineState) {
  // Get app path
  const appPath = getUserDataPath();
  
  // Use fileUtils to save the pipeline state
  return await fileUtils.savePipelineStateToFile(pipelineState, appPath);
}

// Process command line arguments to find preset files and music files
function processCommandLineArgs(argv) {
  // Skip processing during splash screen (first launch)
  if (constants.getIsFirstLaunch()) {
    // Debug logs removed for release
    return;
  }
  
  // Get the arguments (excluding the app path and the script path)
  // In packaged apps, the first argument is the app path
  // In development, the first two arguments are electron and the script path
  const args = process.defaultApp ? argv.slice(2) : argv.slice(1);
  
  // Debug logs removed for release
  
  if (args.length > 0) {
    // Clear previous music files
    constants.clearCommandLineMusicFiles();
    
    // Process each argument to find preset files and music files
    for (const arg of args) {
      // Check if the argument is a file path that ends with .effetune_preset
      if (arg && arg.endsWith('.effetune_preset')) {
        try {
          // Check if file exists
          if (fs.existsSync(arg)) {
            // Store the command line preset file path
            constants.setCommandLinePresetFile(arg);
            
            // Also store in savedCommandLinePresetFile for splash reload
            constants.setSavedCommandLinePresetFile(arg);
            
            // If a preset file is specified via command line, don't load previous pipeline state
            constants.setShouldLoadPipelineState(false);
            
            // If the app is already running, send the file path to the renderer
            const mainWindow = constants.getMainWindow();
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.send('open-preset-file', arg);
              
              // Also set pipelineStateLoaded to false in the renderer
              mainWindow.webContents.executeJavaScript(`
                window.pipelineStateLoaded = false;
              `).catch(err => {
                console.error('Error setting pipelineStateLoaded flag:', err.message || String(err));
              });
            }
            
            // Only process the first valid preset file
            break;
          }
        } catch (error) {
          console.error('Error checking preset file:', error);
        }
      }
      // Check if the argument is a music file
      else if (arg && isSupportedPlaybackAudioPath(arg)) {
        try {
          // Debug logs removed for release
          
          // Check if file exists
          if (fs.existsSync(arg)) {
            // Debug logs removed for release
            
            // Add to music files array
            constants.addCommandLineMusicFile(arg);
            
            // Also store in savedCommandLineMusicFiles for splash reload
            const absolutePath = path.resolve(arg);
            // Debug logs removed for release
            constants.addSavedCommandLineMusicFile(absolutePath); // Use absolute path
          } else {
            // Debug logs removed for release
          }
        } catch (error) {
          console.error('Error checking music file:', error);
        }
      }
    }
  }
}

// Export functions
module.exports = {
  setMainWindow,
  getUserDataPath,
  showSaveDialog,
  showOpenDialog,
  saveFile,
  readFile,
  readFileAsBuffer,
  joinPaths,
  fileExists,
  getFilePath,
  getFilePaths,
  handleDroppedFilesWithPaths,
  handleDroppedFiles,
  handleDroppedPresetFile,
  savePipelineStateToFile,
  processCommandLineArgs
};
