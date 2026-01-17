// electron/constants.js
let mainWindow = null;
let windowState = { width: 1440, height: 900 };
let isFirstLaunch = true;
let isSplashReload = false;
let shouldLoadPipelineState = true;
let commandLinePresetFile = null;
let savedCommandLinePresetFile = null;
let commandLineMusicFiles = [];
let savedCommandLineMusicFiles = [];
let pendingCommandLineMusicFiles = [];
let appVersion = null;
let appConfig = {};
let startupPreset = null;
let updateTrayMenuTemplate = null;
let closeTimeout = null;
let triggerClose = null;

module.exports = {
  getMainWindow: () => mainWindow,
  setMainWindow: (win) => { mainWindow = win; },

  getWindowState: () => windowState,
  setWindowState: (state) => { windowState = state; },

  getIsFirstLaunch: () => isFirstLaunch,
  setIsFirstLaunch: (flag) => { isFirstLaunch = flag; },

  getIsSplashReload: () => isSplashReload,
  setIsSplashReload: (flag) => { isSplashReload = flag; },

  getShouldLoadPipelineState: () => shouldLoadPipelineState,
  setShouldLoadPipelineState: (flag) => { shouldLoadPipelineState = flag; },

  getCommandLinePresetFile: () => commandLinePresetFile,
  setCommandLinePresetFile: (file) => { commandLinePresetFile = file; },

  getSavedCommandLinePresetFile: () => savedCommandLinePresetFile,
  setSavedCommandLinePresetFile: (file) => { savedCommandLinePresetFile = file; },

  getCommandLineMusicFiles: () => commandLineMusicFiles,
  setCommandLineMusicFiles: (files) => { commandLineMusicFiles = files },
  addCommandLineMusicFile: (file) => { commandLineMusicFiles.push(file) },
  clearCommandLineMusicFiles: () => { commandLineMusicFiles = [] },

  getSavedCommandLineMusicFiles: () => savedCommandLineMusicFiles,
  setSavedCommandLineMusicFiles: (files) => { savedCommandLineMusicFiles = files },
  addSavedCommandLineMusicFile: (file) => { 
    if (!savedCommandLineMusicFiles.includes(file)) {
      savedCommandLineMusicFiles.push(file);
    }
  },
  clearSavedCommandLineMusicFiles: () => { savedCommandLineMusicFiles = [] },

  getPendingCommandLineMusicFiles: () => pendingCommandLineMusicFiles,
  setPendingCommandLineMusicFiles: (files) => { pendingCommandLineMusicFiles = files },
  clearPendingCommandLineMusicFiles: () => { pendingCommandLineMusicFiles = [] },

  getAppVersion: () => appVersion,
  setAppVersion: (version) => { appVersion = version },

  getAppConfig: () => appConfig,
  setAppConfig: (config) => { appConfig = config },

  getStartupPreset: () => startupPreset,
  setStartupPreset: (preset) => { startupPreset = preset },

  getUpdateTrayMenuTemplate: () => updateTrayMenuTemplate,
  setUpdateTrayMenuTemplate: (func) => { updateTrayMenuTemplate = func },

  getCloseTimeout: () => closeTimeout,
  setCloseTimeout: (timeout) => { closeTimeout = timeout; },
  clearCloseTimeout: () => {
    if (closeTimeout) {
      clearTimeout(closeTimeout);
      closeTimeout = null;
    }
  },

  getTriggerClose: () => triggerClose,
  setTriggerClose: (fn) => { triggerClose = fn; },
};