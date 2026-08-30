// electron/file-utils.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function openTemporarySaveFile(filePath) {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  for (let attempt = 0; attempt < 3; attempt++) {
    const temporaryPath = path.join(
      directory,
      `.${baseName}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    try {
      return { descriptor: fs.openSync(temporaryPath, 'wx'), temporaryPath };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Unable to create a temporary save file');
}

// Save file
async function saveFile(filePath, content) {
  let descriptor = null;
  let temporaryPath = null;
  try {
    // Check if content is a base64 string (from binary file)
    const data = typeof content === 'string' && content.match(/^[A-Za-z0-9+/=]+$/)
      ? Buffer.from(content, 'base64')
      : content;

    const temporaryFile = openTemporarySaveFile(filePath);
    descriptor = temporaryFile.descriptor;
    temporaryPath = temporaryFile.temporaryPath;
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporaryPath, filePath);
    temporaryPath = null;
    return { success: true };
  } catch (error) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch (closeError) {
        console.warn('Failed to close temporary save file:', closeError);
      }
    }
    if (temporaryPath !== null) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          console.warn('Failed to remove temporary save file:', cleanupError);
        }
      }
    }
    console.error('Error saving file:', error);
    return { success: false, error: error.message };
  }
}

// Read file
async function readFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Check if file exists
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// Join paths
function joinPaths(basePath, ...paths) {
  return path.join(basePath, ...paths);
}

// Save pipeline state to file
async function savePipelineStateToFile(pipelineState, userDataPath, { allowEmpty = false } = {}) {
  try {
    // Skip saving if pipeline state is empty
    if (!pipelineState) {
      return { success: false, error: 'Empty pipeline state' };
    }
    
    // Handle dual pipeline format (object with pipelineA, pipelineB, currentPipeline)
    if (pipelineState.pipelineA !== undefined) {
      const hasValidPipelines = Array.isArray(pipelineState.pipelineA) &&
        (pipelineState.pipelineB === null ||
         pipelineState.pipelineB === undefined ||
         Array.isArray(pipelineState.pipelineB));
      if (!hasValidPipelines) {
        return { success: false, error: 'Invalid pipeline state format' };
      }
      // Check if at least one pipeline has content
      const hasContent = pipelineState.pipelineA.length > 0 ||
                         (Array.isArray(pipelineState.pipelineB) && pipelineState.pipelineB.length > 0);
      if (!hasContent && !allowEmpty) {
        return { success: false, error: 'Empty pipeline state' };
      }
    } else if (Array.isArray(pipelineState)) {
      // Handle old single pipeline format (array)
      if (pipelineState.length === 0) {
        return { success: false, error: 'Empty pipeline state' };
      }
    } else {
      return { success: false, error: 'Invalid pipeline state format' };
    }
    
    // Use path.join for cross-platform compatibility
    const filePath = path.join(userDataPath, 'pipeline-state.json');
    
    // Ensure the directory exists
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    
    // Save pipeline state to file
    fs.writeFileSync(filePath, JSON.stringify(pipelineState, null, 2));
    
    return { success: true };
  } catch (error) {
    console.error('Failed to save pipeline state to file:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  saveFile,
  readFile,
  fileExists,
  joinPaths,
  savePipelineStateToFile
};
