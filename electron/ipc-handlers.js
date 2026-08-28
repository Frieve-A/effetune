const { app, ipcMain, shell, systemPreferences, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const constants = require('./constants');
const config = require('./config');
const windowState = require('./window-state');
const { registerClipboardIpcHandlers } = require('./clipboard-ipc');
const { registerIrLibraryIpc } = require('./ir-library-ipc');
const { readFileBytes } = require('./bounded-file-reader');

// Import file handlers
const fileHandlers = require('./file-handlers');

const SETTINGS_DIR_SAVE_FILE_ALLOWLIST = new Set([
  'effetune_presets.json',
  'effetune_plugin_presets.json',
  'player-state.json',
  'effetune_dbt_tests.json'
]);
const SETTINGS_DIR_SAVE_FILE_DENIAL = 'Writing to the EffeTune settings folder is not allowed: library-folders.json and other settings files are managed by the application';
const ATOMIC_FILE_WRITE_MAX_CHARS = 64 * 1024;
const NO_AUDIO_INPUT_DEVICE_ID = '__effetune_no_audio_input__';
const AUDIO_PIPELINE_DEFAULTS = Object.freeze({
  outputDeviceId: 'default',
  sampleRate: 96000,
  useInputWithPlayer: false,
  lowLatencyOutput: false,
  useWasmDsp: true,
  outputChannels: 2,
  latencyHint: 'interactive'
});
const FULL_SCREEN_EXIT_TIMEOUT_MS = 3000;
const atomicFileWrites = new Map();
let isMiniMode = false;
let wasMaximizedBeforeMiniMode = false;
let pendingMeasurementPipelineRestore = null;
let openMeasurementNavigation = null;
let mainPageNavigation = null;

function setFullscreenMenuEnabled(enabled) {
  const menuItem = Menu.getApplicationMenu?.()?.getMenuItemById?.('toggle-fullscreen');
  if (menuItem) menuItem.enabled = enabled === true;
}

function setMainMenuBarVisible(mainWin, visible) {
  if (process.platform !== 'darwin') mainWin.setMenuBarVisibility(visible);
}

function miniPlayerPlacementForWindow(mainWin) {
  const saved = windowState.getMiniPlayerState();
  if (saved?.bounds) {
    return windowState.resolveMiniPlayerBounds({
      x: saved.bounds.x,
      y: saved.bounds.y,
      ...windowState.MINI_DEFAULT_SIZE
    });
  }
  const normalBounds = mainWin.getNormalBounds();
  return windowState.resolveMiniPlayerBounds({
    x: normalBounds.x + normalBounds.width - windowState.MINI_DEFAULT_SIZE.width,
    y: normalBounds.y,
    ...windowState.MINI_DEFAULT_SIZE
  });
}

function applyMiniPlayerPlacement(mainWin, placement) {
  // The saved position is an outer-window coordinate, while the requested
  // size is the web content area. Native title and menu bars must not consume
  // the 420x120 layout space reserved for the player controls.
  mainWin.setContentSize(placement.width, placement.height);
  mainWin.setPosition(placement.x, placement.y);

  const outerBounds = mainWin.getBounds();
  const visibleBounds = windowState.resolveMiniPlayerBounds(outerBounds);
  if (visibleBounds.x !== outerBounds.x || visibleBounds.y !== outerBounds.y) {
    mainWin.setPosition(visibleBounds.x, visibleBounds.y);
  }
}

function leaveFullScreen(mainWin) {
  if (!mainWin.isFullScreen()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      mainWin.removeListener?.('leave-full-screen', onLeaveFullScreen);
      if (error) reject(error);
      else resolve();
    };
    const onLeaveFullScreen = () => finish();
    const timeoutId = setTimeout(() => {
      finish(new Error('Timed out while leaving full screen'));
    }, FULL_SCREEN_EXIT_TIMEOUT_MS);

    mainWin.once('leave-full-screen', onLeaveFullScreen);
    try {
      mainWin.setFullScreen(false);
    } catch (error) {
      finish(error);
    }
  });
}

function restoreNormalWindowShape() {
  const mainWin = constants.getMainWindow();
  if (!mainWin || mainWin.isDestroyed() || (!isMiniMode && !windowState.isMiniMode())) return false;

  windowState.exitMiniMode();
  windowState.suspendSave();
  try {
    if (mainWin.isMaximized()) mainWin.unmaximize();
    mainWin.setAlwaysOnTop(false);
    setMainMenuBarVisible(mainWin, true);
    mainWin.setResizable(true);
    mainWin.setMaximizable(true);
    mainWin.setFullScreenable(true);
    mainWin.setMinimumSize(windowState.MIN_SIZE.width, windowState.MIN_SIZE.height);
    const normalBounds = windowState.resolveWindowBoundsForRestore();
    mainWin.setBounds(normalBounds);
    if (process.platform === 'win32') mainWin.setBounds(normalBounds);
    const restoreMaximized = wasMaximizedBeforeMiniMode;
    isMiniMode = false;
    wasMaximizedBeforeMiniMode = false;
    setFullscreenMenuEnabled(true);
    if (restoreMaximized) mainWin.maximize();
  } finally {
    windowState.resumeSave();
  }
  windowState.saveWindowState();
  return true;
}

async function enterMiniPlayerMode(alwaysOnTop) {
  const mainWin = constants.getMainWindow();
  if (!mainWin || mainWin.isDestroyed()) throw new Error('Main window is not available');
  await leaveFullScreen(mainWin);
  if (mainWin.isDestroyed()) throw new Error('Main window is not available');
  if (isMiniMode) {
    const pinned = alwaysOnTop === true;
    mainWin.setAlwaysOnTop(pinned);
    windowState.setMiniPlayerAlwaysOnTop(pinned);
    setMainMenuBarVisible(mainWin, false);
    setFullscreenMenuEnabled(false);
    return;
  }

  const miniPlacement = miniPlayerPlacementForWindow(mainWin);
  wasMaximizedBeforeMiniMode = mainWin.isMaximized();
  windowState.enterMiniMode();
  windowState.suspendSave();
  try {
    if (wasMaximizedBeforeMiniMode) mainWin.unmaximize();
    setMainMenuBarVisible(mainWin, false);
    mainWin.setMinimumSize(windowState.MINI_MIN_SIZE.width, windowState.MINI_MIN_SIZE.height);
    applyMiniPlayerPlacement(mainWin, miniPlacement);
    if (process.platform === 'win32') applyMiniPlayerPlacement(mainWin, miniPlacement);
    mainWin.setResizable(false);
    mainWin.setMaximizable(true);
    mainWin.setFullScreenable(false);
    const pinned = alwaysOnTop === true;
    mainWin.setAlwaysOnTop(pinned);
    windowState.setMiniPlayerAlwaysOnTop(pinned);
    isMiniMode = true;
    setFullscreenMenuEnabled(false);
  } catch (error) {
    windowState.exitMiniMode();
    mainWin.setAlwaysOnTop(false);
    setMainMenuBarVisible(mainWin, true);
    mainWin.setResizable(true);
    mainWin.setMaximizable(true);
    mainWin.setFullScreenable(true);
    mainWin.setMinimumSize(windowState.MIN_SIZE.width, windowState.MIN_SIZE.height);
    mainWin.setBounds(windowState.resolveWindowBoundsForRestore());
    if (wasMaximizedBeforeMiniMode) mainWin.maximize();
    wasMaximizedBeforeMiniMode = false;
    throw error;
  } finally {
    windowState.resumeSave();
  }
  windowState.saveWindowState();
}

function audioPipelineConfigurationEqual(left, right) {
  if (!left || !right) return false;
  return Object.entries(AUDIO_PIPELINE_DEFAULTS).every(([key, fallback]) =>
    Object.is(left[key] ?? fallback, right[key] ?? fallback));
}

function canPersistAudioPreferencesWithoutReload(previousPreferences, nextPreferences, options) {
  const applyInPlace = options?.applyInPlace;
  if (applyInPlace === 'output-device-fallback') {
    const previousOutputDeviceId = previousPreferences?.outputDeviceId;
    if (!previousOutputDeviceId || previousOutputDeviceId === 'default' ||
        nextPreferences?.outputDeviceId !== 'default' ||
        (nextPreferences.outputDeviceLabel ?? '') !== '') {
      return false;
    }
    const ignoredKeys = new Set(['outputDeviceId', 'outputDeviceLabel']);
    const keys = new Set([
      ...Object.keys(previousPreferences || {}),
      ...Object.keys(nextPreferences || {})
    ]);
    return [...keys].every(key => ignoredKeys.has(key) ||
      Object.is(previousPreferences?.[key], nextPreferences?.[key]));
  }
  if (!audioPipelineConfigurationEqual(previousPreferences, nextPreferences)) return false;
  if (applyInPlace === 'silent-input') {
    return nextPreferences?.inputDeviceId === NO_AUDIO_INPUT_DEVICE_ID &&
      previousPreferences?.inputDeviceId !== NO_AUDIO_INPUT_DEVICE_ID;
  }
  if (applyInPlace === 'silent-input-rollback') {
    return previousPreferences?.inputDeviceId === NO_AUDIO_INPUT_DEVICE_ID &&
      nextPreferences?.inputDeviceId !== NO_AUDIO_INPUT_DEVICE_ID;
  }
  return false;
}

function normalizePathForComparison(filePath) {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function getCanonicalWriteTarget(resolvedPath) {
  try {
    return fs.realpathSync(resolvedPath);
  } catch {
    let basename = path.basename(resolvedPath);
    if (process.platform === 'win32') {
      basename = basename.replace(/[. ]+$/, '');
    }
    const unresolvedParts = [basename];
    let ancestorPath = path.dirname(resolvedPath);

    while (true) {
      try {
        return path.join(fs.realpathSync(ancestorPath), ...unresolvedParts);
      } catch {
        const parentPath = path.dirname(ancestorPath);
        if (parentPath === ancestorPath) {
          return path.join(ancestorPath, ...unresolvedParts);
        }
        unresolvedParts.unshift(path.basename(ancestorPath));
        ancestorPath = parentPath;
      }
    }
  }
}

function getCanonicalSettingsDir() {
  return getCanonicalWriteTarget(path.resolve(fileHandlers.getUserDataPath()));
}

function getSaveFileBasenameForComparison(filePath) {
  let basename = path.basename(filePath);
  if (process.platform === 'win32') {
    basename = basename.replace(/[. ]+$/, '').toLowerCase();
  }
  return basename;
}

function getSaveFileDenialReason(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null;
  const resolvedPath = path.resolve(filePath);
  if (process.platform === 'win32' && resolvedPath.replace(/^[a-zA-Z]:/, '').includes(':')) {
    return SETTINGS_DIR_SAVE_FILE_DENIAL;
  }

  const canonicalTarget = getCanonicalWriteTarget(resolvedPath);
  const canonicalSettingsDir = getCanonicalSettingsDir();
  const targetPath = normalizePathForComparison(canonicalTarget);
  const settingsPath = normalizePathForComparison(canonicalSettingsDir);
  const relativePath = path.relative(settingsPath, targetPath);
  const isInsideSettingsDir = relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  if (!isInsideSettingsDir) return null;

  const targetParent = normalizePathForComparison(path.dirname(canonicalTarget));
  if (targetParent !== settingsPath) return SETTINGS_DIR_SAVE_FILE_DENIAL;

  if (SETTINGS_DIR_SAVE_FILE_ALLOWLIST.has(getSaveFileBasenameForComparison(canonicalTarget))) {
    return null;
  }
  return SETTINGS_DIR_SAVE_FILE_DENIAL;
}

// Set the main window reference
function setMainWindow(window) {
  isMiniMode = false;
  wasMaximizedBeforeMiniMode = false;
  setFullscreenMenuEnabled(true);
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

function applyMenuItemState(id, defaults, menuState) {
  const item = { id, ...defaults };
  const state = menuState && typeof menuState === 'object' ? menuState[id] : null;
  if (!state || typeof state !== 'object') return item;
  if (typeof state.label === 'string') item.label = state.label;
  if (typeof state.enabled === 'boolean') item.enabled = state.enabled;
  if (item.type === 'checkbox' && typeof state.checked === 'boolean') {
    item.checked = state.checked;
  }
  return item;
}

function createApplicationMenuTemplate(menuState = {}) {
  const item = (id, defaults) => applyMenuItemState(id, defaults, menuState);
  const sendToRenderer = (channel, ...args) => {
    const mainWin = constants.getMainWindow();
    if (mainWin) mainWin.webContents.send(channel, ...args);
  };

  return [
    item('menu.file', {
      label: 'File',
      submenu: [
        item('file.save', {
          label: 'Save',
          accelerator: 'CommandOrControl+S',
          click: () => simulateKeyboardShortcut('S', ['control'])
        }),
        item('file.saveAs', {
          label: 'Save As...',
          accelerator: 'CommandOrControl+Shift+S',
          click: () => simulateKeyboardShortcut('S', ['control', 'shift'])
        }),
        { type: 'separator' },
        item('file.openMusicFile', {
          label: 'Open music file...',
          accelerator: 'CommandOrControl+O',
          click: () => sendToRenderer('open-music-file')
        }),
        item('file.addMusicFolder', {
          label: 'Add Music Folder...',
          click: () => sendToRenderer('add-music-folder')
        }),
        item('file.rescanLibrary', {
          label: 'Rescan Music Library',
          click: () => sendToRenderer('rescan-library')
        }),
        item('file.processAudioFiles', {
          label: 'Process Audio Files with Effects...',
          click: () => sendToRenderer('process-audio-files')
        }),
        { type: 'separator' },
        item('file.exportPreset', {
          label: 'Export Preset...',
          click: () => sendToRenderer('export-preset')
        }),
        item('file.importPreset', {
          label: 'Import Preset...',
          click: () => sendToRenderer('import-preset')
        }),
        { type: 'separator' },
        item('file.doubleBlindTest', {
          label: 'Double Blind Test',
          enabled: true,
          click: () => sendToRenderer('start-double-blind-test')
        }),
        { type: 'separator' },
        item('file.quit', { role: 'quit' })
      ]
    }),
    item('menu.edit', {
      label: 'Edit',
      submenu: [
        item('edit.undo', {
          label: 'Undo',
          accelerator: 'CommandOrControl+Z',
          click: () => simulateKeyboardShortcut('Z', ['control'])
        }),
        item('edit.redo', {
          label: 'Redo',
          accelerator: 'CommandOrControl+Y',
          click: () => simulateKeyboardShortcut('Y', ['control'])
        }),
        { type: 'separator' },
        item('edit.cut', {
          label: 'Cut',
          accelerator: 'CommandOrControl+X',
          click: () => simulateKeyboardShortcut('X', ['control'])
        }),
        item('edit.copy', {
          label: 'Copy',
          accelerator: 'CommandOrControl+C',
          click: () => simulateKeyboardShortcut('C', ['control'])
        }),
        item('edit.paste', {
          label: 'Paste',
          accelerator: 'CommandOrControl+V',
          click: () => simulateKeyboardShortcut('V', ['control'])
        }),
        { type: 'separator' },
        item('edit.delete', {
          label: 'Delete',
          accelerator: 'Delete',
          click: () => simulateKeyboardShortcut('Delete')
        }),
        item('edit.selectAll', {
          label: 'Select All',
          accelerator: 'CommandOrControl+A',
          click: () => simulateKeyboardShortcut('A', ['control'])
        })
      ]
    }),
    item('menu.view', {
      label: 'View',
      submenu: [
        item('view.reload', {
          label: 'Reload',
          accelerator: 'CommandOrControl+R',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (!mainWin) return;
            mainWin.webContents.executeJavaScript(`
              // Reset zoom before reload
              document.body.style.zoom = 1.0;
            `).catch(err => {
              console.error('Error resetting zoom before reload:', err.message || String(err));
            }).finally(() => {
              mainWin.webContents.send('reload-with-pipeline-state');
            });
          }
        }),
        { type: 'separator' },
        item('view.resetZoom', {
          label: 'Reset Zoom',
          accelerator: 'CommandOrControl+0',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (!mainWin) return;
            mainWin.webContents.executeJavaScript(`
              (function() {
                document.body.style.zoom = 1.0;
              })();
            `).catch(err => {
              console.error('Error executing zoom reset script:', err.message || String(err));
            });
          }
        }),
        item('view.zoomIn', {
          label: 'Zoom In',
          accelerator: 'CommandOrControl+=',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (!mainWin) return;
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
        }),
        item('view.zoomOut', {
          label: 'Zoom Out',
          accelerator: 'CommandOrControl+-',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (!mainWin) return;
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
        }),
        { type: 'separator' },
        item('view.effectPipeline', {
          label: 'Effect Pipeline',
          accelerator: 'CommandOrControl+E',
          click: () => sendToRenderer('open-effect-pipeline-view')
        }),
        item('view.musicLibrary', {
          label: 'Music Library',
          accelerator: 'CommandOrControl+L',
          click: () => sendToRenderer('open-library-view')
        }),
        item('view.pipelineAnalyzer', {
          label: 'Pipeline Analyzer',
          type: 'checkbox',
          checked: false,
          click: menuItem => sendToRenderer('set-pipeline-analyzer-open', menuItem.checked === true)
        }),
        { type: 'separator' },
        item('toggle-fullscreen', {
          role: 'togglefullscreen',
          enabled: !isMiniMode
        }),
        item('view.miniPlayer', {
          label: 'Mini Player',
          accelerator: 'CommandOrControl+Shift+M',
          click: () => sendToRenderer('toggle-mini-player')
        })
      ]
    }),
    item('menu.settings', {
      label: 'Settings',
      submenu: [
        item('settings.config', {
          label: 'Config...',
          click: () => sendToRenderer('config-app')
        }),
        item('settings.audioDevices', {
          label: 'Audio Devices...',
          click: () => sendToRenderer('config-audio')
        }),
        item('settings.performanceBenchmark', {
          label: 'Performance Benchmark',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (!mainWin) return;
            restoreNormalWindowShape();
            mainWin.loadFile('features/effetune_bench.html');
          }
        }),
        item('settings.frequencyResponseMeasurement', {
          label: 'Frequency Response Measurement',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (!mainWin) return;
            restoreNormalWindowShape();
            mainWin.webContents.send('open-frequency-response-measurement');
          }
        })
      ]
    }),
    item('menu.help', {
      label: 'Help',
      submenu: [
        item('help.help', {
          label: 'Help',
          accelerator: 'F1',
          click: () => {
            const mainWin = constants.getMainWindow();
            if (!mainWin?.webContents) return;
            mainWin.webContents.executeJavaScript(`
              const whatsThisLink = document.querySelector('.whats-this');
              if (whatsThisLink) {
                whatsThisLink.click();
              }
            `).catch(error => {
              console.error('Error executing Help menu action:', error);
            });
          }
        }),
        item('help.discord', {
          label: 'Discord',
          click: () => shell.openExternal('https://discord.gg/gf95v3Gza2')
        }),
        item('help.support', {
          label: 'Support the Project',
          click: () => shell.openExternal('https://ko-fi.com/frievea')
        }),
        { type: 'separator' },
        item('help.about', {
          label: 'About',
          click: () => sendToRenderer('show-about-dialog', {
            version: constants.getAppVersion(),
            icon: path.join(__dirname, '../images/favicon.ico')
          })
        })
      ]
    })
  ];
}

function createMenu(menuState = {}) {
  const menu = Menu.buildFromTemplate(createApplicationMenuTemplate(menuState));
  Menu.setApplicationMenu(menu);
}

// Register all IPC handlers
function registerIpcHandlers() {
  registerIrLibraryIpc({ ipcMain, getUserDataPath: fileHandlers.getUserDataPath });
  ipcMain.handle('set-mini-player-mode', async (event, options = {}) => {
    if (options?.enabled === true) {
      await enterMiniPlayerMode(options.alwaysOnTop === true);
    } else {
      restoreNormalWindowShape();
    }
    return { success: true, enabled: isMiniMode };
  });

  ipcMain.handle('set-always-on-top', (event, flag) => {
    const mainWin = constants.getMainWindow();
    if (!isMiniMode || !mainWin || mainWin.isDestroyed()) {
      throw new Error('Always on top is only available in mini player mode');
    }
    const enabled = flag === true;
    mainWin.setAlwaysOnTop(enabled);
    windowState.setMiniPlayerAlwaysOnTop(enabled);
    return { success: true, enabled };
  });

  // Get first launch flag
  ipcMain.handle('get-first-launch-flag', () => {
    return constants.getIsFirstLaunch();
  });

  ipcMain.handle('get-window-visibility', () => {
    const mainWin = constants.getMainWindow();
    if (!mainWin || mainWin.isDestroyed()) return { hidden: true };
    return {
      hidden: mainWin.isMinimized?.() === true || mainWin.isVisible?.() === false
    };
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

  ipcMain.handle('open-playback-selection', async () => {
    return await fileHandlers.openPlaybackSelection();
  });

  // File operations
  ipcMain.handle('save-file', async (event, filePath, content) => {
    const denialReason = getSaveFileDenialReason(filePath);
    if (denialReason) {
      return {
        success: false,
        error: denialReason
      };
    }
    return await fileHandlers.saveFile(filePath, content);
  });

  ipcMain.handle('begin-atomic-file-write', async (event, filePath) => {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      return { success: false, error: 'Invalid atomic file write target.' };
    }
    const denialReason = getSaveFileDenialReason(filePath);
    if (denialReason) return { success: false, error: denialReason };
    const token = crypto.randomUUID();
    const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${token}.tmp`);
    try {
      const handle = await fs.promises.open(tempPath, 'wx');
      atomicFileWrites.set(token, {
        senderId: event?.sender?.id ?? 0,
        filePath,
        tempPath,
        handle
      });
      return { success: true, token };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-atomic-file-chunk', async (event, token, chunk) => {
    const session = atomicFileWrites.get(token);
    if (!session || session.senderId !== (event?.sender?.id ?? 0) || typeof chunk !== 'string' ||
        chunk.length > ATOMIC_FILE_WRITE_MAX_CHARS) {
      return { success: false, error: 'Invalid atomic file write chunk.' };
    }
    try {
      await session.handle.writeFile(chunk, 'utf8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('commit-atomic-file-write', async (event, token) => {
    const session = atomicFileWrites.get(token);
    if (!session || session.senderId !== (event?.sender?.id ?? 0)) {
      return { success: false, error: 'Invalid atomic file write session.' };
    }
    atomicFileWrites.delete(token);
    try {
      await session.handle.sync();
      await session.handle.close();
      await fs.promises.rename(session.tempPath, session.filePath);
      return { success: true };
    } catch (error) {
      await session.handle.close().catch(() => {});
      await fs.promises.unlink(session.tempPath).catch(() => {});
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('abort-atomic-file-write', async (event, token) => {
    const session = atomicFileWrites.get(token);
    if (!session || session.senderId !== (event?.sender?.id ?? 0)) return { success: true };
    atomicFileWrites.delete(token);
    await session.handle.close().catch(() => {});
    await fs.promises.unlink(session.tempPath).catch(() => {});
    return { success: true };
  });

  ipcMain.handle('read-file', async (event, filePath) => {
    return await fileHandlers.readFile(filePath);
  });

  registerClipboardIpcHandlers(ipcMain, clipboard);
  ipcMain.handle('read-file-bytes', async (event, filePath, expectedByteLength) => {
    if (expectedByteLength !== undefined &&
        (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 0)) {
      const error = new TypeError('Expected file size must be a nonnegative safe integer');
      error.code = 'ERR_INVALID_EXPECTED_BYTE_LENGTH';
      throw error;
    }
    return await readFileBytes(filePath, expectedByteLength);
  });

  // Request macOS microphone TCC permission from the main process.
  // Must be called before getUserMedia() in the renderer; otherwise macOS never
  // shows the privacy dialog and CoreAudio silently denies access.
  ipcMain.handle('request-microphone-access', async () => {
    if (process.platform !== 'darwin') return true;
    try {
      const status = await systemPreferences.getMediaAccessStatus('microphone');
      if (status === 'granted') return true;
      return await systemPreferences.askForMediaAccess('microphone');
    } catch (error) {
      console.error('Error requesting microphone access:', error);
      return false;
    }
  });

  // Get audio devices
  ipcMain.handle('get-audio-devices', async () => {
    try {
      // Enumerate devices without prompting for microphone access. Actual input
      // permission is requested only when the selected input is opened.
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
  ipcMain.handle('save-audio-preferences', async (event, preferences, options = {}) => {
    try {
      const userDataPath = fileHandlers.getUserDataPath();
      const prefsPath = path.join(userDataPath, 'audio-preferences.json');
      let previousPreferences = { inputDeviceId: 'default' };
      if (fs.existsSync(prefsPath)) {
        try {
          previousPreferences = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        } catch (error) {
          console.warn('Replacing unreadable audio preferences:', error);
        }
      }
      const persistWithoutReload = canPersistAudioPreferencesWithoutReload(
        previousPreferences,
        preferences,
        options
      );
      
      // Ensure the directory exists
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      
      fs.writeFileSync(prefsPath, JSON.stringify(preferences, null, 2));
      
      // Show message that audio settings are saved and the application will reload shortly
      const mainWin = constants.getMainWindow();
      if (mainWin && !persistWithoutReload) {
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
      const saved = config.saveConfig(current);
      if (saved !== true) {
        return { success: false, error: 'Failed to write config file' };
      }
      constants.setAppConfig(current);
      try {
        app.setLoginItemSettings({ openAtLogin: !!current.autoLaunch });
      } catch (error) {
        console.error('Config saved, but failed to update the auto-launch setting:', error);
        return {
          success: true,
          warning: `Failed to update the auto-launch setting: ${error.message}`
        };
      }
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
        
        const isDirectoryPath = url === '/' || url.endsWith('/');
        if (!isDirectoryPath) {
          // Remove any existing extension and add .html
          url = url.replace(/\.[^/.]+$/, '') + '.html';
        }
        
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

  // Handle save pipeline state to file request
  ipcMain.handle('save-pipeline-state-to-file', async (event, pipelineState) => {
    return await fileHandlers.savePipelineStateToFile(pipelineState);
  });

  ipcMain.handle('open-frequency-response-measurement', (event, pipelineState) => {
    if (openMeasurementNavigation) return openMeasurementNavigation;

    openMeasurementNavigation = (async () => {
      const mainWin = constants.getMainWindow();
      if (!mainWin) {
        return { success: false, error: 'Main window not available' };
      }

      try {
        const saveResult = await fileHandlers.savePipelineStateToFile(pipelineState, {
          allowEmpty: true
        });
        if (!saveResult?.success) {
          console.error('Failed to save pipeline state before opening Frequency Response Measurement:', saveResult?.error);
          return { success: false, error: 'The effect pipeline could not be saved.' };
        }

        restoreNormalWindowShape();
        await mainWin.loadFile('features/measurement/measurement.html');
        pendingMeasurementPipelineRestore = {};
        return { success: true };
      } catch (error) {
        console.error('Failed to open Frequency Response Measurement:', error);
        return { success: false, error: 'Frequency Response Measurement could not be opened.' };
      }
    })().finally(() => {
      openMeasurementNavigation = null;
    });
    return openMeasurementNavigation;
  });

  // Handle pipeline state response for window close
  ipcMain.on('pipeline-state-for-close', async (event, pipelineState) => {
    // Clear the close timeout
    constants.clearCloseTimeout();

    // Save the pipeline state
    if (pipelineState) {
      try {
        const result = await fileHandlers.savePipelineStateToFile(pipelineState);
        if (result && !result.success) {
          console.error('Failed to save pipeline state on close:', result.error);
        }
      } catch (error) {
        console.error('Failed to save pipeline state on close:', error);
      }
    }

    // Trigger the actual window close
    try {
      const triggerClose = constants.getTriggerClose();
      if (triggerClose) {
        triggerClose();
      }
    } catch (error) {
      console.error('Failed to trigger window close:', error);
      const mainWin = constants.getMainWindow();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.destroy();
      }
      app.quit();
    }
  });

  // Handle window reload request
  ipcMain.handle('reload-window', async (event, pipelineState) => {
    const mainWin = constants.getMainWindow();
    if (!mainWin) {
      return { success: false, error: 'Main window not available' };
    }

    if (pipelineState === undefined) {
      mainWin.reload();
      return { success: true };
    }

    try {
      const saveResult = await fileHandlers.savePipelineStateToFile(pipelineState, {
        allowEmpty: true
      });
      if (!saveResult?.success) {
        console.error('Failed to save pipeline state before reload:', saveResult?.error);
        return { success: false, error: 'The effect pipeline could not be saved.' };
      }

      await mainWin.loadFile('effetune.html', {
        query: { restorePipeline: 'transient' }
      });
      return { success: true };
    } catch (error) {
      console.error('Failed to reload the application:', error);
      return { success: false, error: 'The application could not be reloaded.' };
    }
  });

  // Handle full app relaunch (used for HDMI reconnect recovery on macOS,
  // where renderer-process restart is required to recover audio output).
  // Re-throw on failure so the renderer can fall back to window.location.reload().
  ipcMain.handle('relaunch-app', () => {
    try {
      app.relaunch({ args: [...process.argv.slice(1), constants.AUTO_RESTART_FLAG] });
      app.exit(0);
    } catch (error) {
      console.error('[relaunch-app] Failed to relaunch app:', error);
      throw error;
    }
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
  ipcMain.handle('update-application-menu', (event, menuState) => {
    try {
      createMenu(menuState);
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
    if (mainPageNavigation) return mainPageNavigation;

    mainPageNavigation = (async () => {
      try {
        const mainWin = constants.getMainWindow();
        if (mainWin) {
          // Restore the default menu first
          createMenu();
          // Then navigate back to the main page
          const restorePipeline = pendingMeasurementPipelineRestore;
          if (restorePipeline) {
            await mainWin.loadFile('effetune.html', {
              query: { restorePipeline: 'transient' }
            });
            if (pendingMeasurementPipelineRestore === restorePipeline) {
              pendingMeasurementPipelineRestore = null;
            }
          } else {
            await mainWin.loadFile('effetune.html');
          }
          return { success: true };
        }
        return { success: false, error: 'Main window not available' };
      } catch (error) {
        console.error('Error navigating to main page:', error);
        return { success: false, error: error.message };
      }
    })().finally(() => {
      mainPageNavigation = null;
    });
    return mainPageNavigation;
  });

}

// Export functions
module.exports = {
  setMainWindow,
  registerIpcHandlers,
  createMenu,
  simulateKeyboardShortcut,
  restoreNormalWindowShape
};
