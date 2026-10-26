'use strict';

const { app } = require('electron');
const path = require('node:path');

app.setAppPath(path.resolve(__dirname, '../..'));
// Parameter inspection needs the real renderer, but no visible or focused windows.
// Electron supports these native window controls on Windows and macOS.
if (process.platform === 'win32' || process.platform === 'darwin') {
  app.on('browser-window-created', (_event, window) => {
    window.setOpacity(0);
    window.setFocusable(false);
    window.setSkipTaskbar(true);
  });
}

require('../../electron/main.js');
