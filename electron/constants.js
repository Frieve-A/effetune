// electron/constants.js

// CLI flag injected into argv when the app restarts itself (watchdog or
// HDMI-recovery IPC). The visual splash is skipped on these auto-restarts.
const AUTO_RESTART_FLAG = '--from-auto-restart';

let mainWindow = null;
let windowState = {
  bounds: { width: 1440, height: 900 },
  isMaximized: true
};
let shouldLoadPipelineState = true;
let commandLinePresetFile = null;
let commandLineMusicFiles = [];
let appVersion = null;
let appConfig = {};
let updateTrayMenuTemplate = null;
let closeTimeout = null;
let triggerClose = null;

module.exports = {
  AUTO_RESTART_FLAG,

  getMainWindow: () => mainWindow,
  setMainWindow: (win) => { mainWindow = win; },

  getWindowState: () => windowState,
  setWindowState: (state) => { windowState = state; },

  getShouldLoadPipelineState: () => shouldLoadPipelineState,
  setShouldLoadPipelineState: (flag) => { shouldLoadPipelineState = flag; },

  getCommandLinePresetFile: () => commandLinePresetFile,
  setCommandLinePresetFile: (file) => { commandLinePresetFile = file; },

  getCommandLineMusicFiles: () => commandLineMusicFiles,
  setCommandLineMusicFiles: (files) => { commandLineMusicFiles = files },
  addCommandLineMusicFile: (file) => { commandLineMusicFiles.push(file) },
  clearCommandLineMusicFiles: () => { commandLineMusicFiles = [] },

  getAppVersion: () => appVersion,
  setAppVersion: (version) => { appVersion = version },

  getAppConfig: () => appConfig,
  setAppConfig: (config) => { appConfig = config },

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
