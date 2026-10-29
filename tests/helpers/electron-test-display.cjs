'use strict';

function selectTestDisplay(screen) {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().find(display => display.id !== primary.id) || primary;
}

function fitTestWindow(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    width, height,
    x: Math.max(workArea.x, Math.min(bounds.x ?? workArea.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(bounds.y ?? workArea.y, workArea.y + workArea.height - height))
  };
}

function placeTestWindow(window) {
  const { screen } = require('electron');
  if (window.isMaximized() || window.isFullScreen()) return;
  const display = selectTestDisplay(screen);
  if (display.id === screen.getPrimaryDisplay().id) return;
  const bounds = window.getBounds();
  const placed = fitTestWindow(bounds, display.workArea);
  if (Object.keys(placed).some(key => placed[key] !== bounds[key])) {
    window.setBounds(placed, false);
    // A move between Windows monitors with different DPI can resize the window.
    // Reapply the logical bounds after the native window reaches its target display.
    if (process.platform === 'win32') window.setBounds(placed, false);
  }
}

// Install in the fixture entry point, before loading the application or creating windows.
// Keep the native show/maximize/restore operations so presentation tests remain real.
function installTestWindowPolicy({ visible = false, focusable = visible } = {}) {
  const { app, screen } = require('electron');
  const canHidePresentation = process.platform === 'win32' || process.platform === 'darwin';
  const backgroundOptions = canHidePresentation ? {
    ...(!visible ? { opacity: 0, skipTaskbar: true } : {}),
    ...(!focusable ? { focusable: false } : {})
  } : {};
  const displayBounds = bounds => {
    const display = selectTestDisplay(screen);
    return display.id === screen.getPrimaryDisplay().id ? bounds : fitTestWindow(bounds, display.workArea);
  };

  if (!visible) app.whenReady().then(() => app.dock?.hide());
  app.on('browser-window-created', (_event, window) => {
    if (!visible && canHidePresentation) {
      window.setOpacity(0);
      window.setSkipTaskbar(true);
    }
    if (!focusable && canHidePresentation) window.setFocusable(false);
    for (const method of ['show', 'showInactive', 'maximize', 'restore']) {
      const original = window[method].bind(window);
      window[method] = (...args) => {
        placeTestWindow(window);
        return original(...args);
      };
    }
  });

  // window.open can create an already-visible native window. Supply its position
  // before construction instead of moving it after a flash on the primary display.
  app.on('web-contents-created', (_event, contents) => {
    const setHandler = contents.setWindowOpenHandler.bind(contents);
    contents.setWindowOpenHandler = handler => setHandler(details => {
      const result = handler(details);
      if (result.action !== 'allow') return result;
      const options = result.overrideBrowserWindowOptions || {};
      const bounds = displayBounds({ width: options.width ?? 800, height: options.height ?? 600,
        x: options.x, y: options.y });
      return { ...result, overrideBrowserWindowOptions: { ...options, ...bounds, ...backgroundOptions } };
    });
  });
}

module.exports = { selectTestDisplay, fitTestWindow, placeTestWindow, installTestWindowPolicy };
