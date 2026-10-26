const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const constants = require('../../electron/constants');
const ipcHandlers = require('../../electron/ipc-handlers');
const windowState = require('../../electron/window-state');
const { createStartupPresentation } = require('../../electron/startup-presentation.cjs');

app.setPath('userData', process.env.EFFETUNE_STARTUP_WINDOW_TEST_PROFILE);

globalThis.startupWindowResults = app.whenReady().then(async () => {
  const results = [];
  for (const isMaximized of [false, true]) {
    const window = new BrowserWindow({
      show: false, opacity: 0, skipTaskbar: true, focusable: false,
      width: 800, height: 600, x: 80, y: 80,
      webPreferences: { backgroundThrottling: false, preload: path.resolve(__dirname, '../../electron/preload.js') }
    });
    try {
      const normalBounds = window.getNormalBounds();
      constants.setWindowState({ bounds: normalBounds, isMaximized });
      windowState.prepareForNewWindow();
      const preparationShows = [];
      const recordPreparation = () => preparationShows.push(window.getOpacity());
      window.on('show', recordPreparation);
      windowState.restoreMaximizedStateWhileHidden(window);
      window.removeListener('show', recordPreparation);
      const prepared = {
        visible: window.isVisible(),
        maximized: window.isMaximized(),
        bounds: window.getBounds(),
        normalBounds: window.getNormalBounds(),
        contentSize: window.getContentSize()
      };
      const handoff = [];
      const splash = new BrowserWindow({
        parent: window, show: false, opacity: 0, skipTaskbar: true, focusable: false,
        width: 100, height: 100
      });
      splash.showInactive();
      let finishPresentation;
      const presentation = new Promise(resolve => { finishPresentation = resolve; });
      createStartupPresentation({ window, ipcMain, isQuitting: () => false, present: () => {
        windowState.showWindowInRestoredState(window);
        handoff.push('main-shown');
        finishPresentation();
      } });
      const readyToShow = new Promise(resolve => window.once('ready-to-show', resolve));
      const load = window.loadURL('data:text/html,<html><body>Startup geometry test</body></html>');
      // Production installs its application menu immediately after starting
      // the initial page load, before the hidden window is presented.
      ipcHandlers.createMenu();
      await Promise.all([load, readyToShow]);
      prepared.contentSize = window.getContentSize();
      const firstClientSize = await window.webContents.executeJavaScript('[innerWidth, innerHeight]');
      const presentationShows = [];
      window.on('show', () => presentationShows.push({
        maximized: window.isMaximized(), bounds: window.getBounds()
      }));
      const hiddenWhilePreparing = !window.isVisible() && splash.isVisible();
      // The production preload signals completion while the real window is still hidden.
      await window.webContents.executeJavaScript('window.electronAPI.signalReadyForPresentation()');
      await presentation;
      handoff.push(splash.isVisible() ? 'splash-still-visible' : 'splash-hidden');
      splash.close();
      const presented = {
        visible: window.isVisible(),
        focused: window.isFocused(),
        maximized: window.isMaximized(),
        bounds: window.getBounds(),
        contentSize: window.getContentSize()
      };
      const shownClientSize = await window.webContents.executeJavaScript('[innerWidth, innerHeight]');
      if (isMaximized) window.unmaximize();
      results.push({
        isMaximized, normalBounds, preparationShows, prepared, firstClientSize, hiddenWhilePreparing, handoff,
        presentationShows, presented, shownClientSize, restoredBounds: window.getBounds()
      });
    } finally {
      window.destroy();
    }
  }
  return results;
});

app.on('window-all-closed', () => {});
