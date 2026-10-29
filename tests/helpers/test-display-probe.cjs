const { app, screen } = require('electron');
const { selectTestDisplay } = require('./electron-test-display.cjs');

// Discover native monitor geometry without creating a BrowserWindow.
app.whenReady().then(() => {
  app.dock?.hide();
  process.send(selectTestDisplay(screen), () => app.quit());
});
