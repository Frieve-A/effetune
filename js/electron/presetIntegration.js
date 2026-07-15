/**
 * Preset and file integration module for EffeTune
 * Provides preset and file handling functionality when running in Electron
 */

function getPresetNameFromPath(filePath) {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  return fileName.endsWith('.effetune_preset')
    ? fileName.slice(0, -'.effetune_preset'.length)
    : fileName;
}

/**
 * Open a preset file from the file system
 * @param {boolean} isElectron - Whether running in Electron environment
 * @param {string} filePath - Path to the preset file
 */
export async function openPresetFile(isElectron, filePath) {
  if (!isElectron || !window.uiManager) {
    console.error('Cannot open preset file: Electron integration or UI manager not available');
    return Promise.reject(new Error('Electron integration or UI manager not available'));
  }
  
  // Debug logs removed for release
  
  try {
    // Set pipeline state flags to false
    try {
      // Simply set the flags directly
      if (typeof window.ORIGINAL_PIPELINE_STATE_LOADED !== 'undefined') {
        // Use a direct assignment if possible
        window.ORIGINAL_PIPELINE_STATE_LOADED = false;
      }
      
      // Set the regular flag
      window.pipelineStateLoaded = false;
      
      // Force app.js to skip loading previous state by setting a direct flag
      window.__FORCE_SKIP_PIPELINE_STATE_LOAD = true;
    } catch (err) {
      console.error('Error setting pipeline state flags:', err.message || String(err));
    }
    
    // Verify file exists and has correct extension
    if (!filePath.endsWith('.effetune_preset')) {
      console.error('Not a preset file:', filePath);
      window.uiManager.setError('Not a valid preset file');
      setTimeout(() => window.uiManager.clearError(), 3000);
      return;
    }
    
    // Read file
    // Reading preset file
    const readResult = await window.electronAPI.readFile(filePath);
    
    if (!readResult.success) {
      console.error('Failed to read preset file:', readResult.error);
      window.uiManager.setError(`Failed to read preset file: ${readResult.error}`);
      setTimeout(() => window.uiManager.clearError(), 3000);
      return;
    }
    
    // Parse the file content
    // Parsing preset file content
    let fileData;
    try {
      fileData = JSON.parse(readResult.content);
    } catch (parseError) {
      console.error('Failed to parse preset file JSON:', parseError);
      window.uiManager.setError('Invalid preset file format');
      setTimeout(() => window.uiManager.clearError(), 3000);
      return;
    }
    
    let presetData;
    
    // Handle different formats for backward compatibility
    if (Array.isArray(fileData)) {
      // Detected old preset format (array)
      // Old format: direct array of pipeline plugins
      presetData = {
        name: getPresetNameFromPath(filePath),
        timestamp: Date.now(),
        pipeline: fileData
      };
    } else if (fileData.pipeline) {
      // Detected new preset format (object with pipeline)
      // New format: complete preset object
      presetData = fileData;
      // Update timestamp to current time
      presetData.timestamp = Date.now();
      // If no name is provided, use the filename
      if (!presetData.name) {
        presetData.name = getPresetNameFromPath(filePath);
      }
    } else {
      // Unknown format
      console.error('Unknown preset format:', fileData);
      window.uiManager.setError('Unknown preset format');
      setTimeout(() => window.uiManager.clearError(), 3000);
      return;
    }
    
    // Set name to filename for display in UI
    const fileName = getPresetNameFromPath(filePath);
    presetData.name = fileName;
    
    // Check if this is first launch or app is already initialized
    const isFirstLaunch = window.isFirstLaunch === true;
    const isAppInitialized = window.app && window.app.audioManager && window.app.audioManager.workletNode;
    
    if (isFirstLaunch) {
      // For first launch, use the original behavior
      // Debug logs removed for release
      
      // Load the preset into UI
      // Debug logs removed for release
      window.uiManager.loadPreset(presetData);
      
      // Rebuild the audio pipeline to ensure audio processing works correctly
      if (window.app && window.app.audioManager) {
        try {
          // Rebuild the pipeline immediately
          // Debug logs removed for release
          await window.app.audioManager.rebuildPipeline(true);
          // Debug logs removed for release
        } catch (rebuildError) {
          console.error('Error rebuilding audio pipeline:', rebuildError);
        }
      }
    } else if (isAppInitialized) {
      // For already initialized app, use the drag & drop behavior
      // Debug logs removed for release
      
      // Check if there's an audio player active
      const hasAudioPlayer = window.uiManager && window.uiManager.audioPlayer;
      
      // If there's an audio player, we should preserve its state
      if (hasAudioPlayer) {
        // Audio player state preserved for preset loading
        
        // Load the preset
        window.uiManager.loadPreset(presetData);
        
        // Rebuild the pipeline to ensure audio processing works correctly with the new preset
        if (window.app && window.app.audioManager) {
          try {
            // Debug logs removed for release
            
            // Force disconnect all existing connections first
            if (window.app.audioManager.workletNode) {
              try {
                window.app.audioManager.workletNode.disconnect();
              } catch (e) {
                // Ignore errors if already disconnected
                // Debug logs removed for release
              }
            }
            
            // Rebuild pipeline with force flag to ensure complete rebuild
            await window.app.audioManager.rebuildPipeline(true);
            // Debug logs removed for release
            
            // Force reconnection of the audio player to the new pipeline
            if (window.uiManager.audioPlayer.contextManager) {
              try {
                window.uiManager.audioPlayer.contextManager.connectToAudioContext();
                // Debug logs removed for release
              } catch (reconnectError) {
                console.error('Error reconnecting audio player:', reconnectError);
              }
            }
          } catch (rebuildError) {
            console.error('Error rebuilding audio pipeline with audio player:', rebuildError);
          }
        }
      } else {
        // Debug logs removed for release
        window.uiManager.loadPreset(presetData);
        
        // Rebuild the pipeline to ensure audio processing works correctly with the new preset
        if (window.app && window.app.audioManager) {
          try {
            // Debug logs removed for release
            
            // Force disconnect all existing connections first
            if (window.app.audioManager.workletNode) {
              try {
                window.app.audioManager.workletNode.disconnect();
              } catch (e) {
                // Ignore errors if already disconnected
                // Debug logs removed for release
              }
            }
            
            // Rebuild pipeline with force flag to ensure complete rebuild
            await window.app.audioManager.rebuildPipeline(true);
            // Debug logs removed for release
          } catch (rebuildError) {
            console.error('Error rebuilding audio pipeline:', rebuildError);
          }
        }
      }
    } else {
      // For not yet initialized app (but not first launch), store for later use
      // Debug logs removed for release
      window.pendingPresetFilePath = filePath;
    }
    
    // Display message with filename using translation key
    window.uiManager.setError('success.presetLoaded', false, { name: fileName });
    setTimeout(() => window.uiManager.clearError(), 3000);
    
    return Promise.resolve(true);
  } catch (error) {
    console.error('Error opening preset file:', error);
    window.uiManager.setError(`Error opening preset file: ${error.message}`);
    setTimeout(() => window.uiManager.clearError(), 3000);
    return Promise.reject(error);
  }
}

/**
 * Export current preset to a file
 * @param {boolean} isElectron - Whether running in Electron environment
 */
export async function exportPreset(isElectron) {
  if (!isElectron || !window.uiManager) return;

  try {
    // Get current preset data
    const presetData = window.uiManager.getCurrentPresetData();
    if (!presetData) {
      console.error('No preset data available');
      return;
    }

    // Show save dialog
    const result = await window.electronAPI.showSaveDialog({
      title: 'Export Preset',
      defaultPath: `${presetData.name || 'preset'}.effetune_preset`,
      filters: [
        { name: 'EffeTune Preset Files', extensions: ['effetune_preset'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) return;

    // Remove name property from preset data before saving
    const { name, ...presetDataWithoutName } = presetData;
    
    // Save the preset data object without name
    const saveResult = await window.electronAPI.saveFile(
      result.filePath,
      JSON.stringify(presetDataWithoutName, null, 2)
    );

    if (!saveResult.success) {
      console.error('Failed to save preset:', saveResult.error);
    }
  } catch (error) {
    console.error('Error exporting preset:', error);
  }
}

/**
 * Import preset from a file
 * @param {boolean} isElectron - Whether running in Electron environment
 */
export async function importPreset(isElectron) {
  if (!isElectron || !window.uiManager) return;

  try {
    // Show open dialog
    const result = await window.electronAPI.showOpenDialog({
      title: 'Import Preset',
      filters: [
        { name: 'EffeTune Preset Files', extensions: ['effetune_preset'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

    // Read file
    const readResult = await window.electronAPI.readFile(result.filePaths[0]);
    
    if (!readResult.success) {
      console.error('Failed to read preset:', readResult.error);
      return;
    }

    // Parse the file content
    const fileData = JSON.parse(readResult.content);
    
    let presetData;
    
    // Handle different formats for backward compatibility
    if (Array.isArray(fileData)) {
      // Old format: direct array of pipeline plugins
      presetData = {
        name: 'Imported Preset',
        timestamp: Date.now(),
        pipeline: fileData
      };
    } else if (fileData.pipeline) {
      // New format: complete preset object
      presetData = fileData;
      // Update timestamp to current time
      presetData.timestamp = Date.now();
      // If no name is provided, use a default
      if (!presetData.name) {
        presetData.name = 'Imported Preset';
      }
    } else {
      // Unknown format
      console.error('Unknown preset format');
      return;
    }
    
    // Set name to filename for display in UI
    const fileName = getPresetNameFromPath(result.filePaths[0]);
    presetData.name = fileName;
    
    // Load the preset
    window.uiManager.loadPreset(presetData);
    
    // Display message with filename using translation key
    window.uiManager.setError('success.presetLoaded', false, { name: fileName });
    setTimeout(() => window.uiManager.clearError(), 3000);
  } catch (error) {
    console.error('Error importing preset:', error);
  }
}

/**
 * Open music file(s) for playback
 * This function is called when the user selects "Open music file..." from the File menu
 * @param {boolean} isElectron - Whether running in Electron environment
 */
export async function openMusicFile(isElectron) {
  if (!isElectron) return;
  
  try {
    // Use Electron's dialog to select music files
    const result = await window.electronAPI.showOpenDialog({
      title: 'Select Music Files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'mp4'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      console.log('File selection canceled or no files selected');
      return;
    }
    
    // Send selected files to the audio player
    if (window.uiManager) {
      // Use existing player or create a new one
      // The createAudioPlayer method now handles both cases
      window.uiManager.createAudioPlayer(result.filePaths, false); // false = don't replace existing player
    }
  } catch (error) {
    console.error('Error opening music files:', error);
    if (window.uiManager) {
      window.uiManager.setError(`Error opening music files: ${error.message}`);
    }
  }
}

/**
 * Process audio files with current effects
 * This function is called when the user selects "Process Audio Files with Effects" from the File menu
 * @param {boolean} isElectron - Whether running in Electron environment
 */
export function processAudioFiles(isElectron) {
  if (!isElectron) return;
  
  // Processing audio files from menu
  
  try {
    // Use Electron's dialog to select files directly
    // This is a more reliable approach than trying to trigger a click on a DOM element
    window.electronAPI.showOpenDialog({
      title: 'Select Audio Files to Process',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }).then(result => {
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        console.log('File selection canceled or no files selected');
        return;
      }
      
      // Selected files for processing
      
      // Find the pipeline manager
      if (!window.uiManager || !window.uiManager.pipelineManager) {
        console.error('Could not find pipeline manager');
        if (window.uiManager) {
          window.uiManager.setError('Failed to process audio files: Pipeline manager not found');
        }
        return;
      }
      
      const fileProcessor = window.uiManager.pipelineManager.fileProcessor;
      if (!fileProcessor || !fileProcessor.dropArea) {
        console.error('Could not find drop area');
        window.uiManager.setError('Failed to process audio files: Drop area not found');
        return;
      }
      
      // Get the drop area's position
      const dropAreaRect = fileProcessor.dropArea.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      
      // Calculate the scroll position to make the drop area visible
      // We want the drop area to be in the lower part of the screen, but still fully visible
      const targetScrollPosition = window.scrollY + dropAreaRect.top - (windowHeight * 0.3);
      
      // Scrolling to position for drop area
      
      // Scroll to the calculated position
      window.scrollTo({
        top: targetScrollPosition,
        behavior: 'smooth'
      });
      
      // Convert file paths to File objects
      Promise.all(result.filePaths.map(async (filePath) => {
        try {
          const bytes = await window.electronAPI.readFileBytes(filePath);
          
          // Get file name from path
          const fileName = filePath.split(/[\\/]/).pop();
          
          // Create a File object
          const blob = new Blob([bytes], { type: getAudioMimeType(fileName) });
          return new File([blob], fileName, { type: blob.type });
        } catch (error) {
          console.error(`Error processing file ${filePath}:`, error);
          window.uiManager.setError(`Error processing file ${filePath}: ${error.message}`);
          return null;
        }
      })).then(files => {
        // Filter out any failed files
        const validFiles = files.filter(file => file);
        
        if (validFiles.length === 0) {
          window.uiManager.setError('No valid audio files selected');
          return;
        }
        
        // Process the files
        setTimeout(() => {
          // Processing files with pipeline manager
          window.uiManager.pipelineManager.processDroppedAudioFiles(validFiles);
        }, 300);
      }).catch(error => {
        console.error('Error preparing files:', error);
        window.uiManager.setError(`Error preparing files: ${error.message}`);
      });
    }).catch(error => {
      console.error('Error showing open dialog:', error);
      window.uiManager.setError(`Error showing open dialog: ${error.message}`);
    });
  } catch (error) {
    console.error('Error processing audio files:', error);
    if (window.uiManager) {
      window.uiManager.setError(`Error processing audio files: ${error.message}`);
    }
  }
}

/**
 * Get MIME type for audio file based on extension
 * @param {string} fileName - File name with extension
 * @returns {string} MIME type
 */
export function getAudioMimeType(fileName) {
  const extension = fileName.split('.').pop().toLowerCase();
  const mimeTypes = {
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    'opus': 'audio/opus',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',
    'webm': 'audio/webm'
  };
  
  return mimeTypes[extension] || 'audio/mpeg'; // Default to audio/mpeg
}
