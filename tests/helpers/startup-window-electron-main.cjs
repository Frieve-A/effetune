const { app, BrowserWindow } = require('electron');
const constants = require('../../electron/constants');
const windowState = require('../../electron/window-state');

app.setPath('userData', process.env.EFFETUNE_STARTUP_WINDOW_TEST_PROFILE);

globalThis.startupWindowResults = app.whenReady().then(async () => {
  const results = [];
  for (const isMaximized of [false, true]) {
    const window = new BrowserWindow({
      show: false, opacity: 0, skipTaskbar: true,
      width: 800, height: 600, x: 80, y: 80,
      webPreferences: { backgroundThrottling: false }
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
        normalBounds: window.getNormalBounds()
      };
      await window.loadURL('data:text/html,<html><body>Startup geometry test</body></html>');
      const firstClientSize = await window.webContents.executeJavaScript('[innerWidth, innerHeight]');
      const presentationShows = [];
      window.on('show', () => presentationShows.push({
        maximized: window.isMaximized(), bounds: window.getBounds()
      }));
      // The test window stays transparent, including during native presentation.
      windowState.showWindowInRestoredState(window);
      const presented = {
        visible: window.isVisible(), maximized: window.isMaximized(), bounds: window.getBounds()
      };
      const shownClientSize = await window.webContents.executeJavaScript('[innerWidth, innerHeight]');
      if (isMaximized) window.unmaximize();
      results.push({
        isMaximized, normalBounds, preparationShows, prepared, firstClientSize,
        presentationShows, presented, shownClientSize, restoredBounds: window.getBounds()
      });
    } finally {
      window.destroy();
    }
  }
  return results;
});

app.on('window-all-closed', () => {});
