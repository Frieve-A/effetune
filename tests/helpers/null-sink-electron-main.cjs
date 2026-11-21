const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { installTestWindowPolicy } = require('./electron-test-display.cjs');

installTestWindowPolicy();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false }
  });
  await window.loadFile(path.join(app.getPath('userData'), 'feed.html'));
  window.showInactive();
});
