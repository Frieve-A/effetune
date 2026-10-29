const { app, ipcMain } = require('electron');
const path = require('node:path');
const { installTestWindowPolicy } = require('./electron-test-display.cjs');

installTestWindowPolicy();

app.setAppPath(path.resolve(__dirname, '../..'));
app.setPath('userData', process.env.EFFETUNE_STARTUP_TEST_PROFILE);
globalThis.startupWindows = [];
const prepared = new Set();
ipcMain.on('renderer-ready-for-presentation', event => prepared.add(event.sender.id));
process.on('message', message => {
  if (message === 'exit') app.exit();
});
app.on('browser-window-created', (_event, window) => {
  window.webContents.setAudioMuted(true);
  const record = { id: window.id, url: '', loads: 0, shows: [], closed: false };
  globalThis.startupWindows.push(record);
  window.webContents.on('did-finish-load', () => {
    record.url = window.webContents.getURL();
    record.loads += 1;
  });
  const reportMaximized = () => {
    const url = window.webContents.getURL();
    if (!url.includes('/effetune.html')) return;
    process.send?.({ type: 'maximized', windowId: window.id, url,
      visible: window.isVisible(), maximized: window.isMaximized() });
  };
  window.on('maximize', reportMaximized);
  window.on('show', () => {
    record.shownAt = Date.now();
    if (!window.webContents.getURL().includes('/effetune.html')) return;
    record.shows.push({ prepared: prepared.has(window.webContents.id),
      splashClosed: globalThis.startupWindows.filter(item => item.id !== window.id).every(item => item.closed) });
    // Report through Node IPC so this test never attaches Chromium DevTools.
    process.send?.({ type: 'presented', main: record, windowId: window.id, url: window.webContents.getURL(),
      visible: window.isVisible(), maximized: window.isMaximized() });
  });
  window.on('closed', () => {
    window.removeListener('maximize', reportMaximized);
    record.closed = true;
    record.closedAt = Date.now();
    process.send?.({ type: 'closed', window: record });
  });
});
require('../../electron/main.js');
