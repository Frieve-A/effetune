const {
  app,
  BrowserWindow,
  WebContentsView,
  components,
  session,
  Tray,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  MessageChannelMain,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  shell,
  utilityProcess
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Set package storage before configuration, session, or instance initialization.
if (process.windowsStore === true) {
  const storeDataPath = path.join(app.getPath('appData'), 'EffeTune Store');
  fs.mkdirSync(storeDataPath, { recursive: true });
  app.setPath('userData', storeDataPath);
  app.setPath('sessionData', storeDataPath);
}

// Import modules
const constants = require('./constants');
const configModule = require('./config');
const windowState = require('./window-state');
const { createStartupPresentation } = require('./startup-presentation.cjs');
const ipcHandlers = require('./ipc-handlers');
const visualizerFeed = require('./visualizer-feed');
const { createBrowserController } = require('./browser-controller.cjs');
const fileHandlers = require('./file-handlers');
const fileAccess = require('./file-access.cjs');
const { queueAutoRestart } = require('./relaunch');
const { initializeGpuAcceleration } = require('./gpu-acceleration.cjs');
const { createLibraryDialogTranslator } = require('./library-dialog-localization.cjs');
const { armQuitDeadline, QUIT_DEADLINE_DEFAULT_TIMEOUT_SECONDS } = require('./quit-deadline.cjs');
const { createInstanceRegistry } = require('./instance-registry.cjs');
const { createAppUpdater } = require('./app-updater.cjs');
const { AlacPlaybackSource } = require('./alac-playback-source.cjs');
const {
  LibraryCatalogRecovery,
  registerLibraryCatalogRecoveryIpc
} = require('./library-catalog-recovery.cjs');
const {
  createOpenHomeControlHost,
  registerOpenHomeIpc
} = require('./openhome-control-host.cjs');
const { createAirPlayReceiverHost } = require('./airplay-receiver.cjs');
const { registerAirPlayIpc } = require('./airplay-ipc.cjs');
const { RemoteControlHost, registerRemoteControlIpc } = require('./remote-control-host.cjs');
const { LocalOpenHomePlayer } = require('./pwa-network-host.cjs');
const { NetworkMusicHost, registerNetworkMusicIpc } = require('./network-music-host.cjs');
const { registerIntegratedRemoteClientIpc } = require('./remote-client-window.cjs');
const releaseVersionModulePromise = import(pathToFileURL(
  path.join(__dirname, '../js/release-version.mjs')
).href);

// Get app version from package.json
const packageJson = require('../package.json');
const appVersion = packageJson.version;
constants.setAppVersion(appVersion);

const PLAYBACK_AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'opus', 'm4a', 'aac', 'webm', 'mp4', 'm4v', 'mov', 'mkv', '3gp'];
const PLAYBACK_AUDIO_EXTENSION_PATTERN = new RegExp(`\\.(${PLAYBACK_AUDIO_EXTENSIONS.join('|')})$`, 'i');

function isSupportedPlaybackAudioPath(filePath) {
  return PLAYBACK_AUDIO_EXTENSION_PATTERN.test(filePath || '');
}

let themeRegistry;
let browserController;

function applyNativeTheme(config) {
  const preset = themeRegistry.getThemePreset(config?.theme);
  nativeTheme.themeSource = preset.colorScheme;
  void browserController?.updateTheme(preset);
}

let tray = null;
let isAppQuitting = false;
let appServicesShutdownReady = false;
let instanceRegistry = null;
let quitProtectionArmed = false;
// A predecessor that is still shutting down gets the quit deadline plus a
// small margin before this process opens its own storage.
const PREDECESSOR_WAIT_MS = (QUIT_DEADLINE_DEFAULT_TIMEOUT_SECONDS + 5) * 1000;

// Records this process as quitting and arms the external quit deadline so a
// shutdown blocked inside Chromium or a third-party driver can never leave a
// zombie holding the browser storage lock files.
function armQuitProtection() {
  if (quitProtectionArmed) return;
  quitProtectionArmed = true;
  try {
    instanceRegistry?.markQuitting();
  } catch (error) {
    console.error('Instance registry update failed:', error?.code || error?.name || 'unknown');
  }
  armQuitDeadline({ timeoutSeconds: QUIT_DEADLINE_DEFAULT_TIMEOUT_SECONDS });
}

async function waitForPredecessorShutdown() {
  try {
    instanceRegistry = createInstanceRegistry({ userDataPath: fileHandlers.getUserDataPath() });
    const result = await instanceRegistry.waitForQuittingPredecessors({ timeoutMs: PREDECESSOR_WAIT_MS });
    if (result.waitedMs > 0) {
      console.log(`[instances] waited ${result.waitedMs}ms for a quitting predecessor`);
    }
    instanceRegistry.register();
  } catch (error) {
    console.error('Instance registry unavailable:', error?.code || error?.name || 'unknown');
  }
}
let libraryServiceCoordinator = null;
let disposeLibraryServiceIpc = null;
let libraryCatalogScanRuntime = null;
let disposeLibraryCatalogControlIpc = null;
let libraryCatalogUtilityHost = null;
let disposeLibraryCatalogIpc = null;
let disposeLibraryCatalogFailureListener = null;
let libraryCatalogRecovery = null;
let disposeLibraryCatalogRecoveryIpc = null;
let libraryCatalogClosePromise = null;
let openHomeControlHost = null;
let airPlayReceiverHost = null;
let disposeAirPlayIpc = null;
let networkMusicHost = null;
let disposeNetworkMusicIpc = null;
let disposeIntegratedRemoteClientIpc = null;
let disposeOpenHomeIpc = null;
let remoteControlHost = null;
let disposeRemoteControlIpc = null;
let disposePowerMonitorEvents = null;
let alacPlaybackSource = null;
let appServicesClosePromise = null;

async function closeLibraryCatalogServices() {
  const utilityHost = libraryCatalogUtilityHost;
  libraryCatalogUtilityHost = null;
  disposeLibraryCatalogFailureListener?.();
  disposeLibraryCatalogFailureListener = null;
  disposeLibraryCatalogIpc?.();
  disposeLibraryCatalogIpc = null;
  disposeLibraryCatalogControlIpc?.();
  disposeLibraryCatalogControlIpc = null;
  disposeLibraryServiceIpc?.();
  disposeLibraryServiceIpc = null;
  libraryCatalogScanRuntime = null;
  libraryServiceCoordinator = null;
  await utilityHost?.close();
}

async function openLibraryCatalogServices({ catalogDirectory, catalogPath }) {
  const [catalogHost, utilityHostModule, serviceCoordinator] = [
    require('./library-catalog-host.cjs'),
    require('./library-catalog-utility-host.cjs'),
    require('./library-service-coordinator.cjs')
  ];
  const {
    registerLibraryCatalogIpc,
    registerLibraryCatalogControlIpc
  } = catalogHost;
  const { LibraryCatalogUtilityHost } = utilityHostModule;
  const { registerLibraryServiceIpc } = serviceCoordinator;
  fs.mkdirSync(catalogDirectory, { recursive: true });
  const utilityHost = await LibraryCatalogUtilityHost.open({
    dialog,
    getMainWindow: () => constants.getMainWindow(),
    translate: createLibraryDialogTranslator({
      getLanguagePreference: () => constants.getAppConfig()?.language,
      getSystemLocale: () => app.getLocale()
    }),
    dbPath: catalogPath,
    imageAdapter: nativeImage,
    processFactory: modulePath => utilityProcess.fork(modulePath, [], {
      serviceName: 'Effetune Music Library'
    })
  });
  let published = false;
  let startupFailure = utilityHost.failure;
  const handleFailure = error => {
    if (!published) {
      startupFailure ??= error;
      return;
    }
    if (libraryCatalogUtilityHost !== utilityHost) return;
    console.error(
      'The music library catalog became unavailable:',
      String(error?.code || error?.name || 'catalogUnavailable').slice(0, 128)
    );
    void libraryCatalogRecovery?.markUnavailable(error);
  };
  utilityHost.repository.once('failure', handleFailure);
  let disposeRepositoryIpc = null;
  let disposeControlIpc = null;
  let disposeServiceIpc = null;
  try {
    if (startupFailure) throw startupFailure;
    disposeRepositoryIpc = registerLibraryCatalogIpc({
      ipcMain,
      host: utilityHost.repository,
      getMainWindow: () => constants.getMainWindow()
    });
    disposeControlIpc = registerLibraryCatalogControlIpc({
      ipcMain,
      runtime: utilityHost.runtime,
      shell,
      getMainWindow: () => constants.getMainWindow()
    });
    disposeServiceIpc = registerLibraryServiceIpc({
      ipcMain,
      coordinator: utilityHost.coordinator,
      getMainWindow: () => constants.getMainWindow()
    });
    if (utilityHost.failure) throw utilityHost.failure;
  } catch (error) {
    utilityHost.repository.removeListener('failure', handleFailure);
    disposeServiceIpc?.();
    disposeControlIpc?.();
    disposeRepositoryIpc?.();
    await utilityHost.close();
    throw error;
  }

  libraryCatalogUtilityHost = utilityHost;
  libraryCatalogScanRuntime = utilityHost.runtime;
  libraryServiceCoordinator = utilityHost.coordinator;
  disposeLibraryCatalogIpc = disposeRepositoryIpc;
  disposeLibraryCatalogControlIpc = disposeControlIpc;
  disposeLibraryServiceIpc = disposeServiceIpc;
  published = true;
  networkMusicHost?.emitState();
  disposeLibraryCatalogFailureListener = () => {
    utilityHost.repository.removeListener('failure', handleFailure);
  };
}

async function closeLibraryCatalogRecovery() {
  if (libraryCatalogClosePromise) return libraryCatalogClosePromise;
  disposeLibraryCatalogRecoveryIpc?.();
  disposeLibraryCatalogRecoveryIpc = null;
  const recovery = libraryCatalogRecovery;
  libraryCatalogClosePromise = (async () => {
    if (recovery) await recovery.close();
    else await closeLibraryCatalogServices();
    if (libraryCatalogRecovery === recovery) libraryCatalogRecovery = null;
  })();
  return libraryCatalogClosePromise;
}

async function closeApplicationServices() {
  if (appServicesClosePromise) return appServicesClosePromise;
  disposePowerMonitorEvents?.();
  disposePowerMonitorEvents = null;
  disposeOpenHomeIpc?.();
  disposeOpenHomeIpc = null;
  disposeAirPlayIpc?.();
  disposeAirPlayIpc = null;
  disposeNetworkMusicIpc?.();
  disposeNetworkMusicIpc = null;
  disposeIntegratedRemoteClientIpc?.();
  disposeIntegratedRemoteClientIpc = null;
  const musicHost = networkMusicHost;
  networkMusicHost = null;
  const openHomeHost = openHomeControlHost;
  openHomeControlHost = null;
  const airPlayHost = airPlayReceiverHost;
  airPlayReceiverHost = null;
  const remoteHost = remoteControlHost;
  remoteControlHost = null;
  const playbackSource = alacPlaybackSource;
  alacPlaybackSource = null;
  appServicesClosePromise = Promise.all([
    Promise.resolve(musicHost?.dispose()).then(() => closeLibraryCatalogRecovery()),
    openHomeHost?.dispose(),
    airPlayHost?.dispose(),
    remoteHost?.dispose(),
    playbackSource?.dispose()
  ]);
  return appServicesClosePromise;
}

// Keep the main window hidden until the renderer has prepared its initial view.
let pendingMainWindowShow = false;
let splashWindow = null;
let splashCloseTimer = null;
const SPLASH_DURATION_MS = 3000;
let startupUpdateCheckPending = !process.argv.includes(constants.AUTO_RESTART_FLAG);

function closeSplashScreen() {
  clearTimeout(splashCloseTimer);
  splashCloseTimer = null;
  const window = splashWindow;
  splashWindow = null;
  if (!window || window.isDestroyed()) return;
  window.close();
}

// Renderer watchdog state — delayed pings diagnose a stall, but cannot
// distinguish a frozen renderer from CPU or I/O contention. Keep the process
// and its unsaved state alive regardless of how long the delay lasts.
const WATCHDOG_PING_INTERVAL_MS = 2000;
const WATCHDOG_THRESHOLD_MS = 15000;
let lastRendererPing = 0;
let watchdogIntervalId = null;
let watchdogArmed = false;
let watchdogArmedBeforeSystemSuspend = false;
let watchdogSystemSuspended = false;
let watchdogStallReported = false;

function armRendererWatchdog(reason = 'renderer') {
  if (isAppQuitting) return;
  if (watchdogSystemSuspended) return;
  lastRendererPing = Date.now();
  watchdogStallReported = false;
  if (!watchdogArmed) {
    watchdogArmed = true;
    console.log(`[watchdog] armed (${reason})`);
  }
}

function disarmRendererWatchdog(reason = 'navigation') {
  if (watchdogArmed) {
    console.log(`[watchdog] disarmed (${reason})`);
  }
  watchdogArmed = false;
  lastRendererPing = 0;
  watchdogStallReported = false;
}

function rendererPingReceived() {
  if (isAppQuitting || watchdogSystemSuspended) return;
  if (!watchdogArmed) {
    armRendererWatchdog('renderer-ping');
    return;
  }
  const now = Date.now();
  if (watchdogStallReported) {
    console.log(`[watchdog] Renderer responsive again after ${now - lastRendererPing}ms`);
    watchdogStallReported = false;
  }
  lastRendererPing = now;
}

function startWatchdog() {
  if (watchdogIntervalId) return;
  watchdogIntervalId = setInterval(() => {
    if (!watchdogArmed || isAppQuitting || watchdogStallReported) return;
    const elapsed = Date.now() - lastRendererPing;
    if (elapsed <= WATCHDOG_THRESHOLD_MS) return;

    watchdogStallReported = true;
    console.warn(`[watchdog] Renderer heartbeat delayed by ${elapsed}ms; waiting for recovery`);
  }, WATCHDOG_PING_INTERVAL_MS);
}

function stopWatchdog() {
  if (watchdogIntervalId) {
    clearInterval(watchdogIntervalId);
    watchdogIntervalId = null;
  }
  disarmRendererWatchdog('shutdown');
  watchdogArmedBeforeSystemSuspend = false;
  watchdogSystemSuspended = false;
}

function updateOpenHomeEnvironmentAvailability(available) {
  void airPlayReceiverHost?.setEnvironmentAvailable(available)?.catch(error => {
    console.error('AirPlay power lifecycle diagnostic:', error);
  });
  const host = openHomeControlHost;
  if (!host) return;
  void host.setEnvironmentAvailable(available).catch(error => {
    console.error(
      'OpenHome power lifecycle diagnostic:',
      String(error?.code || error?.name || 'environment-update-failed').slice(0, 128)
    );
  });
}

function handleSystemSuspendForWatchdog() {
  watchdogArmedBeforeSystemSuspend = watchdogArmedBeforeSystemSuspend || watchdogArmed;
  watchdogSystemSuspended = true;
  disarmRendererWatchdog('system-suspend');
  updateOpenHomeEnvironmentAvailability(false);
}

function handleSystemResumeForWatchdog() {
  const shouldRearm = watchdogArmedBeforeSystemSuspend || watchdogArmed;
  watchdogArmedBeforeSystemSuspend = false;
  watchdogSystemSuspended = false;
  if (shouldRearm) armRendererWatchdog('system-resume');
  updateOpenHomeEnvironmentAvailability(true);
  const mainWindow = constants.getMainWindow();
  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system-resume');
  }
}

function registerWatchdogPowerEvents() {
  if (disposePowerMonitorEvents) return;
  // Date.now() advances while the computer sleeps. Pause diagnostics too so
  // the first timer after wake does not report normal sleep as a renderer stall.
  powerMonitor.on('suspend', handleSystemSuspendForWatchdog);
  powerMonitor.on('resume', handleSystemResumeForWatchdog);
  disposePowerMonitorEvents = () => {
    powerMonitor.removeListener('suspend', handleSystemSuspendForWatchdog);
    powerMonitor.removeListener('resume', handleSystemResumeForWatchdog);
  };
}

// Renderer-ping IPC: registered here (not in ipc-handlers.js) so it can update
// the watchdog state directly without a circular dependency.
ipcMain.on('renderer-ping', () => {
  rendererPingReceived();
});

ipcMain.handle('renderer-watchdog-arm', (_event, reason) => {
  armRendererWatchdog(reason || 'renderer-request');
  return { success: true };
});

ipcMain.handle('renderer-watchdog-disarm', (_event, reason) => {
  disarmRendererWatchdog(reason || 'renderer-request');
  return { success: true };
});

// macOS only: tell Chromium to auto-approve getUserMedia() without showing its
// own permission UI.  The actual hardware access still goes through macOS TCC,
// so the system-level microphone permission is still respected and the
// menu-bar indicator appears when audio is captured.
// Not applied on Windows/Linux because those platforms have no equivalent
// system-level dialog, so silently auto-granting media-stream access there
// would weaken the security posture without a corresponding benefit.
// Must be set before app.ready.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

// Chromium 152 requires a child-process capability in addition to the Web MIDI
// permission granted below, but Electron 44 does not propagate its basic MIDI
// grant to that capability. Without this compatibility switch, even non-SysEx
// requestMIDIAccess() calls always fail with NotAllowedError. EffeTune blocks
// renderer navigation and requests only non-SysEx MIDI, so this restores the
// trusted-renderer access intended by the explicit session permission below.
if (process.versions.electron?.startsWith('44.')) {
  const disabledFeatures = app.commandLine.getSwitchValue('disable-features')
    .split(',')
    .map(feature => feature.trim())
    .filter(Boolean);
  if (!disabledFeatures.includes('BlockMidiByDefault')) {
    disabledFeatures.push('BlockMidiByDefault');
    app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
  }
}

// Preserve HDR video values in the Visualizer's float16 Canvas intermediates.
// The renderer enables this only for HDR output and falls back to SDR when unavailable.
const enabledBlinkFeatures = app.commandLine.getSwitchValue('enable-blink-features')
  .split(',')
  .map(feature => feature.trim())
  .filter(Boolean);
if (!enabledBlinkFeatures.includes('CanvasGlobalHDRHeadroom')) {
  enabledBlinkFeatures.push('CanvasGlobalHDRHeadroom');
  app.commandLine.appendSwitch('enable-blink-features', enabledBlinkFeatures.join(','));
}

// OpenHome transport commands arrive over IPC and therefore cannot carry a
// Chromium transient user activation. Allow the desktop audio player to honor
// those explicit remote playback commands.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function presentMainWindow(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
}

function sendWindowVisibilityState(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
  const hidden = mainWindow.isMinimized() || !mainWindow.isVisible();
  mainWindow.webContents.send('window-visibility-changed', { hidden });
}

// Create the main application window
function createWindow() {
  const preset = themeRegistry.getThemePreset(constants.getAppConfig()?.theme);
  windowState.prepareForNewWindow();
  // Load saved window state and resolve the (validated, on-screen) bounds the
  // window should be created with.
  windowState.loadWindowState();
  const restoredBounds = windowState.resolveWindowBoundsForRestore();

  // Create the browser window
  const mainWindow = new BrowserWindow({
    backgroundColor: preset.windowBackground,
    width: restoredBounds.width,
    height: restoredBounds.height,
    x: restoredBounds.x,
    y: restoredBounds.y,
    minWidth: windowState.MIN_SIZE.width,
    minHeight: windowState.MIN_SIZE.height,
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
      zoomFactor: 1.0,
      // Keep timers running when window is hidden/minimized (needed for HDMI reconnect recovery)
      backgroundThrottling: false
    }
  });

  // Windows DPI fix: the constructor sizes the window with the primary display's
  // scale factor, so once it lands on a differently-scaled monitor the size is
  // inflated by that monitor's scaleFactor (e.g. ×1.5) — which would compound on
  // every save/restore cycle. The window is now positioned on its target
  // display, so re-applying the bounds pins it to the intended logical size.
  // macOS/Linux don't have this constructor inflation, so the guard keeps their
  // behavior identical to before.
  if (process.platform === 'win32') {
    mainWindow.setBounds(restoredBounds);
  }

  windowState.restoreMaximizedStateWhileHidden(mainWindow, {
    startMinimized: constants.getAppConfig().startMinimized
  });

  // Set the main window reference in modules
  constants.setMainWindow(mainWindow);
  ipcHandlers.setMainWindow(mainWindow);
  fileHandlers.setMainWindow(mainWindow);

  // Allow renderer to access microphone via getUserMedia on file:// origin.
  // Without both handlers, Chromium falls back to its default content-settings
  // which deny media on file:// pages before the request handler is even called.
  const GRANTED_PERMISSIONS = ['media', 'microphone', 'midi'];
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'display-capture') return webContents === mainWindow.webContents;
    if (GRANTED_PERMISSIONS.includes(permission)) return true;
    return false;
  });
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(GRANTED_PERMISSIONS.includes(permission) ||
      (permission === 'display-capture' && webContents === mainWindow.webContents));
  });

  browserController = createBrowserController({
    mainWindow, WebContentsView, session, ipcMain, shell, Menu, clipboard, components,
    translate: createLibraryDialogTranslator({
      getLanguagePreference: () => constants.getAppConfig()?.language,
      getSystemLocale: () => app.getLocale()
    }),
    themePreset: themeRegistry.getThemePreset(constants.getAppConfig().theme),
    allowStartupCapture: constants.getAppConfig().startupView === 'browser',
    getSettings: () => constants.getAppConfig().browser,
    saveSettings: browser => {
      const config = { ...configModule.loadConfig(), browser };
      if (!configModule.saveConfig(config)) return false;
      constants.setAppConfig(config);
      return true;
    }
  });

  // Any full-page navigation replaces the renderer that is sending heartbeat
  // pings. Disarm here; each loaded page must explicitly arm its own heartbeat.
  mainWindow.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      ipcHandlers.restoreNormalWindowShape?.();
      disarmRendererWatchdog(`navigation:${url}`);
      void openHomeControlHost?.setRendererUnavailable();
      void airPlayReceiverHost?.setRendererUnavailable();
      remoteControlHost?.setRendererUnavailable();
    }
  });
  mainWindow.webContents.on('render-process-gone', () => {
    void openHomeControlHost?.setRendererUnavailable();
    void airPlayReceiverHost?.setRendererUnavailable();
    remoteControlHost?.setRendererUnavailable();
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

  pendingMainWindowShow = true;
  const startupPresentation = createStartupPresentation({
    window: mainWindow,
    ipcMain,
    isQuitting: () => isAppQuitting,
    present: () => {
      if (isAppQuitting || mainWindow.isDestroyed()) return;
      pendingMainWindowShow = false;
      if (constants.getAppConfig().startMinimized) {
        if (constants.getAppConfig().minimizeToTray) {
          mainWindow.hide();
          createTray();
        } else {
          mainWindow.minimize();
        }
        windowState.markRestoreComplete();
      } else {
        windowState.showWindowInRestoredState(mainWindow);
      }
      if (startupUpdateCheckPending) {
        startupUpdateCheckPending = false;
        if (constants.getAppConfig().checkForUpdatesOnStartup !== false) {
          void checkForUpdates();
        }
      }
    }
  });

  const shouldLoadPipelineState = !constants.getCommandLinePresetFile() && constants.getShouldLoadPipelineState();
  // Combined event handler for page load
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(1.0);

    // 2. Set initial zoom level to 1.0 (100%) on every page load and set critical flags
    mainWindow.webContents.executeJavaScript(`
      // Ensure zoom is always reset to 100% on page load
      document.body.style.zoom = 1.0;
      
      // Set initial zoom value (will be stored in settings file for portable mode)
      window.initialZoom = 1.0;
      
      // Set pipeline state loaded flag based on commandLinePresetFile and portable mode
      // If commandLinePresetFile is set, don't load previous pipeline state
      // For portable mode, we always want to load the pipeline state unless a command line preset is specified
      window.pipelineStateLoaded = ${shouldLoadPipelineState};
      
      // Store this in a global constant that can't be changed
      window.ORIGINAL_PIPELINE_STATE_LOADED = window.pipelineStateLoaded;
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
    
  });

  // Start the real application once, after every startup handler is installed.
  mainWindow.loadFile('effetune.html');

  // Enable file drop events
  mainWindow.webContents.on('will-navigate', (e) => {
    e.preventDefault();
  });
  
  // Only the Visualizer clean feed may open a window; all others are denied.
  visualizerFeed.attachMainWindow(mainWindow, { onMenuChanged: ipcHandlers.refreshMenu });

  // Set up the application menu
  ipcHandlers.createMenu();
  

  // Save window state when window is moved or resized
  mainWindow.on('resize', () => {
    if (!windowState.isMiniMode()) windowState.saveWindowState();
  });
  mainWindow.on('move', () => windowState.saveWindowState());
  mainWindow.on('maximize', () => {
    if (!windowState.isMiniMode()) {
      windowState.saveWindowState();
      return;
    }

    // Bounds cannot be restored while the native window is still maximized.
    // Wait for the requested unmaximize to finish, restore the normal window,
    // then honor the user's maximize action from the normal layout.
    mainWindow.once('unmaximize', () => {
      if (!ipcHandlers.restoreNormalWindowShape()) return;
      mainWindow.webContents.send('exit-mini-player');
      if (!mainWindow.isDestroyed()) mainWindow.maximize();
    });
    mainWindow.unmaximize();
  });
  mainWindow.on('unmaximize', () => windowState.saveWindowState());
  mainWindow.on('hide', () => sendWindowVisibilityState(mainWindow));
  mainWindow.on('show', () => sendWindowVisibilityState(mainWindow));
  
  mainWindow.on('minimize', () => {
    sendWindowVisibilityState(mainWindow);
    if (constants.getAppConfig().minimizeToTray) {
      // 'minimize' is not a preventable event — the window is already
      // minimized when it fires, so hide() leaves the window in a combined
      // minimized+hidden state.  restore() from that state re-shows the
      // native window but leaves Chromium's internal visibility state hidden,
      // making the window input-dead (the 'restore' handler below resyncs it
      // with show()).
      mainWindow.hide();
      createTray();
      // Request tray menu update from renderer process
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('request-tray-menu-update');
      }
    }
  });

  mainWindow.on('restore', () => {
    // If the window was restored out of the minimized+hidden tray state,
    // the native window is visible again but Chromium's internal visibility
    // state is still hidden, leaving the window unable to receive input.
    // show() resyncs it, and is harmless when the window is already visible.
    mainWindow.show();
    sendWindowVisibilityState(mainWindow);
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });
  
  // Flag to track if we're in the process of closing
  let isClosing = false;
  const finalizeClose = () => {
    if (isClosing) return;
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (isAppQuitting) app.quit();
      return;
    }
    isClosing = true;
    mainWindow.close();
  };

  // Set up the trigger close function for IPC handler to use
  constants.setTriggerClose(finalizeClose);

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

    // An unfinished renderer may not have installed its state-save listener yet.
    if (!startupPresentation.isReady()) {
      finalizeClose();
      return;
    }

    // Request the renderer process to send pipeline state
    if (mainWindow && mainWindow.webContents) {
      // Set a timeout to ensure the app closes even if renderer doesn't respond
      const closeTimeout = setTimeout(() => {
        console.error('Pipeline state save timeout, closing window without saving state');
        finalizeClose();
      }, 3000);

      // Store the timeout ID so we can clear it when we receive the state
      constants.setCloseTimeout(closeTimeout);

      // Request pipeline state from renderer
      mainWindow.webContents.send('request-pipeline-state-for-close');
    } else {
      // No renderer available, just close
      finalizeClose();
    }
  });
  
  mainWindow.on('closed', () => {
    closeSplashScreen();
    pendingMainWindowShow = false;
    void openHomeControlHost?.setRendererUnavailable();
    void airPlayReceiverHost?.setRendererUnavailable();
    constants.setMainWindow(null);
  });
}

// Initialize variables in constants module
function initGlobalVariables() {
  // Flag to track if pipeline state should be loaded
  // Set to true by default, will be set to false if command line preset file is provided
  constants.setShouldLoadPipelineState(true);
  
  // Store command line preset file path
  constants.setCommandLinePresetFile(null);
  
  constants.setCommandLineMusicFiles([]);

  // Store app version - already set in the imports section
}

// Store update info for later sending
let pendingUpdateInfo = null;
const appUpdater = createAppUpdater({ app });
let updateInstallPromise = null;

function downloadAndInstallUpdate() {
  if (updateInstallPromise) return updateInstallPromise;
  updateInstallPromise = appUpdater.downloadUpdate().then(() => {
    const mainWindow = constants.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once('will-prevent-unload', event => event.preventDefault());
    }
    app.quit();
  }).catch(error => {
    updateInstallPromise = null;
    throw error;
  });
  return updateInstallPromise;
}

// Function to get pending update info (for IPC handlers)
function getPendingUpdateInfo() {
  return pendingUpdateInfo;
}

// GitHub releases feed for the desktop application. A page of releases is
// requested instead of the single newest release of the repository, because the
// repository also publishes DSP library releases (dsp-v*) that are frequently
// newer than the newest desktop release.
const UPDATE_RELEASES_URL = 'https://api.github.com/repos/frieve-a/effetune/releases?per_page=30';
const UPDATE_CHECK_TIMEOUT_MS = 15000;

// Chromium's network stack is used instead of Node's https module: it resolves
// host names without the libuv thread pool that the library workers keep busy
// during a startup scan, and it follows the system proxy configuration.
function fetchReleases() {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url: UPDATE_RELEASES_URL });
    let settled = false;
    const settle = (error, releases) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve(releases);
    };
    const timeout = setTimeout(() => {
      settle(new Error(`no response within ${UPDATE_CHECK_TIMEOUT_MS} ms`));
      request.abort();
    }, UPDATE_CHECK_TIMEOUT_MS);

    request.setHeader('User-Agent', 'EffeTune-Update-Checker/1.0');
    request.setHeader('Accept', 'application/vnd.github+json');

    request.on('response', response => {
      if (response.statusCode !== 200) {
        settle(new Error(`HTTP ${response.statusCode}`));
        request.abort();
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', settle);
      response.on('end', () => {
        try {
          settle(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          settle(new Error(`malformed release feed: ${error.message}`));
        }
      });
    });
    request.on('error', settle);
    request.on('abort', () => settle(new Error('request aborted')));
    request.end();
  });
}

// Check for updates from GitHub
async function checkForUpdates() {
  if (process.windowsStore === true) return;
  try {
    const releases = await fetchReleases();

    const {
      isNewerVersion,
      normalizeSemVer,
      selectLatestAppRelease
    } = await releaseVersionModulePromise;

    const latest = selectLatestAppRelease(releases);
    const currentVersion = normalizeSemVer(constants.getAppVersion());

    // A successful check replaces any update information from an earlier check.
    pendingUpdateInfo = null;
    appUpdater.setTargetRelease(null);

    // Compare versions
    if (latest && currentVersion && isNewerVersion(latest.version, currentVersion)) {
      // In-app installation must read the update metadata of this exact release.
      appUpdater.setTargetRelease(latest.tag);

      // Store update info for later sending
      pendingUpdateInfo = {
        version: latest.name,
        targetVersion: latest.version,
        currentVersion,
        autoUpdateSupported: appUpdater.isSupported(),
        url: 'https://github.com/Frieve-A/effetune/releases/'
      };

      // Try to send immediately if window is ready
      const mainWindow = constants.getMainWindow();
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('update-available', pendingUpdateInfo);
      }
    }
  } catch (error) {
    console.warn(`Failed to check for updates: ${error.message}`);
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
  const preset = themeRegistry.getThemePreset(constants.getAppConfig()?.theme);
  // Create splash window with About dialog content
  splashWindow = new BrowserWindow({
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
      contextIsolation: true
    }
  });
  
  // Create HTML content for splash window
  const brandAnimationModuleUrl = JSON.stringify(
    pathToFileURL(path.join(__dirname, '../js/ui/brand-animation.js')).href
  ).replace(/[<>\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const splashContent = `
  <!DOCTYPE html>
  <html data-theme="${preset.id}">
  <head>
    <meta charset="UTF-8">
    <title>EffeTune</title>
    <link rel="stylesheet" href="${pathToFileURL(path.join(__dirname, '../css/effetune-theme.css')).href}">
    <style>
      body {
        background-color: color-mix(in srgb, ${preset.windowBackground} 90%, transparent);
        color: ${preset.windowForeground};
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
      .splash-canvas {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .splash-container {
        position: relative;
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
        opacity: 0.81;
        margin-bottom: 5px;
      }
      .splash-copyright {
        font-size: 12px;
        opacity: 0.58;
      }
      .splash-loading {
        margin-top: 15px;
        font-size: 12px;
        opacity: 0.58;
      }
    </style>
  </head>
  <body>
    <canvas class="splash-canvas" id="splash-canvas"></canvas>
    <div class="splash-container">
      <div class="splash-header">
        <img src="${path.join(__dirname, '../images/icon_64x64.png')}" class="splash-icon" alt="EffeTune Icon">
        <h2>Frieve EffeTune</h2>
      </div>
      <div class="splash-content">
        <div class="splash-version">Version ${constants.getAppVersion()}</div>
        <div class="splash-description">Desktop Audio Effect Processor</div>
        <div class="splash-copyright">Copyright © Frieve 2025, 2026</div>
        <div class="splash-loading">Starting application...</div>
      </div>
    </div>
    <script type="module">
      import { startBrandAnimation } from ${brandAnimationModuleUrl};
      startBrandAnimation(document.getElementById('splash-canvas'), {
        icon: document.querySelector('.splash-icon'),
        title: document.querySelector('.splash-header h2'),
        reveal: [...document.querySelector('.splash-content').children]
      });
    </script>
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
    if (!splashWindow || splashWindow.isDestroyed() || isAppQuitting) return;
    // Check if starting minimized - if so, don't show splash screen
    const appConfig = constants.getAppConfig();
    if (appConfig && appConfig.startMinimized) {
      // Don't show splash window when starting minimized
      return;
    }
    
    // Position the splash over the main window's final restored bounds,
    // whether the application has finished preparing or is still hidden.
    const mainWindow = constants.getMainWindow();
    if (mainWindow) {
      const mainBounds = windowState.getSplashTargetBounds();
      const splashBounds = splashWindow.getBounds();
      
      // Calculate the center position
      const x = Math.round(mainBounds.x + (mainBounds.width - splashBounds.width) / 2);
      const y = Math.round(mainBounds.y + (mainBounds.height - splashBounds.height) / 2);
      
      // Set the position
      splashWindow.setPosition(x, y);
    }
    
    // Show the splash window
    splashWindow.show();
    splashCloseTimer = setTimeout(closeSplashScreen, SPLASH_DURATION_MS);
  });
  
  splashWindow.once('closed', () => {
    clearTimeout(splashCloseTimer);
    splashCloseTimer = null;
    splashWindow = null;
    try {
      fs.unlinkSync(splashPath);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Error removing temporary splash file:', error);
    }
  });
}

// Store tray menu labels for translation
let trayMenuLabels = {
  open: 'Open',
  quit: 'Quit',
  presets: 'Pipeline Presets'
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
        { label: trayMenuLabels.open, click: () => presentMainWindow(constants.getMainWindow()) },
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
      { label: trayMenuLabels.open, click: () => presentMainWindow(constants.getMainWindow()) },
      { label: trayMenuLabels.quit, click: () => { app.quit(); } }
    ];
    
    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    tray.setToolTip('EffeTune');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      presentMainWindow(constants.getMainWindow());
    });
  } catch (error) {
    console.error('Failed to create tray icon:', error);
    // Don't throw the error, just log it and continue without tray
  }
}

// Initialize the app
async function initializeApp() {
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

  themeRegistry = await import(pathToFileURL(path.join(__dirname, '../js/theme-registry.mjs')).href);
  const cfgDefaults = {
    autoLaunch: false,
    startMinimized: false,
    minimizeToTray: false,
    language: 'auto',
    startupView: 'effects',
    libraryStartupView: 'tracks',
    pipelineStartup: 'last',
    startupPreset: '',
    checkForUpdatesOnStartup: true,
    hardwareAcceleration: true,
    openHomeRemoteControl: false,
    upnpAvRemoteControl: false,
    airPlayReceiver: false
  };
  const cfg = { ...cfgDefaults, ...configModule.loadConfig() };
  delete cfg.graphicsFallbackPending;
  if ('theme' in cfg) cfg.theme = themeRegistry.normalizeThemeId(cfg.theme);
  configModule.saveConfig(cfg);
  constants.setAppConfig(cfg);
  applyNativeTheme(cfg);
  if (process.windowsStore !== true) {
    app.setLoginItemSettings({ openAtLogin: !!cfg.autoLaunch });
  }
  if (cfg.pipelineStartup === 'default') {
    constants.setShouldLoadPipelineState(false);
  } else if (cfg.pipelineStartup === 'last') {
    constants.setShouldLoadPipelineState(true);
  } else if (cfg.pipelineStartup === 'preset') {
    constants.setShouldLoadPipelineState(false);
  }

  // Register the lightweight recovery endpoint before creating the renderer.
  // The catalog modules and utility process are opened only when the renderer
  // first requests the Music Library.
  libraryCatalogRecovery = new LibraryCatalogRecovery({
    userDataPath,
    dialog,
    getMainWindow: () => constants.getMainWindow(),
    openCatalog: openLibraryCatalogServices,
    closeCatalog: closeLibraryCatalogServices,
    onDiagnostic: error => console.error(
      'Music library catalog recovery diagnostic:',
      String(error?.code || error?.name || 'catalogUnavailable').slice(0, 128)
    )
  });
  disposeLibraryCatalogRecoveryIpc = registerLibraryCatalogRecoveryIpc({
    ipcMain,
    recovery: libraryCatalogRecovery,
    getMainWindow: () => constants.getMainWindow()
  });

  openHomeControlHost = createOpenHomeControlHost({
    app,
    constants,
    config: configModule,
    getMainWindow: () => constants.getMainWindow(),
    onFriendlyNameChanged: () => {
      networkMusicHost?.refreshFriendlyName();
      void airPlayReceiverHost?.setConfiguration({
        enabled: constants.getAppConfig().airPlayReceiver === true,
        friendlyName: openHomeControlHost.getFriendlyName()
      });
    },
    onDiagnostic: (code, detail) => {
      if (code !== 'sidecar-stderr' || process.env.EFFETUNE_NETWORK_DEBUG === '1') {
        console.error('OpenHome diagnostic:', code, detail);
      }
    }
  });
  disposeOpenHomeIpc = registerOpenHomeIpc({
    ipcMain,
    host: openHomeControlHost,
    getMainWindow: () => constants.getMainWindow()
  });

  const airPlayResourceDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'airplay')
    : path.join(app.getAppPath(), 'out', 'native', 'airplay-receiver', `${process.platform}-${process.arch}`);
  airPlayReceiverHost = createAirPlayReceiverHost({
    executablePath: path.join(airPlayResourceDirectory, process.platform === 'win32' ? 'uxplay.exe' : 'uxplay'),
    resourceDirectory: airPlayResourceDirectory,
    registryPath: path.join(app.getPath('userData'), 'airplay-gstreamer.bin'),
    onDiagnostic: (diagnostic, detail) => {
      if (process.env.EFFETUNE_NETWORK_DEBUG === '1' || ![
        'airplay-helper-output', 'invalid-rtp', 'rtp-rebuffer', 'rtp-packet-loss',
        'rtp-clock-discontinuity', 'airplay-pcm-rebuffer'
      ].includes(diagnostic)) {
        console.error('AirPlay diagnostic:', diagnostic, detail);
      }
    },
    onStatus: status => {
      const window = constants.getMainWindow();
      if (window?.webContents && !window.webContents.isDestroyed()) {
        window.webContents.send('airplay-v1:status', status);
      }
    }
  });
  disposeAirPlayIpc = registerAirPlayIpc({
    ipcMain, MessageChannelMain, host: airPlayReceiverHost,
    getMainWindow: () => constants.getMainWindow(),
    config: configModule, constants,
    getFriendlyName: () => openHomeControlHost.getFriendlyName()
  });
  void airPlayReceiverHost.setConfiguration({
    enabled: cfg.airPlayReceiver === true,
    friendlyName: openHomeControlHost.getFriendlyName()
  });

  const localPlayer = new LocalOpenHomePlayer(openHomeControlHost);
  networkMusicHost = new NetworkMusicHost({
    localPlayer,
    getFriendlyName: () => openHomeControlHost.getFriendlyName(),
    getCatalog: async (initialize = true) => {
      if (initialize) await libraryCatalogRecovery.initialize();
      else if (!libraryCatalogUtilityHost) return null;
      if (!libraryCatalogUtilityHost) throw new Error('Music library is unavailable');
      return libraryCatalogUtilityHost;
    },
    loadConfig: () => configModule.loadConfig(),
    saveConfig: next => { configModule.saveConfig(next); constants.setAppConfig(next); },
    onDiagnostic: error => console.error('Network music diagnostic:', error)
  });
  disposeNetworkMusicIpc = registerNetworkMusicIpc({ ipcMain, host: networkMusicHost, getMainWindow: () => constants.getMainWindow() });
  disposeIntegratedRemoteClientIpc = registerIntegratedRemoteClientIpc({ ipcMain, app, getMainWindow: () => constants.getMainWindow(), getPairingEndpoint: playerId => networkMusicHost?.discovery.remoteControlEndpoint(playerId) });
  void networkMusicHost.start().catch(error => console.error('Network music startup diagnostic:', error));

  // LAN remote control (remote-v1). IPC is always registered; the server
  // runs while Settings > Remote Control is on (or EFFETUNE_REMOTE=1 / --remote).
  remoteControlHost = new RemoteControlHost({
    app,
    getMainWindow: () => constants.getMainWindow(),
    config: configModule,
    discovery: networkMusicHost.discovery,
    networkMusic: networkMusicHost,
    localPlayer,
    getPlayerId: () => `uuid:${openHomeControlHost.ensureDeviceId().openHomeDeviceId}`,
    approvePairing: async ({ address, clientName, signal }) => {
      const window = constants.getMainWindow();
      if (!window || window.isDestroyed() || signal.aborted) return false;
      const translate = createLibraryDialogTranslator({ getLanguagePreference: () => constants.getAppConfig()?.language, getSystemLocale: () => app.getLocale() });
      const text = key => translate(`dialog.remoteControl.${key}`);
      const result = await dialog.showMessageBox(window, {
        type: 'question', title: text('pairingRequestTitle'), message: text('pairingRequestMessage'),
        detail: `${clientName ? `${clientName}\n` : ''}${address}\n\n${text('pairingRequestDetail')}`,
        buttons: [text('pairingRequestDeny'), text('pairingRequestAllow')], defaultId: 0, cancelId: 0, noLink: true, signal
      });
      return !signal.aborted && result.response === 1;
    },
    log: (...args) => console.log(...args)
  });
  disposeRemoteControlIpc = registerRemoteControlIpc({
    ipcMain,
    getHost: () => remoteControlHost,
    getMainWindow: () => constants.getMainWindow()
  });
  void remoteControlHost.start();

  // Register IPC before the application can request its startup preferences/files.
  alacPlaybackSource = new AlacPlaybackSource();
  ipcHandlers.registerIpcHandlers({ onConfigSaved: applyNativeTheme, alacPlaybackSource });
  createWindow();
  if (!process.argv.includes(constants.AUTO_RESTART_FLAG) && !constants.getAppConfig().startMinimized) {
    createSplashScreen();
  }

}

// Initialize global variables
initGlobalVariables();
fileHandlers.processCommandLineArgs(process.argv);

// Hardware acceleration is the default. Repeated GPU process failures switch
// the next launch to software rendering; the user can retry from Config.
const graphicsStartup = initializeGpuAcceleration({
  app,
  config: configModule,
  queueRestart: queueAutoRestart,
  isQuitting: () => isAppQuitting
});

// Handle second instance (when user tries to open another instance of the app)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // If we couldn't get the lock, it means another instance is already running
  // so we quit this one
  app.quit();
} else {
  // This is the first instance
  // Listen for second-instance event (when user opens a file with the app)
  app.on('second-instance', async (event, commandLine, workingDirectory) => {
    // Process the command line arguments from the second instance
    // This will set shouldLoadPipelineState to false if a preset file is specified
    // and will detect music files
    fileHandlers.processCommandLineArgs(commandLine);
    
    // Focus the main window if it exists
    const mainWindow = constants.getMainWindow();
    if (mainWindow) {
      // Initial presentation waits for the renderer to finish preparing.
      if (!pendingMainWindowShow) {
        presentMainWindow(mainWindow);
      }
      
      // If there's a preset file, send it to the renderer
      const commandLinePresetFile = constants.getCommandLinePresetFile();
      if (commandLinePresetFile) {
        mainWindow.webContents.send('open-preset-file', commandLinePresetFile);
        constants.setCommandLinePresetFile(null);
      }
      
      // If there are music files, send them to the renderer
      const commandLineMusicFiles = constants.getCommandLineMusicFiles();
      if (commandLineMusicFiles.length > 0) {
        const admittedFiles = [...commandLineMusicFiles];
        constants.clearCommandLineMusicFiles();
        try {
          const descriptors = await fileHandlers.admitLocalPlaybackPaths(admittedFiles);
          mainWindow.webContents.send('open-music-files', descriptors);
        } catch (error) {
          console.error('Second-instance music file admission diagnostic:', error?.code || error?.name || 'unknown');
        }
      }
    }
  });
}

// Handle macOS file open events
app.on('open-file', async (event, path) => {
  event.preventDefault();
  
  if (path.endsWith('.effetune_preset')) {
    try {
      // Check if file exists
      if (fs.existsSync(path)) {
        fileAccess.grantRead(path);
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
  } else if (isSupportedPlaybackAudioPath(path)) {
    try {
      // Check if file exists
      if (fs.existsSync(path)) {
        const mainWin = constants.getMainWindow();
        if (mainWin && mainWin.webContents) {
          // If app is already running, send the file path to the renderer
          const descriptors = await fileHandlers.admitLocalPlaybackPaths([path]);
          mainWin.webContents.send('open-music-files', descriptors);
        } else {
          // If app is not yet running, store the path to be opened when the app is ready
          constants.addCommandLineMusicFile(path);
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
if (process.windowsStore !== true) app.setAsDefaultProtocolClient('effetune');
  
// Main entry point
app.whenReady().then(async () => {
  try {
    await waitForPredecessorShutdown();
    await initializeApp();
  } catch (error) {
    console.error('Failed to initialize EffeTune:', error?.code || error?.name || 'unknown');
    dialog.showErrorBox(
      'EffeTune could not start',
      'EffeTune could not finish starting. Restart the application and try again.'
    );
    await closeApplicationServices().catch(() => {});
    app.quit();
    return;
  }

  if (graphicsStartup.fallbackPending) {
    const mainWindow = constants.getMainWindow();
    mainWindow.once('show', () => {
      const config = configModule.loadConfig();
      if (config.hardwareAcceleration !== false) return;
      const translate = createLibraryDialogTranslator({
        getLanguagePreference: () => config.language,
        getSystemLocale: () => app.getLocale()
      });
      void dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: translate('dialog.graphicsRecovery.title'),
        message: translate('dialog.graphicsRecovery.message'),
        buttons: [translate('dialog.config.close')],
        noLink: true
      }).catch(error => console.error('[graphics] Could not show the fallback notice:', error));
    });
  }
  
  registerWatchdogPowerEvents();

  // Start the renderer watchdog — it self-arms once the first ping arrives.
  startWatchdog();

  // On macOS, recreate window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (isAppQuitting) return;
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', (event) => {
  isAppQuitting = true;
  stopWatchdog();
  armQuitProtection();
  if (!appServicesShutdownReady && (libraryCatalogRecovery || openHomeControlHost || airPlayReceiverHost || alacPlaybackSource)) {
    event.preventDefault();
    closeApplicationServices()
      .catch(error => {
        console.error('Failed to close application services cleanly:', error?.code || error?.name || 'unknown');
      })
      .finally(() => {
        appServicesShutdownReady = true;
        app.quit();
      });
  }
});

app.on('will-quit', () => {
  // The renderer can still publish state and send its final unload notification
  // while services close. Keep IPC registered until every window has closed;
  // getHost() returns null during shutdown so those requests receive a response.
  disposeRemoteControlIpc?.();
  disposeRemoteControlIpc = null;
});

// Quit the app when all windows are closed (except on macOS unless explicitly quitting)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || isAppQuitting) {
    app.quit();
  }
});

// Export functions for use in other modules
module.exports = {
  sendPendingUpdateInfo,
  getPendingUpdateInfo,
  checkForUpdates,
  downloadAndInstallUpdate
};
