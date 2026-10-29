const { app, BrowserWindow } = require('electron');
const { installTestWindowPolicy } = require('../helpers/electron-test-display.cjs');

installTestWindowPolicy();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await window.loadURL(process.env.EFFETUNE_FRAGMENT_TEST_URL);
});

app.on('window-all-closed', () => app.quit());
